import { ServiceProvider, app, config, appendToGroup } from '@rudderjs/core'
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

export { Auth, auth } from './auth-manager.js'
export { AuthManager, runWithAuth, currentAuth } from './auth-manager.js'
export { SessionGuard } from './session-guard.js'
export { EloquentUserProvider, toAuthenticatable } from './providers.js'
export { Gate, Policy, AuthorizationError } from './gate.js'
export { PasswordBroker, MemoryTokenRepository } from './password-reset.js'
export { EnsureEmailIsVerified, verificationUrl, handleEmailVerification, mustVerifyEmail } from './verification.js'
export { RequireGuest } from './require-guest.js'
export { BaseAuthController } from './base-auth-controller.js'
export type { AuthUserModelLike, AuthHashLike } from './base-auth-controller.js'

export type { Authenticatable, AuthUser, Guard, UserProvider } from './contracts.js'
export type { MustVerifyEmail } from './verification.js'
export type { TokenRepository, PasswordResetStatus, PasswordResetConfig } from './password-reset.js'
export type { AuthConfig, AuthGuardConfig, AuthProviderConfig } from './auth-manager.js'
export type { SessionStore } from './session-guard.js'

// ─── Helpers ──────────────────────────────────────────────

/**
 * Always-stripped column names. `password` is the obvious one; both
 * naming conventions for the remember-me token (`rememberToken` from our
 * Prisma schema, `remember_token` from Drizzle / raw Laravel schemas)
 * are stripped because either may appear depending on the ORM and
 * column-mapping choices. App-specific sensitive columns
 * (`two_factor_secret`, `email_verification_token`, …) should be added
 * via `Authenticatable.getHidden()`.
 */
const ALWAYS_HIDDEN = new Set(['password', 'rememberToken', 'remember_token'])

/**
 * Serialize an `Authenticatable` for `req.user`. Drops:
 *   - all functions (so prototype methods don't leak across the request boundary)
 *   - the always-hidden columns above
 *   - any column listed by the user's optional `getHidden()` method
 */
export function userToPlain(user: unknown): AuthUser {
  const u = user as Record<string, unknown>
  const hidden = new Set(ALWAYS_HIDDEN)
  const getHidden = (u['getHidden'] as undefined | (() => string[]))
  if (typeof getHidden === 'function') {
    for (const k of getHidden.call(u)) hidden.add(k)
  }
  const plain: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(u)) {
    if (typeof v === 'function') continue
    if (hidden.has(k)) continue
    plain[k] = v
  }
  // Spread first so the explicit String(...) conversions below always win on
  // collision. The previous order had `...plain` last, which silently kept a
  // numeric `id: 42` instead of the string '42' the AuthUser type promises.
  return {
    ...plain,
    id:    String(plain['id'] ?? ''),
    name:  String(plain['name'] ?? ''),
    email: String(plain['email'] ?? ''),
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
    const resolvedGuard = guardName ?? (manager as unknown as { config: AuthConfig }).config.defaults.guard

    const rawReq = req.raw as Record<string, unknown>
    const session = rawReq['__rjs_session'] as { get(k: string): unknown } | undefined

    const syncUser = async () => {
      const user = await Auth.guard(resolvedGuard).user()
      if (user) {
        const plain = userToPlain(user)
        rawReq['__rjs_user'] = plain
        try { (req as unknown as Record<string, unknown>)['user'] = plain } catch { /* read-only */ }
      } else {
        delete rawReq['__rjs_user']
        try { delete (req as unknown as Record<string, unknown>)['user'] } catch { /* read-only */ }
      }
    }

    await runWithAuth(manager, async () => {
      // Initial sync so the handler sees req.user (fetches only if session has auth_user_id).
      const initialUid = session?.get('auth_user_id') as string | undefined
      if (initialUid) await syncUser()

      await next()

      // Re-sync only if auth_user_id changed during the handler (sign-in / sign-out).
      // Avoids a duplicate User SELECT on every authenticated page load.
      const finalUid = session?.get('auth_user_id') as string | undefined
      if (finalUid !== initialUid) {
        if (finalUid) await syncUser()
        else {
          delete rawReq['__rjs_user']
          try { delete (req as unknown as Record<string, unknown>)['user'] } catch { /* read-only */ }
        }
      }
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
      ;(req.raw as Record<string, unknown>)['__rjs_user'] = plain
      try { (req as unknown as Record<string, unknown>)['user'] = plain } catch { /* read-only */ }

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
 *   import { authProvider } from '@rudderjs/auth'
 *   export default [session(configs.session), hash(configs.hash), authProvider(configs.auth), ...]
 *
 * Note: the lowercase `auth()` helper is a different export — it returns the
 * current request's AuthManager (Laravel's `auth()->user()` ergonomics).
 */
export class AuthProvider extends ServiceProvider {
  register(): void {
    // Auth views — vendored into the consumer's `app/Views/Auth/` directory.
    // Consumers then wire routes via `registerAuthRoutes(Route)` from `@rudderjs/auth/routes`.
    this.publishes({ from: new URL(/* @vite-ignore */ '../views/react', import.meta.url).pathname, to: 'app/Views/Auth', tag: 'auth-views' })
    this.publishes({ from: new URL(/* @vite-ignore */ '../views/react', import.meta.url).pathname, to: 'app/Views/Auth', tag: 'auth-views-react' })

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
    const cfg = config<AuthConfig>('auth')

    // Resolve Hash.check from DI
    let hashCheck: (plain: string, hashed: string) => Promise<boolean>
    try {
      const hashDriver = this.app.make<{ check(v: string, h: string): Promise<boolean> }>('hash')
      hashCheck = (plain, hashed) => hashDriver.check(plain, hashed)
    } catch {
      throw new Error(
        '[RudderJS Auth] No hash driver found. Register HashProvider before AuthProvider.',
      )
    }

    // Resolve session facade — bound by @rudderjs/session as 'session.facade'
    const getSession = (): SessionStore => {
      return this.app.make<SessionStore>('session.facade')
    }

    const manager = new AuthManager(cfg, hashCheck, getSession)
    this.app.instance('auth.manager', manager)
    this.app.instance('auth', Auth)

    // Install AuthMiddleware on the `web` group only — it needs session
    // context (SessionGuard) and is irrelevant to stateless API routes.
    // API routes opt into bearer auth with `RequireBearer()` from @rudderjs/passport
    // or `RequireAuth('api')` with a token-based guard.
    appendToGroup('web', AuthMiddleware())
  }
}
