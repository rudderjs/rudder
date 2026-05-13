import type { MiddlewareHandler } from '@rudderjs/contracts'

/**
 * Minimal handler signature. Kept `any`-typed because passport routes are
 * mounted on arbitrary Router implementations (Hono adapter, express-style,
 * test fakes) — pinning a concrete request/response type here would force
 * downstream casts everywhere a handler is implemented.
 */
export type RouteHandler = (req: any, res: any) => Promise<any> | any

/**
 * Minimal Router contract passport's `register*Routes()` functions accept.
 * The `@rudderjs/router` instance satisfies this, as do simple test fakes —
 * we don't import the concrete class here to keep this package usable from
 * apps that bring their own router.
 */
export interface Router {
  get(path: string, handler: RouteHandler, ...middleware: any[]): void
  post(path: string, handler: RouteHandler, ...middleware: any[]): void
  delete(path: string, handler: RouteHandler, ...middleware: any[]): void
}

/** Groups of routes that can be selectively excluded. */
export type PassportRouteGroup =
  | 'authorize'  // GET/POST/DELETE /oauth/authorize
  | 'token'      // POST /oauth/token
  | 'revoke'     // DELETE /oauth/tokens/:id
  | 'scopes'     // GET /oauth/scopes
  | 'device'     // POST /oauth/device/code + /oauth/device/approve

export interface PassportRouteOptions {
  /** Base path for OAuth routes (default: '/oauth') */
  prefix?: string
  /** Verification URI for device auth (default: '{origin}/oauth/device') */
  verificationUri?: string
  /** Route groups to skip when registering. */
  except?: PassportRouteGroup[]
  /**
   * Middleware applied to `POST /oauth/token`. The token endpoint is the
   * canonical brute-force target for client_secret guessing — every
   * production app SHOULD mount a per-route rate limiter here.
   *
   * Recommended setup:
   *
   * ```ts
   * import { RateLimit } from '@rudderjs/middleware'
   * import { registerPassportRoutes } from '@rudderjs/passport'
   *
   * registerPassportRoutes(router, {
   *   tokenMiddleware: [
   *     RateLimit.perMinute(10).by((req) => `${req.ip}:${req.body?.client_id}`),
   *   ],
   * })
   * ```
   *
   * The composite key (`ip + client_id`) prevents one noisy client from
   * exhausting the budget for legitimate co-tenants behind a shared NAT,
   * and prevents a single IP from churning through every client_id in the
   * registry. RateLimit also requires a cache provider to be registered —
   * see `@rudderjs/cache`. Without one the middleware silently passes
   * through.
   *
   * Accepts a single handler or an array. Empty / omitted means no
   * additional middleware is applied (the same as before this option
   * existed).
   */
  tokenMiddleware?: MiddlewareHandler | MiddlewareHandler[]
  /**
   * Middleware applied to the consent endpoints — `GET/POST/DELETE
   * /oauth/authorize` and `DELETE /oauth/tokens/:id`. POST /oauth/authorize
   * is the canonical CSRF target (an attacker page that auto-submits a
   * hidden form would mint authorization codes for the victim's logged-in
   * session).
   *
   * Most apps should NOT use this option. The recommended pattern is to
   * mount CSRF on the entire web group from `bootstrap/app.ts`:
   *
   * ```ts
   * .withMiddleware((m) => m.web(CsrfMiddleware()))
   * ```
   *
   * which automatically covers `/oauth/authorize` along with every other
   * state-changing web route. `authorizeMiddleware` is the per-route
   * fallback for apps that do NOT mount CSRF at the group level:
   *
   * ```ts
   * import { CsrfMiddleware } from '@rudderjs/middleware'
   * import { registerPassportWebRoutes } from '@rudderjs/passport'
   *
   * registerPassportWebRoutes(router, {
   *   authorizeMiddleware: [CsrfMiddleware()],
   * })
   * ```
   *
   * Don't do both — CsrfMiddleware running twice on the same request
   * emits duplicate `Set-Cookie`s on GETs and runs validation twice on
   * POSTs.
   *
   * Accepts a single handler or an array. Empty / omitted means no
   * additional middleware is applied — the typical case for apps that
   * already CSRF-guard at the group level.
   */
  authorizeMiddleware?: MiddlewareHandler | MiddlewareHandler[]
  /**
   * Middleware applied to the device-flow endpoints — `POST /oauth/device/code`
   * and `POST /oauth/device/approve`. RFC 8628 §5.2 calls for brute-force
   * protection on the user_code surface (8-char alphabet → 32^8 ≈ 1.1×10^12
   * keyspace; per-IP throttling makes exhaustion infeasible).
   *
   * Most apps should NOT need this option. The recommended pattern is to
   * mount a rate limiter on the entire api group from `bootstrap/app.ts`
   * (`withMiddleware((m) => m.api(RateLimit.perMinute(60)))`) — that single
   * hook covers the device endpoints alongside every other api route, and
   * 60/min per-IP is already enough that exhausting the user_code keyspace
   * would take tens of thousands of years.
   *
   * `deviceMiddleware` is the per-route fallback for apps that want a
   * tighter device-specific limit (e.g. `RateLimit.perMinute(5)`) on top of
   * — or in place of — the group default:
   *
   * ```ts
   * import { RateLimit } from '@rudderjs/middleware'
   * import { registerPassportApiRoutes } from '@rudderjs/passport'
   *
   * registerPassportApiRoutes(router, {
   *   deviceMiddleware: [RateLimit.perMinute(5).by((req) => req.ip)],
   * })
   * ```
   *
   * Layered limits compose in sequence — group + per-route both run, with
   * the tightest budget winning. Locking individual user_codes after N
   * misses (the stateful half of the original RFC 8628 §5.2 guidance)
   * isn't covered by RateLimit; if you need it, wrap your own middleware.
   *
   * Accepts a single handler or an array. Empty / omitted means no
   * additional middleware is applied — the typical case for apps that
   * already throttle the api group.
   */
  deviceMiddleware?: MiddlewareHandler | MiddlewareHandler[]
}
