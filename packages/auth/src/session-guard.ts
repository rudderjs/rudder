import type { Authenticatable, Guard, UserProvider } from './contracts.js'

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

  async user(): Promise<Authenticatable | null> {
    if (this._user !== undefined) return this._user

    // Soft-fail when no session is in context (e.g. api route without
    // session middleware, or a CLI / worker call). Matches Laravel's
    // Auth::user() semantics — unauthenticated, not a hard error.
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

  async attempt(credentials: Record<string, unknown>, _remember?: boolean): Promise<boolean> {
    const user = await this.provider.retrieveByCredentials(credentials)
    if (!user) return false

    const valid = await this.provider.validateCredentials(user, credentials)
    if (!valid) return false

    await this.login(user)
    return true
  }

  async login(user: Authenticatable, _remember?: boolean): Promise<void> {
    await this.session.regenerate()
    this.session.put('auth_user_id', user.getAuthIdentifier())
    this._user = user
  }

  async logout(): Promise<void> {
    this.session.forget('auth_user_id')
    await this.session.regenerate()
    this._user = null
  }
}
