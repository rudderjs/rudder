import { AsyncLocalStorage } from 'node:async_hooks'
import type { Authenticatable, Guard, UserProvider } from './contracts.js'
import { SessionGuard, type SessionStore } from './session-guard.js'
import { EloquentUserProvider } from './providers.js'

// ─── Config ───────────────────────────────────────────────

export interface AuthGuardConfig {
  driver: 'session'
  provider: string
}

export interface AuthProviderConfig {
  driver: 'eloquent'
  model: unknown // Model class reference
}

export interface AuthConfig {
  defaults: {
    guard: string
  }
  guards: Record<string, AuthGuardConfig>
  providers: Record<string, AuthProviderConfig>
}

// ─── Auth Manager ─────────────────────────────────────────

export class AuthManager {
  constructor(
    public readonly config: AuthConfig,
    private readonly hashCheck: (plain: string, hashed: string) => Promise<boolean>,
    private readonly getSession: () => SessionStore,
  ) {}

  /**
   * Build a fresh Guard each call. We deliberately do NOT cache guards on
   * the manager: AuthManager is a process-wide DI singleton, and a cached
   * SessionGuard would keep `_user` populated across requests — once any
   * request signs in, every subsequent request would see that user as
   * "still logged in" even with an empty session. A new instance per call
   * scopes `_user` to the local that the handler stores, which is the
   * request-natural lifetime.
   */
  guard(name?: string): Guard {
    const guardName = name ?? this.config.defaults.guard

    const guardConfig = this.config.guards[guardName]
    if (!guardConfig) throw new Error(`[RudderJS Auth] Guard "${guardName}" is not defined.`)

    if (guardConfig.driver === 'session') {
      const provider = this.createProvider(guardConfig.provider)
      return new SessionGuard(provider, this.getSession())
    }

    throw new Error(`[RudderJS Auth] Guard driver "${guardConfig.driver}" is not supported.`)
  }

  // Default-guard convenience methods — match Laravel's AuthManager, which
  // proxies these through to the default guard so `auth()->user()` works
  // without an explicit `->guard()` call.

  attempt(credentials: Record<string, unknown>, remember?: boolean): Promise<boolean> {
    return this.guard().attempt(credentials, remember)
  }

  login(user: Authenticatable, remember?: boolean): Promise<void> {
    return this.guard().login(user, remember)
  }

  logout(): Promise<void> {
    return this.guard().logout()
  }

  user(): Promise<Authenticatable | null> {
    return this.guard().user()
  }

  id(): Promise<string | null> {
    return this.guard().id()
  }

  check(): Promise<boolean> {
    return this.guard().check()
  }

  guest(): Promise<boolean> {
    return this.guard().guest()
  }

  /**
   * Resolve a UserProvider by name, independent of any guard. Used by
   * non-session drivers (e.g. `@rudderjs/sanctum`) that need user lookup
   * without instantiating a SessionGuard. With no `name`, falls back to
   * the default guard's configured provider.
   */
  createProvider(name?: string): UserProvider {
    const providerName = name ?? this.config.guards[this.config.defaults.guard]?.provider
    if (!providerName) {
      throw new Error(
        `[RudderJS Auth] Cannot resolve a default provider — set "auth.guards.${this.config.defaults.guard}.provider" or pass an explicit name.`,
      )
    }

    const providerConfig = this.config.providers[providerName]
    if (!providerConfig) throw new Error(`[RudderJS Auth] User provider "${providerName}" is not defined.`)

    if (providerConfig.driver === 'eloquent') {
      return new EloquentUserProvider(
        providerConfig.model as Parameters<typeof EloquentUserProvider['prototype']['retrieveById']> extends never[] ? never : ConstructorParameters<typeof EloquentUserProvider>[0],
        this.hashCheck,
      )
    }

    throw new Error(`[RudderJS Auth] Provider driver "${providerConfig.driver}" is not supported.`)
  }
}

// ─── Request-scoped Auth (AsyncLocalStorage) ──────────────

// Routed through `globalThis` so duplicate bundles of `@rudderjs/auth` share
// one ALS instance. Vite/Rollup will sometimes inline auth-manager.js into
// multiple chunks of an SSR build (one per entry that imports `auth()` /
// `AuthMiddleware` from different code paths). Without this hoist,
// AuthMiddleware writes the manager into one ALS while `auth().user()` reads
// from another — handler sees "No auth context" even though the middleware ran.
const ALS_KEY = '__rudderjs_auth_als__'
const _alsGlobal = globalThis as Record<string, unknown>
const _als: AsyncLocalStorage<AuthManager> = (_alsGlobal[ALS_KEY] as AsyncLocalStorage<AuthManager> | undefined)
  ?? (() => { const a = new AsyncLocalStorage<AuthManager>(); _alsGlobal[ALS_KEY] = a; return a })()

export function runWithAuth<T>(manager: AuthManager, fn: () => T): T {
  return _als.run(manager, fn)
}

export function currentAuth(): AuthManager {
  const m = _als.getStore()
  if (!m) throw new Error('[RudderJS Auth] No auth context. Use AuthMiddleware.')
  return m
}

/**
 * Laravel-style helper — returns the current request's AuthManager.
 *
 * Mirrors Laravel's `auth()->user()`, `auth()->check()`, `auth()->guard('api')`.
 * Inside an HTTP handler (after AuthMiddleware has run) you can call:
 *
 *   await auth().user()
 *   await auth().check()
 *   await auth().guard('api').user()
 *
 * In non-HTTP contexts (CLI, queue, scheduler) you must still wrap the call
 * in `runWithAuth(manager, …)` yourself — there is no request pipeline to
 * populate the ALS context for you.
 */
export function auth(): AuthManager {
  return currentAuth()
}

// ─── Auth Facade ──────────────────────────────────────────

export class Auth {
  private static g(name?: string): Guard {
    return currentAuth().guard(name)
  }

  static guard(name: string): Guard {
    return currentAuth().guard(name)
  }

  static attempt(credentials: Record<string, unknown>, remember?: boolean): Promise<boolean> {
    return this.g().attempt(credentials, remember)
  }

  static login(user: Authenticatable, remember?: boolean): Promise<void> {
    return this.g().login(user, remember)
  }

  static logout(): Promise<void> {
    return this.g().logout()
  }

  static user(): Promise<Authenticatable | null> {
    return this.g().user()
  }

  static id(): Promise<string | null> {
    return this.g().id()
  }

  static check(): Promise<boolean> {
    return this.g().check()
  }

  static guest(): Promise<boolean> {
    return this.g().guest()
  }
}
