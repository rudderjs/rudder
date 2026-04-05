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
  private readonly _guards = new Map<string, Guard>()

  constructor(
    private readonly config: AuthConfig,
    private readonly hashCheck: (plain: string, hashed: string) => Promise<boolean>,
    private readonly getSession: () => SessionStore,
  ) {}

  guard(name?: string): Guard {
    const guardName = name ?? this.config.defaults.guard
    const existing = this._guards.get(guardName)
    if (existing) return existing

    const guardConfig = this.config.guards[guardName]
    if (!guardConfig) throw new Error(`[RudderJS Auth] Guard "${guardName}" is not defined.`)

    const provider = this.createProvider(guardConfig.provider)
    let guard: Guard

    if (guardConfig.driver === 'session') {
      guard = new SessionGuard(provider, this.getSession())
    } else {
      throw new Error(`[RudderJS Auth] Guard driver "${guardConfig.driver}" is not supported.`)
    }

    this._guards.set(guardName, guard)
    return guard
  }

  private createProvider(name: string): UserProvider {
    const providerConfig = this.config.providers[name]
    if (!providerConfig) throw new Error(`[RudderJS Auth] User provider "${name}" is not defined.`)

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

const _als = new AsyncLocalStorage<AuthManager>()

export function runWithAuth<T>(manager: AuthManager, fn: () => T): T {
  return _als.run(manager, fn)
}

export function currentAuth(): AuthManager {
  const m = _als.getStore()
  if (!m) throw new Error('[RudderJS Auth] No auth context. Use AuthMiddleware.')
  return m
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
