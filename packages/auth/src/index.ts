import { fileURLToPath } from 'node:url'
import { ServiceProvider, app, config, appendToGroup } from '@rudderjs/core'
import { REQUEST_CONTEXT } from '@rudderjs/contracts'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import { AuthManager, Auth, runWithAuth, runWithTestUser, type AuthConfig } from './auth-manager.js'
import type { Authenticatable } from './contracts.js'
import type { AuthUser } from './contracts.js'
import type { SessionGuard, SessionStore } from './session-guard.js'
import {
  runWithRemember,
  takeRememberDirective,
  rememberCookieAttrs,
  resolveRememberSecret,
  encodeRememberCookie,
  decodeRememberCookie,
  buildRememberCookie,
  parseCookie,
} from './remember.js'

interface HonoContextLike {
  header(k: string, v: string): void
  res?: Response
}

/** Append a `Set-Cookie` on the response, preserving any cookies earlier
 *  middleware wrote (same multi-cookie-safe pattern as @rudderjs/session). */
function writeResponseCookie(res: { raw: unknown }, cookieStr: string): void {
  const c = res.raw as HonoContextLike
  if (c.res) c.res.headers.append('Set-Cookie', cookieStr)
  else c.header('Set-Cookie', cookieStr)
}

// ─── Module Augmentation ───────────────────────────────────

declare module '@rudderjs/contracts' {
  interface AppRequest {
    user?: AuthUser
  }
}

// Pulls in the Vike.PageContext.user augmentation so app code can read
// `pageContext.user` with full typing when this package is installed.
import './types/vike.js'

// ─── Re-exports ───────────────────────────────────────────

export { Auth, auth } from './auth-manager.js'
export { AuthManager, runWithAuth, currentAuth, runWithTestUser, currentTestUser } from './auth-manager.js'
export { SessionGuard } from './session-guard.js'
export { EloquentUserProvider, toAuthenticatable } from './providers.js'
export { Gate, Policy, AuthorizationError } from './gate.js'
export { PasswordBroker, MemoryTokenRepository } from './password-reset.js'
export { EnsureEmailIsVerified, verificationUrl, handleEmailVerification, mustVerifyEmail } from './verification.js'
export { RequireGuest } from './require-guest.js'
export {
  newRememberToken,
  encodeRememberCookie,
  decodeRememberCookie,
  rememberCookieAttrs,
} from './remember.js'
export type { RememberCookieAttrs, RememberDirective } from './remember.js'
export { BaseAuthController, DEFAULT_AUTH_RATE_LIMITS } from './base-auth-controller.js'
export type { AuthUserModelLike, AuthHashLike, AuthRateLimits } from './base-auth-controller.js'

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
  const fn: MiddlewareHandler = async function AuthMiddleware(req, res, next) {
    const manager = app().make<AuthManager>('auth.manager')
    const resolvedGuard = guardName ?? (manager as unknown as { config: AuthConfig }).config.defaults.guard

    const rawReq = req.raw as Record<string, unknown>
    const session = rawReq['__rjs_session'] as { get(k: string): unknown } | undefined

    // Test-mode short-circuit — `@rudderjs/testing`'s `actingAs(user)` writes a
    // JSON-serialized user into `x-testing-user`. In testing mode we honor it:
    // populate `req.user` directly AND install the user into the request's ALS
    // scope (via `runWithTestUser`) so `Auth.guard().user()`, `auth().user()`,
    // and `RequireAuth` resolve to the same synthetic user — even one that
    // doesn't exist in the database. Gated on `APP_ENV === 'testing'` so prod
    // never sees this branch.
    if (process.env.APP_ENV === 'testing') {
      const testUserRaw = req.headers['x-testing-user']
      if (typeof testUserRaw === 'string' && testUserRaw.length > 0) {
        try {
          const parsed = JSON.parse(testUserRaw) as Record<string, unknown>
          // Wrap as Authenticatable — adds the `getAuthIdentifier()` contract
          // method around the plain JSON payload from the test client.
          const testUser: Authenticatable = {
            ...parsed,
            getAuthIdentifier: () => String(parsed['id'] ?? ''),
          } as Authenticatable
          const plain = userToPlain(testUser)
          rawReq['__rjs_user'] = plain
          try { (req as unknown as Record<string, unknown>)['user'] = plain } catch { /* read-only */ }

          return runWithTestUser(testUser, () =>
            runWithAuth(manager, () => next()),
          )
        } catch {
          // Bad JSON in x-testing-user — fall through to the normal flow.
        }
      }
    }

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

    // Flush a queued remember directive (set on login(…, true) / logout) to the
    // response cookie. Runs inside the remember ALS scope established below.
    const attrs = rememberCookieAttrs()
    const flushRemember = () => {
      const directive = takeRememberDirective()
      if (!directive) return
      if (directive.action === 'set') {
        // resolveRememberSecret throws in production without AUTH_SECRET — the
        // app explicitly opted into remember-me, so surface that.
        const value = encodeRememberCookie(directive.userId, directive.token, resolveRememberSecret())
        writeResponseCookie(res, buildRememberCookie(value, attrs))
      } else {
        writeResponseCookie(res, buildRememberCookie(null, attrs))
      }
    }

    await runWithRemember(() => runWithAuth(manager, async () => {
      // No active session — try to resume one from a remember cookie before the
      // handler runs, so `req.user` / `Auth.user()` resolve as usual.
      let initialUid = session?.get('auth_user_id') as string | undefined
      if (!initialUid) {
        const rememberRaw = parseCookie(req.headers['cookie'] ?? '', attrs.cookie)
        if (rememberRaw) {
          // Resolve the signing secret; if it's unavailable (prod without
          // AUTH_SECRET) we can't verify the cookie, so fail closed.
          let secret: string | null
          try { secret = resolveRememberSecret() } catch { secret = null }
          const decoded = secret ? decodeRememberCookie(rememberRaw, secret) : null
          if (decoded) {
            const guard = Auth.guard(resolvedGuard) as unknown as SessionGuard
            try { await guard.loginViaRememberCookie?.(decoded.userId, decoded.token) }
            catch { /* a DB hiccup during auto-login must not 500 the request */ }
            initialUid = session?.get('auth_user_id') as string | undefined
          }
        }
      }

      // Initial sync so the handler sees req.user (fetches only if session has auth_user_id).
      if (initialUid) await syncUser()

      // try/finally so a handler that signs the user in (or out) and then
      // throws still produces a consistent `req.user` snapshot for the error
      // renderer — without it the sync block was skipped and the renderer
      // saw stale (or empty) auth state.
      let handlerError: unknown
      let handlerThrew = false
      try {
        await next()
      } catch (err) {
        handlerError = err
        handlerThrew = true
      }

      const finalUid = session?.get('auth_user_id') as string | undefined
      if (finalUid !== initialUid) {
        try {
          if (finalUid) await syncUser()
          else {
            delete rawReq['__rjs_user']
            try { delete (req as unknown as Record<string, unknown>)['user'] } catch { /* read-only */ }
          }
        } catch (syncErr) {
          // Never let a sync failure mask the original handler error; only
          // surface the sync error when the handler itself succeeded.
          if (!handlerThrew) throw syncErr
        }
      }

      // Write any queued remember cookie (login/logout during the handler) to
      // the response, even when the handler threw — same posture as session
      // save. A flush error is only surfaced when the handler itself succeeded.
      try { flushRemember() } catch (flushErr) { if (!handlerThrew) throw flushErr }

      if (handlerThrew) throw handlerError
    }))
  }

  // Tag as a request-scoped-context middleware. The framework's WS-upgrade
  // context runner runs only REQUEST_CONTEXT-tagged web middleware around a
  // sync `onAuth` callback, so `Auth.user()` resolves on an upgrade exactly as
  // in an HTTP handler (without CSRF / rate-limit / app middleware running).
  ;(fn as unknown as Record<symbol, unknown>)[REQUEST_CONTEXT] = true
  return fn
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
    this.publishes({ from: fileURLToPath(new URL(/* @vite-ignore */ '../views/react', import.meta.url)), to: 'app/Views/Auth', tag: 'auth-views' })
    this.publishes({ from: fileURLToPath(new URL(/* @vite-ignore */ '../views/react', import.meta.url)), to: 'app/Views/Auth', tag: 'auth-views-react' })

    // Auth schema (ORM + driver-specific)
    const schemaDir = fileURLToPath(new URL(/* @vite-ignore */ '../schema', import.meta.url))
    this.publishes([
      { from: `${schemaDir}/auth.prisma`,            to: 'prisma/schema',   tag: 'auth-schema', orm: 'prisma' as const },
      { from: `${schemaDir}/auth.drizzle.sqlite.ts`, to: 'database/schema', tag: 'auth-schema', orm: 'drizzle' as const, driver: 'sqlite' as const },
      { from: `${schemaDir}/auth.drizzle.pg.ts`,     to: 'database/schema', tag: 'auth-schema', orm: 'drizzle' as const, driver: 'postgresql' as const },
      { from: `${schemaDir}/auth.drizzle.mysql.ts`,  to: 'database/schema', tag: 'auth-schema', orm: 'drizzle' as const, driver: 'mysql' as const },
    ])
  }

  async boot(): Promise<void> {
    const cfg = config<AuthConfig>('auth')

    // Resolve Hash.check + Hash.make from DI
    let hashCheck: (plain: string, hashed: string) => Promise<boolean>
    let hashMake:  (plain: string) => Promise<string>
    try {
      const hashDriver = this.app.make<{ check(v: string, h: string): Promise<boolean>; make(v: string): Promise<string> }>('hash')
      hashCheck = (plain, hashed) => hashDriver.check(plain, hashed)
      hashMake  = (plain) => hashDriver.make(plain)
    } catch {
      throw new Error(
        '[RudderJS Auth] No hash driver found. Register HashProvider before AuthProvider.',
      )
    }

    // Resolve session facade — bound by @rudderjs/session as 'session.facade'
    const getSession = (): SessionStore => {
      return this.app.make<SessionStore>('session.facade')
    }

    const manager = new AuthManager(cfg, hashCheck, getSession, hashMake)
    this.app.instance('auth.manager', manager)
    this.app.instance('auth', Auth)

    // Install AuthMiddleware on the `web` group only — it needs session
    // context (SessionGuard) and is irrelevant to stateless API routes.
    // API routes opt into bearer auth with `RequireBearer()` from @rudderjs/passport
    // or `RequireAuth('api')` with a token-based guard.
    appendToGroup('web', AuthMiddleware())

    // Register a Vike page-context enhancer that exposes the current user
    // on `pageContext.user`. `@rudderjs/vite` is an optional peer — apps
    // without it (e.g. API-only services) silently skip this registration.
    await registerVikeUserEnhancer()
  }
}

async function registerVikeUserEnhancer(): Promise<void> {
  try {
    const mod = await import('@rudderjs/vite/page-context-enhancers').catch(() => null) as
      | { registerPageContextEnhancer?: (fn: (pc: { user?: AuthUser | null }) => Promise<void> | void) => void }
      | null
    if (!mod?.registerPageContextEnhancer) return

    mod.registerPageContextEnhancer(async (pageContext) => {
      try {
        const u = await Auth.user()
        pageContext.user = u ? userToPlain(u) : null
      } catch {
        pageContext.user = null
      }
    })
  } catch {
    // Optional peer not installed — quietly skip.
  }
}
