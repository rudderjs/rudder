import type { Authenticatable, Guard, UserProvider } from './contracts.js'
import { currentTestUser } from './auth-manager.js'
import { newRememberToken, setRememberDirective } from './remember.js'

// ─── Session Guard ────────────────────────────────────────
// Cookie-based auth via @rudderjs/session.

export interface SessionStore {
  get<T>(key: string, fallback?: T): T | undefined
  put(key: string, value: unknown): void
  forget(key: string): void
  regenerate(): Promise<void>
}

export class SessionGuard implements Guard {
  private _user: Authenticatable | null | undefined = undefined // undefined = not loaded yet

  constructor(
    private readonly provider: UserProvider,
    private readonly session: SessionStore,
  ) {}

  /**
   * Resolve the authenticated user, or `null` if none.
   *
   * **Soft-fails** when called outside an ALS-bound session context (api
   * route without session middleware, CLI/worker call, observer dispatched
   * out-of-band): returns `null` rather than throwing. Matches Laravel's
   * `Auth::user()` semantics — "unauthenticated" and "no session" both
   * collapse to the same null result, so api handlers can safely reference
   * `req.user` without crashing.
   *
   * Result is memoized per-guard-instance. The framework constructs a fresh
   * `SessionGuard` per request (no caching on `AuthManager`), so memoization
   * does not leak across requests.
   */
  async user(): Promise<Authenticatable | null> {
    if (this._user !== undefined) return this._user

    // Test-mode override — when `@rudderjs/testing`'s `actingAs(user)` writes
    // an `x-testing-user` header, AuthMiddleware installs the user via
    // `runWithTestUser(...)`; we honor that here so the rest of the auth
    // surface (guard.check(), Auth.guard().user(), RequireAuth) sees the
    // synthetic user without a session/DB round-trip.
    const testUser = currentTestUser()
    if (testUser) {
      this._user = testUser
      return this._user
    }

    let id: string | undefined
    try {
      id = this.session.get<string>('auth_user_id')
    } catch {
      this._user = null
      return null
    }

    if (id) {
      this._user = await this.provider.retrieveById(id)
    } else {
      this._user = null
    }
    return this._user
  }

  async id(): Promise<string | null> {
    const u = await this.user()
    return u ? u.getAuthIdentifier() : null
  }

  async check(): Promise<boolean> {
    return (await this.user()) !== null
  }

  async guest(): Promise<boolean> {
    return (await this.user()) === null
  }

  async attempt(credentials: Record<string, unknown>, remember?: boolean): Promise<boolean> {
    const user = await this.provider.retrieveByCredentials(credentials)
    if (!user) {
      // Equalize timing with the wrong-password path so an attacker can't
      // enumerate accounts by latency (no user = instant; wrong password =
      // slow bcrypt/argon verify).
      await this.provider.fakeValidateCredentials?.(credentials)
      return false
    }

    const valid = await this.provider.validateCredentials(user, credentials)
    if (!valid) return false

    await this.login(user, remember)
    return true
  }

  /**
   * Log a user in. When `remember` is true (and the provider supports
   * persistent tokens), mint a fresh remember token, persist it on the user,
   * and queue a long-lived remember cookie — `AuthMiddleware` writes it to the
   * response. The directive is a no-op outside an HTTP request scope.
   */
  async login(user: Authenticatable, remember?: boolean): Promise<void> {
    await this.session.regenerate()
    this.session.put('auth_user_id', user.getAuthIdentifier())
    this._user = user

    if (remember && this.provider.updateRememberToken) {
      const token = newRememberToken()
      await this.provider.updateRememberToken(user.getAuthIdentifier(), token)
      setRememberDirective({ action: 'set', userId: user.getAuthIdentifier(), token })
    }
  }

  /**
   * Resolve a user from a remember cookie's `userId`/`token` and, on a valid
   * constant-time token match, re-establish the session WITHOUT minting a new
   * token (the existing cookie stays valid — the token rotates only on a fresh
   * remember-login or logout). Returns whether auto-login succeeded. Used by
   * AuthMiddleware when there's no active session.
   */
  async loginViaRememberCookie(userId: string, token: string): Promise<boolean> {
    if (!this.provider.retrieveByToken) return false
    const user = await this.provider.retrieveByToken(userId, token)
    if (!user) return false
    await this.session.regenerate()
    this.session.put('auth_user_id', user.getAuthIdentifier())
    this._user = user
    return true
  }

  async logout(): Promise<void> {
    // Cycle the remember token so every outstanding remember cookie for this
    // user stops working, then queue the cookie's deletion.
    const user = this._user ?? await this.user().catch(() => null)
    if (user && this.provider.updateRememberToken) {
      await this.provider.updateRememberToken(user.getAuthIdentifier(), newRememberToken())
    }
    setRememberDirective({ action: 'clear' })

    this.session.forget('auth_user_id')
    await this.session.regenerate()
    this._user = null
  }
}
