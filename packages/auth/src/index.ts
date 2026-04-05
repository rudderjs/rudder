import { ServiceProvider, type Application, app } from '@rudderjs/core'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import { AuthManager, Auth, runWithAuth, type AuthConfig } from './auth-manager.js'
import type { AuthUser } from './contracts.js'
import type { SessionStore } from './session-guard.js'

// ─── Module Augmentation ───────────────────────────────────

declare module '@rudderjs/contracts' {
  interface AppRequest {
    user?: AuthUser
  }
}

// ─── Re-exports ───────────────────────────────────────────

export { Auth } from './auth-manager.js'
export { AuthManager, runWithAuth } from './auth-manager.js'
export { SessionGuard } from './session-guard.js'
export { EloquentUserProvider, toAuthenticatable } from './providers.js'
export { Gate, Policy, AuthorizationError } from './gate.js'
export { PasswordBroker, MemoryTokenRepository } from './password-reset.js'

export type { Authenticatable, AuthUser, Guard, UserProvider } from './contracts.js'
export type { TokenRepository, PasswordResetStatus, PasswordResetConfig } from './password-reset.js'
export type { AuthConfig, AuthGuardConfig, AuthProviderConfig } from './auth-manager.js'
export type { SessionStore } from './session-guard.js'

// ─── Helpers ──────────────────────────────────────────────

function userToPlain(user: unknown): AuthUser {
  const u = user as Record<string, unknown>
  const plain: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(u)) {
    if (typeof v === 'function') continue
    if (k === 'password') continue
    plain[k] = v
  }
  return {
    id:    String(plain['id'] ?? ''),
    name:  String(plain['name'] ?? ''),
    email: String(plain['email'] ?? ''),
    ...plain,
  }
}

// ─── Auth Middleware ──────────────────────────────────────

/**
 * Middleware that sets up the Auth context for the current request.
 * Attaches `req.user` if authenticated (does not block unauthenticated requests).
 */
export function AuthMiddleware(guardName?: string): MiddlewareHandler {
  return async function AuthMiddleware(req, res, next) {
    const manager = app().make<AuthManager>('auth.manager')

    await runWithAuth(manager, async () => {
      const guard = Auth.guard(guardName ?? (manager as unknown as { config: AuthConfig }).config.defaults.guard)
      const user = await guard.user()

      if (user) {
        const plain = userToPlain(user)
        ;(req as unknown as Record<string, unknown>)['user'] = plain
        ;(req.raw as Record<string, unknown>)['__rjs_user'] = plain
      }

      await next()
    })
  }
}

/**
 * Middleware that requires authentication — returns 401 if not authenticated.
 */
export function RequireAuth(guardName?: string): MiddlewareHandler {
  return async function RequireAuth(req, res, next) {
    const manager = app().make<AuthManager>('auth.manager')

    await runWithAuth(manager, async () => {
      const guard = Auth.guard(guardName ?? (manager as unknown as { config: AuthConfig }).config.defaults.guard)
      const user = await guard.user()

      if (!user) {
        res.status(401).json({ message: 'Unauthorized.' })
        return
      }

      const plain = userToPlain(user)
      ;(req as unknown as Record<string, unknown>)['user'] = plain
      ;(req.raw as Record<string, unknown>)['__rjs_user'] = plain

      await next()
    })
  }
}

// ─── Service Provider Factory ─────────────────────────────

/**
 * Returns an AuthServiceProvider configured with guards + providers.
 *
 * Requires: @rudderjs/session (session middleware), @rudderjs/hash
 *
 * Usage in bootstrap/providers.ts:
 *   import { auth } from '@rudderjs/auth'
 *   export default [session(configs.session), hash(configs.hash), auth(configs.auth), ...]
 */
export function auth(config: AuthConfig): new (app: Application) => ServiceProvider {
  class AuthServiceProvider extends ServiceProvider {
    register(): void {
      // Auth pages (framework-specific)
      this.publishes({ from: new URL(/* @vite-ignore */ '../pages/react', import.meta.url).pathname, to: 'pages/(auth)', tag: 'auth-pages' })
      this.publishes({ from: new URL(/* @vite-ignore */ '../pages/react', import.meta.url).pathname, to: 'pages/(auth)', tag: 'auth-pages-react' })
      this.publishes({ from: new URL(/* @vite-ignore */ '../pages/vue',   import.meta.url).pathname, to: 'pages/(auth)', tag: 'auth-pages-vue' })
      this.publishes({ from: new URL(/* @vite-ignore */ '../pages/solid', import.meta.url).pathname, to: 'pages/(auth)', tag: 'auth-pages-solid' })

      // Auth schema (ORM + driver-specific)
      const schemaDir = new URL(/* @vite-ignore */ '../schema', import.meta.url).pathname
      this.publishes([
        { from: `${schemaDir}/auth.prisma`,            to: 'prisma/schema',   tag: 'auth-schema', orm: 'prisma' as const },
        { from: `${schemaDir}/auth.drizzle.sqlite.ts`, to: 'database/schema', tag: 'auth-schema', orm: 'drizzle' as const, driver: 'sqlite' as const },
        { from: `${schemaDir}/auth.drizzle.pg.ts`,     to: 'database/schema', tag: 'auth-schema', orm: 'drizzle' as const, driver: 'postgresql' as const },
        { from: `${schemaDir}/auth.drizzle.mysql.ts`,  to: 'database/schema', tag: 'auth-schema', orm: 'drizzle' as const, driver: 'mysql' as const },
      ])
    }

    async boot(): Promise<void> {
      // Resolve Hash.check from DI
      let hashCheck: (plain: string, hashed: string) => Promise<boolean>
      try {
        const hashDriver = this.app.make<{ check(v: string, h: string): Promise<boolean> }>('hash')
        hashCheck = (plain, hashed) => hashDriver.check(plain, hashed)
      } catch {
        throw new Error(
          '[RudderJS Auth] No hash driver found. Register hash() provider before auth().',
        )
      }

      // Resolve session accessor
      const getSession = (): SessionStore => {
        try {
          return this.app.make<SessionStore>('session.instance')
        } catch {
          return this.app.make<SessionStore>('session.facade')
        }
      }

      const manager = new AuthManager(config, hashCheck, getSession)
      this.app.instance('auth.manager', manager)
      this.app.instance('auth', Auth)
    }
  }

  return AuthServiceProvider
}
