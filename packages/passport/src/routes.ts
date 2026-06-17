import { Passport } from './Passport.js'
import type { PassportRouteGroup, PassportRouteOptions, Router } from './routes/types.js'
import { asMiddlewareArray } from './routes/helpers.js'
import { registerAuthorizeRoutes } from './routes/authorize.js'
import { registerTokenRoute }     from './routes/token.js'
import { registerRevokeRoute }    from './routes/revoke.js'
import { registerRevocationRoute } from './routes/revocation.js'
import { registerScopesRoute }    from './routes/scopes.js'
import { registerDeviceRoutes }   from './routes/device.js'

export type { PassportRouteGroup, PassportRouteOptions } from './routes/types.js'

/**
 * Register all Passport OAuth routes on the given router.
 *
 * Becomes a no-op when `Passport.ignoreRoutes()` has been called — in that
 * case the application wires OAuth routes manually.
 *
 * @example
 * import { registerPassportRoutes } from '@rudderjs/passport'
 * registerPassportRoutes(router)
 *
 * @example
 * // Skip the built-in consent + scopes endpoints; mount your own
 * registerPassportRoutes(router, { except: ['authorize', 'scopes'] })
 */
export function registerPassportRoutes(router: Router, opts: PassportRouteOptions = {}): void {
  if (Passport.routesIgnored()) return

  const prefix = opts.prefix ?? '/oauth'
  const skip = new Set(opts.except ?? [])
  const tokenMiddleware     = asMiddlewareArray(opts.tokenMiddleware)
  const authorizeMiddleware = asMiddlewareArray(opts.authorizeMiddleware)
  const deviceMiddleware    = asMiddlewareArray(opts.deviceMiddleware)

  if (!skip.has('authorize'))  registerAuthorizeRoutes (router, prefix, authorizeMiddleware)
  if (!skip.has('token'))      registerTokenRoute      (router, prefix, tokenMiddleware)
  if (!skip.has('revoke'))     registerRevokeRoute     (router, prefix, authorizeMiddleware)
  // RFC 7009 revocation is a client-authenticated, stateless api-group endpoint
  // (like /oauth/token) — share the token rate limiter, which guards the same
  // client_secret brute-force surface.
  if (!skip.has('revocation')) registerRevocationRoute (router, prefix, tokenMiddleware)
  if (!skip.has('scopes'))     registerScopesRoute     (router, prefix)
  if (!skip.has('device'))     registerDeviceRoutes    (router, opts, prefix, deviceMiddleware)
}

/**
 * Register the **web-group** Passport routes — `GET/POST/DELETE
 * /oauth/authorize` (the consent flow) and `DELETE /oauth/tokens/:id`
 * (revoke). These endpoints depend on session + authenticated user
 * resolution, so they belong on the same router that handles your
 * application's logged-in pages.
 *
 * `POST /oauth/authorize` requires CSRF protection. The recommended
 * pattern is to mount `CsrfMiddleware` on the entire web group from
 * `bootstrap/app.ts` (`withMiddleware((m) => m.web(CsrfMiddleware()))`)
 * — that single hook covers /oauth/authorize plus every other
 * state-changing web route. Apps that don't have group-level CSRF can
 * use the per-route fallback via `authorizeMiddleware: [CsrfMiddleware()]`
 * — see PassportRouteOptions.authorizeMiddleware. Don't do both.
 *
 * Thin wrapper around `registerPassportRoutes(router, { except: ['token',
 * 'scopes', 'device', 'revocation'] })`. Use `registerPassportApiRoutes()`
 * for the stateless half (including RFC 7009 `POST /oauth/revoke`) on the api
 * group.
 */
export function registerPassportWebRoutes(router: Router, opts: PassportRouteOptions = {}): void {
  const except = new Set([...(opts.except ?? []), 'token', 'scopes', 'device', 'revocation'] as PassportRouteGroup[])
  registerPassportRoutes(router, { ...opts, except: Array.from(except) })
}

/**
 * Register the **api-group** Passport routes — `POST /oauth/token`,
 * `POST /oauth/revoke` (RFC 7009 token revocation), `POST /oauth/device/code`,
 * `POST /oauth/device/approve`, and `GET /oauth/scopes`. These endpoints are
 * stateless (machine-to-machine), so they belong on the api router alongside
 * your other JSON endpoints.
 *
 * `POST /oauth/token` is the canonical brute-force target — pass a rate
 * limiter via `tokenMiddleware`:
 *
 * ```ts
 * import { RateLimit } from '@rudderjs/middleware'
 * import { registerPassportApiRoutes } from '@rudderjs/passport'
 *
 * // routes/api.ts
 * registerPassportApiRoutes(router, {
 *   tokenMiddleware: [
 *     RateLimit.perMinute(10).by((req) => `${req.ip}:${req.body?.client_id}`),
 *   ],
 * })
 * ```
 *
 * Thin wrapper around `registerPassportRoutes(router, { except:
 * ['authorize', 'revoke'] })`. Use `registerPassportWebRoutes()` for the
 * stateful half on the web group.
 */
export function registerPassportApiRoutes(router: Router, opts: PassportRouteOptions = {}): void {
  const except = new Set([...(opts.except ?? []), 'authorize', 'revoke'] as PassportRouteGroup[])
  registerPassportRoutes(router, { ...opts, except: Array.from(except) })
}
