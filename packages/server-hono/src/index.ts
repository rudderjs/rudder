import { Hono, type Context } from 'hono'
import type { StatusCode, RedirectStatusCode } from 'hono/utils/http-status'
import { renderErrorPage } from './error-page.js'
import { serve } from '@hono/node-server'
import http from 'node:http'
import { B, startRequest, markBoundary, finishRequest, runWithRequest, currentPerfId } from './perf-boundaries.js'

// ─── WebSocket upgrade handler for production ──────────────
// Monkey-patch http.createServer at module load time so that any HTTP server
// created after providers boot gets the WS upgrade handler attached.
// In dev, the @rudderjs/vite plugin does the same.
//
// IMPORTANT: Skip the patch if @rudderjs/vite has already patched http.createServer.
// Otherwise both patches would attach listeners, causing handleUpgrade() to be
// called twice for the same socket ("called more than once" error in dev mode).
const _G = globalThis as Record<string, unknown>
if (!_G['__rudderjs_http_upgrade_patched__']) {
  _G['__rudderjs_http_upgrade_patched__'] = true
  const _origCreateServer = http.createServer.bind(http)
  http.createServer = ((...args: Parameters<typeof http.createServer>) => {
    const srv = (_origCreateServer as (...a: unknown[]) => import('node:http').Server)(...args)
    srv.on('upgrade', (req: unknown, socket: unknown, head: unknown) => {
      const handler = _G['__rudderjs_ws_upgrade__'] as
        | ((req: unknown, socket: unknown, head: unknown) => void)
        | undefined
      handler?.(req, socket, head)
    })
    return srv
  }) as typeof http.createServer
}
import type {
  ServerAdapter,
  ServerAdapterProvider,
  FetchHandler,
  RouteDefinition,
  MiddlewareHandler,
  AppRequest,
  AppResponse,
} from '@rudderjs/contracts'
import { attachInputAccessors } from '@rudderjs/contracts'

// ─── ViewResponse duck-type check ──────────────────────────
// Detects @rudderjs/view ViewResponse instances without importing the package.
// The constructor's static `__rudder_view__ === true` marker is the contract.
interface ViewResponseLike {
  toResponse(ctx: { url: string }): Promise<Response>
}
function isViewResponse(value: unknown): value is ViewResponseLike {
  if (value === null || typeof value !== 'object') return false
  const ctor = (value as { constructor?: { __rudder_view__?: unknown } }).constructor
  return ctor?.__rudder_view__ === true && typeof (value as ViewResponseLike).toResponse === 'function'
}

// ─── Hono Adapter Config ───────────────────────────────────

export interface HonoConfig {
  /** Port to listen on when using listen() — default 3000 */
  port?: number
  /** Trust X-Forwarded-* headers from proxies */
  trustProxy?: boolean
  /** CORS options applied as a global middleware */
  cors?: {
    origin?:  string
    methods?: string
    headers?: string
  }
}

// ─── Hono Context stash ────────────────────────────────────
//
// Per-request augmentations (`__rjs_body`, `__rjs_session`, `__rjs_user`,
// `__rjs_token`, `__rjs_host_params`, `__rjs_response_body`,
// `__rjs_merge_pending`) live on the Hono `Context` so the same value is
// visible across the two normalizeRequest(c) calls (applyMiddleware ↔
// registerRoute). Hono's typed Context doesn't expose these custom keys, so
// reads/writes go through this typed view.

type HonoCtxStash = Context & Record<string, unknown>

/** @internal — one place to do the structural widening from Context. */
const stash = (c: Context): HonoCtxStash => c as HonoCtxStash

// ─── Request Normalizer ────────────────────────────────────

function normalizeIp(ip: string): string {
  return ip === '::1' || ip === '::ffff:127.0.0.1' ? '127.0.0.1' : ip
}

/**
 * Extract the client IP from proxy headers. Reads `x-forwarded-for` (taking
 * the first hop) then `x-real-ip`. Returns `undefined` when `trustProxy` is
 * false or no proxy header is present — never falls back to the socket
 * address, which would be the proxy's IP and is almost always wrong.
 *
 * In dev, `@rudderjs/vite`'s `rudderjs:ip` plugin injects `x-real-ip` from
 * `req.socket.remoteAddress` before universal-middleware converts the Node
 * request to a Web Request, so dev sees the real client IP via the same path
 * as prod-behind-proxy.
 *
 * `::1` and `::ffff:127.0.0.1` are normalized to `127.0.0.1`.
 */
function extractIp(c: Context, trustProxy: boolean): string | undefined {
  if (!trustProxy) return undefined
  // x-forwarded-for / x-real-ip (reverse proxy, or injected by rudderjs:ip vite plugin)
  const xff = c.req.header('x-forwarded-for')
  if (xff) return normalizeIp(xff.split(',')[0]!.trim())
  const xri = c.req.header('x-real-ip')
  if (xri) return normalizeIp(xri)
  return undefined
}

/**
 * Build an `AppRequest` from a Hono context.
 *
 * Called twice per request — once by `applyMiddleware()` and once by
 * `registerRoute()` — both passing the same Hono context. Per-request
 * augmentations (`body`, `session`, `user`, `token`) are stored on `c` under
 * `__rjs_*` keys and exposed as **getters** on each `req` object, so a value
 * set during middleware is visible to the route handler even though the two
 * `req` objects are distinct instances.
 *
 * **Plain property assignment on `req` does NOT cross between the two calls.**
 * Middleware that needs to share state with the route handler must either
 * (a) write via the dedicated setters (`req.body = ...` is wired through a
 * setter that stashes onto `c`) or (b) stash directly on `c.req.raw` /
 * `c.set()`. Adding a new shared field requires both a getter here and a
 * matching `c`-stash from the writer side.
 *
 * `params` merges `__rjs_host_params` (captured by `host` route templates)
 * with path params; path params win on collision.
 */
function normalizeRequest(c: Context, trustProxy = false): AppRequest {
  const url = new URL(c.req.url)
  // Subdomain params captured by the route's `host` template are stashed by
  // registerRoute() before the chain runs. Merge them into `req.params` so
  // bindings, view props, and handlers see them alongside path params. Path
  // params win on collision (an explicit `:tenant` segment in the path
  // overrides a subdomain-captured `:tenant`).
  const hostParams = stash(c)['__rjs_host_params'] as
    | Record<string, string>
    | undefined
  const pathParams = c.req.param() ?? {}
  const params = hostParams ? { ...hostParams, ...pathParams } : pathParams
  const req: Record<string, unknown> = {
    method:  c.req.method,
    url:     c.req.url,
    path:    url.pathname,
    query:   Object.fromEntries(url.searchParams.entries()),
    params,
    headers: Object.fromEntries(
      Object.entries(c.req.header() ?? {}).map(([k, v]) => [k, String(v)])
    ),
    raw:     c,
    ip:      extractIp(c, trustProxy),
  }
  // Forward per-request augmentations stored on c by middleware (e.g. session, user).
  // Both applyMiddleware and registerRoute call normalizeRequest(c) with the same
  // Hono context, so getters ensure the route handler always sees what was set.
  const ctx = stash(c)
  // Body lives on ctx so the outer applyMiddleware req (e.g. telescope's
  // request collector) sees the same parsed body as the route handler req.
  Object.defineProperty(req, 'body', {
    get: () => ctx['__rjs_body'] ?? null,
    set: (v: unknown) => { ctx['__rjs_body'] = v },
    enumerable: true,
    configurable: true,
  })
  Object.defineProperty(req, 'session', {
    get: () => ctx['__rjs_session'],
    enumerable: true,
    configurable: true,
  })
  Object.defineProperty(req, 'user', {
    get: () => ctx['__rjs_user'],
    enumerable: true,
    configurable: true,
  })
  Object.defineProperty(req, 'token', {
    get: () => ctx['__rjs_token'],
    enumerable: true,
    configurable: true,
  })
  attachInputAccessors(req)
  return req as unknown as AppRequest
}

// ─── Response Normalizer ───────────────────────────────────

/**
 * Build an `AppResponse` over a Hono context.
 *
 * **Multi-value Set-Cookie handling.** Set-Cookie is the only standard header
 * that can legitimately repeat. Cookies are tracked in a dedicated `cookies`
 * array (not in the headers record) so two cooperative middleware writing
 * separate cookies — the canonical pair is `CsrfMiddleware` + `SessionMiddleware`
 * — don't clobber each other. When the route handler returns a raw `Response`
 * or `ViewResponse`, the framework calls the stashed `__rjs_merge_pending`
 * function which uses `headers.append('Set-Cookie', value)` to add cookies to
 * the existing `Response.headers` in place.
 *
 * **Never clone with `new Response(body, { headers: someHeaders })`** — Node's
 * undici-backed `Response` constructor collapses multi-value Set-Cookie into a
 * single comma-joined header, which most clients then parse as one cookie. Any
 * new cooperative cookie-writing path must mutate `res.headers` directly.
 */
function normalizeResponse(c: Context): AppResponse {
  let statusCode = 200
  const headers: Record<string, string> = {}
  // Set-Cookie is the only standard header that can legitimately repeat. Track
  // it separately so multiple middleware (CsrfMiddleware + SessionMiddleware)
  // each writing a cookie don't clobber each other when applied to Hono.
  const cookies: string[] = []

  const applyHeaders = () => {
    for (const [k, v] of Object.entries(headers)) c.header(k, v)
    for (const cookie of cookies) c.header('Set-Cookie', cookie, { append: true })
  }

  // Merge pending headers/cookies into an already-finalized Response (used by
  // route handler when a ViewResponse or raw Response is returned directly,
  // bypassing res.json()/res.send() that would otherwise call applyHeaders()).
  // Mutates res.headers in place — cloning via `new Response(body, { headers })`
  // collapses multi-value Set-Cookie down to one in Node's undici-backed fetch.
  const mergeInto = (res: Response): Response => {
    if (Object.keys(headers).length === 0 && cookies.length === 0) return res
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
    for (const cookie of cookies) res.headers.append('Set-Cookie', cookie)
    return res
  }
  stash(c)['__rjs_merge_pending'] = mergeInto

  return {
    raw: c,
    statusCode,
    status(code) {
      statusCode = code
      ;(this as unknown as Record<string, unknown>)['statusCode'] = code
      return this
    },
    header(key, value) {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value)
      } else {
        headers[key] = value
      }
      return this
    },
    json(data) {
      c.header('Content-Type', 'application/json')
      applyHeaders()
      c.status(statusCode as StatusCode)
      // Stash parsed body for observability (telescope) — avoids having to
      // re-read the Response stream after finalization.
      stash(c)['__rjs_response_body'] = data
      // Hono v4: c.json() returns a Response but does NOT set c.res automatically.
      // We must set c.res explicitly so Hono/srvx always has a valid response to send.
      c.res = c.json(data)
      return c.res
    },
    send(data) {
      applyHeaders()
      c.status(statusCode as StatusCode)
      // Use c.body() (not c.text()) so a custom Content-Type set via res.header()
      // is preserved. c.text() forces Content-Type: text/plain and overrides headers.
      if (headers['Content-Type'] || headers['content-type']) {
        c.res = c.body(data)
      } else {
        c.res = c.text(data)
      }
      return c.res
    },
    redirect(url, code = 302) {
      c.res = c.redirect(url, code as RedirectStatusCode)
      return c.res
    },
  }
}

// ─── Request logger ────────────────────────────────────────

const g     = globalThis as Record<string, unknown>
const isTTY = process.stdout.isTTY ?? false

function clr(code: string, s: string): string {
  return isTTY ? `\x1b[${code}m${s}\x1b[0m` : s
}

const dim  = (s: string) => clr('2',    s)
const cyan = (s: string) => isTTY ? `\x1b[38;2;80;200;220m${s}\x1b[0m` : s

function statusColor(status: number): string {
  if (!isTTY) return String(status)
  const s = String(status)
  // 24-bit truecolor — exact RGB, not subject to terminal theme remapping
  if (status < 300) return `\x1b[38;2;80;210;100m${s}\x1b[0m`   // green
  if (status < 400) return `\x1b[38;2;80;200;220m${s}\x1b[0m`   // cyan
  if (status < 500) return `\x1b[38;2;250;190;50m${s}\x1b[0m`   // yellow
  return                   `\x1b[38;2;255;85;85m${s}\x1b[0m`    // red
}

function nextReqId(): number {
  g['__rudderjs_req_n__'] = ((g['__rudderjs_req_n__'] as number | undefined) ?? 0) + 1
  return g['__rudderjs_req_n__'] as number
}

function ts(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function duration(ms: number): string {
  if (ms >= 1000) return `~${(ms / 1000).toFixed(2)}s`
  if (ms < 1)     return `<1ms`
  if (ms < 10)    return `~${ms.toFixed(1)}ms`
  return `~${Math.round(ms)}ms`
}

// Fixed column widths (pad raw strings BEFORE coloring — ANSI codes must not affect padding)
const COUNTER_WIDTH = 3   // " #1" "#10" "#100"
const LOG_WIDTH     = 50  // path + dots + duration combined

function formatRequestLog(n: number, path: string, status: number, ms: number): string {
  const counterStr = `#${n}`.padStart(COUNTER_WIDTH)
  const durStr     = duration(ms)
  const dots       = dim('.'.repeat(Math.max(4, LOG_WIDTH - path.length - durStr.length)))
  return `${dim(ts())}  ${cyan(counterStr)} ${path} ${dots} ${durStr} ${statusColor(status)}`
}

/**
 * Returns the display path to log, or null to skip the request entirely.
 *
 * - Vite internals / node_modules           → null (skip)
 * - Vike client-side nav (pageContext.json) → clean page path + " ↩ nav"
 * - Static assets (.js, .css, .ico, …)      → null (skip)
 * - Everything else                          → path as-is
 */
function logPath(path: string): string | null {
  if (path.startsWith('/@') || path.startsWith('/node_modules')) return null

  // Vike client-side navigation: /todos/index.pageContext.json → /todos ↩ nav
  if (path.endsWith('.pageContext.json')) {
    const page = path
      .replace(/\/index\.pageContext\.json$/, '')
      .replace(/\.pageContext\.json$/, '')
    return `${page || '/'} ↩ nav`
  }

  // Skip static assets — anything whose last segment has a file extension
  const last = path.split('/').pop() ?? ''
  if (last.includes('.')) return null

  return path
}

// ─── Host (subdomain) matching ─────────────────────────────

/**
 * Match a request's `Host` header against a route's `host` template. Strips
 * `:port` and lowercases both sides; `:param` segments in the template
 * capture into `params` (delimited by `.`). Returns `null` on mismatch.
 *
 * @example
 * matchHost('api.example.com',     'api.example.com:3000') // → { params: {} }
 * matchHost(':tenant.example.com', 'acme.example.com')     // → { params: { tenant: 'acme' } }
 * matchHost('api.example.com',     'web.example.com')      // → null
 */
function matchHost(template: string, host: string): { params: Record<string, string> } | null {
  const hostname = host.split(':')[0]!.toLowerCase()
  const names: string[] = []
  const re = new RegExp('^' +
    template.toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-z_][a-z0-9_]*)/gi, (_, n) => { names.push(n); return '([^.]+)' })
    + '$', 'i')
  const m = re.exec(hostname)
  if (!m) return null
  const params: Record<string, string> = {}
  names.forEach((n, i) => { params[n] = m[i + 1]! })
  return { params }
}

// ─── Hono Adapter ─────────────────────────────────────────

class HonoAdapter implements ServerAdapter {
  private app: Hono
  private _trustProxy: boolean
  private _errorHandler?: (err: unknown, req: AppRequest) => Response | Promise<Response>
  private _groupMiddleware: Record<'web' | 'api', MiddlewareHandler[]> = { web: [], api: [] }
  /**
   * Set of GET route paths registered via the router. Used by the outer fetch
   * handler to decide whether a `.pageContext.json` request should be rewritten
   * to a controller URL or left for Vike's middleware to handle directly.
   * Without this, Vike's pageContext.json requests for its own pages would be
   * misrouted into Hono and return HTML instead of JSON.
   * Note: only exact-match paths are tracked — parameterized routes (`/users/:id`)
   * are not supported as controller views in v1.
   */
  readonly controllerViewPaths = new Set<string>()

  constructor(app?: Hono, trustProxy = false) {
    this.app = app ?? new Hono()
    this._trustProxy = trustProxy
  }

  applyGroupMiddleware(group: 'web' | 'api', middleware: MiddlewareHandler): void {
    this._groupMiddleware[group].push(middleware)
  }

  setErrorHandler(fn: (err: unknown, req: AppRequest) => Response | Promise<Response>): void {
    this._errorHandler = fn
  }

  /** @internal — used by createFetchHandler after setup() runs */
  getErrorHandler() { return this._errorHandler }

  registerRoute(route: RouteDefinition): void {
    const method = (route.method === 'ALL' ? 'all' : route.method.toLowerCase()) as
      'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'all'

    // Track GET routes that don't contain dynamic segments — these are the
    // candidates for `view()` returns and SPA-navigable. The outer fetch
    // handler uses this set to know when a `.pageContext.json` request should
    // be rewritten into a controller call.
    if ((route.method === 'GET' || route.method === 'ALL') && !route.path.includes(':')) {
      this.controllerViewPaths.add(route.path)
    }

    this.app[method](route.path, async (c: Context) => {
      const trace = process.env['RUDDER_PERF_TRACE'] === '1'
      const perfId = currentPerfId()
      markBoundary(perfId, B.ROUTE_HANDLER_IN)
      // Subdomain gate — Hono routes by path only, so we filter on Host here.
      // Mismatch returns 404 (matches Laravel: a route scoped to a subdomain
      // simply isn't registered for other hosts). Captured `:param` segments
      // are stashed on the context so normalizeRequest() can merge them into
      // `req.params` alongside path params.
      if (route.host) {
        const m = matchHost(route.host, c.req.header('host') ?? '')
        if (!m) return c.notFound()
        stash(c)['__rjs_host_params'] = m.params
      }

      const req = normalizeRequest(c, this._trustProxy)
      const res = normalizeResponse(c)
      markBoundary(perfId, B.NORM_DONE)

      // Compose group middleware (e.g. session, auth on the web group) before
      // per-route middleware. Routes without a group tag get no group middleware.
      const groupMw = route.group ? this._groupMiddleware[route.group] : []
      const chain   = [...groupMw, ...route.middleware]

      // Stash route metadata on the raw request for observability (Telescope).
      // Middleware names are extracted from function.name — named functions
      // (e.g. `async function SessionMiddleware(…)`) produce readable names,
      // anonymous arrows produce '' (filtered out).
      const meta = req.raw as Record<string, unknown>
      // Named handlers (controllers via Router.registerController set
      // `ControllerClass@method` on fn.name) keep their name. Anonymous
      // arrows / closures show as "Closure" (Laravel parity — method + path
      // are already shown elsewhere in the telescope entry).
      const handlerName = route.handler.name && route.handler.name !== 'anonymous'
        ? route.handler.name
        : 'Closure'
      meta['__rjs_route'] = {
        method:     route.method,
        path:       route.path,
        handler:    handlerName,
        group:      route.group,
        middleware: chain
          .map(fn => fn.name || (fn as unknown as { _name?: string })['_name'])
          .filter(Boolean),
      }

      // Parse body for mutating methods — JSON + form-urlencoded.
      // Leave multipart/form-data untouched (handlers parse via c.req.parseBody()
      // when they need it). Form-urlencoded is required by RFC 6749 §3.2 for
      // OAuth2 token endpoints; without this branch any spec-compliant OAuth
      // client (curl -d, Postman default, axios URLSearchParams) sends a
      // request whose body never reaches the handler.
      if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
        const ct = c.req.header('content-type') ?? ''
        if (ct.includes('application/json')) {
          try { req.body = await c.req.json() } catch { req.body = {} }
        } else if (ct.includes('application/x-www-form-urlencoded')) {
          try {
            const text = await c.req.text()
            req.body = Object.fromEntries(new URLSearchParams(text))
          } catch { req.body = {} }
        }
      }
      markBoundary(perfId, B.BODY_PARSE_DONE)

      // Run middleware chain with the handler as the final step.
      // Middleware and handler share the same `res` so headers set by middleware
      // (e.g. Set-Cookie from SessionMiddleware) are included in the final response.
      // We always return `c.res` at the end — middleware that runs after the handler
      // (like session.save()) can modify `c.res` and their changes will be included.
      let idx = 0

      const t1 = trace ? performance.now() : 0
      const next = async (): Promise<void> => {
        const fn = chain[idx++]
        if (fn) {
          await fn(req, res, next)
        } else {
          // All middleware passed — run the handler with the same res
          if (trace) console.log(`[perf] req middleware ${(performance.now() - t1).toFixed(1)}ms`)
          markBoundary(perfId, B.MIDDLEWARE_DONE)
          const t2 = trace ? performance.now() : 0
          const result = await route.handler(req, res)
          if (trace) console.log(`[perf] req handler ${(performance.now() - t2).toFixed(1)}ms`)
          markBoundary(perfId, B.HANDLER_DONE)
          if (isViewResponse(result)) {
            // @rudderjs/view ViewResponse — resolve via Vike's renderPage().
            // Detected by duck-typing on the static __rudder_view__ marker so
            // server-hono has no hard import on @rudderjs/view.
            // Pass the original URL (preserving any .pageContext.json suffix
            // from Vike's client router) so toResponse() can request JSON
            // instead of HTML for SPA navigation.
            const originalUrl = c.req.header('x-rudder-original-url') ?? c.req.url
            const tv = trace ? performance.now() : 0
            markBoundary(perfId, B.VIEW_TORESPONSE_IN)
            c.res = await result.toResponse({ url: originalUrl })
            markBoundary(perfId, B.VIEW_TORESPONSE_OUT)
            if (trace) console.log(`[perf] req view.toResponse ${(performance.now() - tv).toFixed(1)}ms`)
            // Stash view info for Telescope
            const v = result as unknown as { id?: string; props?: Record<string, unknown> }
            meta['__rjs_view'] = { id: v.id, props: Object.keys(v.props ?? {}) }
            // Stash response envelope for the Response tab (full prop values,
            // not just keys — matches Laravel Telescope's Inertia rendering).
            stash(c)['__rjs_response_body'] = {
              view:  v.id,
              props: v.props ?? {},
            }
          } else if (result instanceof Response) {
            c.res = result
          } else if (result !== undefined && result !== null) {
            c.res = c.json(result) as Response
          }
          // else: handler called res.json()/res.send() which already set c.res

          // Merge pending headers/cookies set via res.header() into c.res.
          // ViewResponse + raw Response paths bypass res.json()/res.send(), so
          // their applyHeaders() never fires — without this step, anything
          // CsrfMiddleware (or other middleware using res.header()) wrote to
          // the wrapper would silently drop on the floor.
          const merge = stash(c)['__rjs_merge_pending'] as
            ((r: Response) => Response) | undefined
          if (merge && c.res) c.res = merge(c.res)
        }
      }

      await next()
      return c.res as Response
    })
  }

  applyMiddleware(middleware: MiddlewareHandler): void {
    this.app.use('*', async (c, honoNext) => {
      const req = normalizeRequest(c, this._trustProxy)
      const res = normalizeResponse(c)
      await middleware(req, res, honoNext)
      // Hono v4 requires the handler to finalize the context.
      // c.res is always a valid Response (downstream response, or Hono's 404 default).
      // Returning it here covers both cases: pass-through (next was called) and
      // short-circuit (middleware set c.res via normalizeResponse.json/send).
      return c.res
    })
  }

  listen(port: number, callback?: () => void): void {
    serve({ fetch: this.app.fetch, port: port }, () => {
      callback?.()
      console.log(`[RudderJS] Server running on http://localhost:${port}`)
    })
    // The WebSocket upgrade handler is attached automatically via the
    // http.createServer monkey-patch at the top of this file. Attaching it
    // again here would cause "handleUpgrade called more than once" errors
    // because both listeners would fire for the same upgrade event.
  }

  getNativeServer(): Hono {
    return this.app
  }
}

// ─── Factory ───────────────────────────────────────────────

// ─── Eager vike/server prewarm ────────────────────────────
//
// vike/server takes ~100 ms to first-import (its full server pipeline pulls
// in a lot of modules). Stalling that cost until the first user request is
// the largest first-render perf hit in a typical RudderJS app. We kick off
// the load here as a module-load side-effect of `@rudderjs/server-hono`,
// which runs the moment `bootstrap/app.ts` statically imports `{ hono }` —
// roughly t=0 in the cold-boot timeline. The load then completes in
// parallel with the rest of bootstrap and is cached by the time `view()`'s
// `toResponse()` awaits it.
//
// `@rudderjs/view` is an optional peer (server-hono is usable without it
// for pure-JSON APIs), so the specifier goes through a string variable to
// avoid a hard TS build dep, and the chain catches the not-installed case.
{
  const viewModuleSpecifier = '@rudderjs/view'
  void import(viewModuleSpecifier)
    .then((m: { prewarmVikeServer?: () => Promise<unknown> }) =>
      m.prewarmVikeServer?.())
    .catch(() => { /* view not installed — fine */ })
}

export function hono(config: HonoConfig = {}): ServerAdapterProvider {
  return {
    type: 'hono',

    create(): ServerAdapter {
      return new HonoAdapter(undefined, config.trustProxy ?? false)
    },

    createApp(): Hono {
      return new Hono()
    },

    async createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<FetchHandler> {
      // Dynamic import keeps @vikejs/hono out of the vite.config.ts load path
      const vike = (await import('@vikejs/hono')).default
      const trustProxy = config.trustProxy ?? false

      const app = new Hono()

      // CORS — applied before routes if configured
      if (config.cors) {
        const { cors } = config
        app.use('*', async (c, next) => {
          c.header('Access-Control-Allow-Origin',  cors.origin  ?? '*')
          c.header('Access-Control-Allow-Methods', cors.methods ?? 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
          c.header('Access-Control-Allow-Headers', cors.headers ?? 'Content-Type,Authorization')
          if (c.req.method === 'OPTIONS') return new Response(null, { status: 204 })
          await next()
        })
      }

      const isProd = process.env['APP_ENV'] === 'production' || process.env['NODE_ENV'] === 'production'

      const adapter = new HonoAdapter(app, trustProxy)
      setup?.(adapter)

      // Install error handler — setup() may have registered one via adapter.setErrorHandler().
      // The registered handler auto-handles ValidationError → 422 and re-throws everything
      // else, which falls through to the dev error page (dev) or a JSON 500 (prod).
      const userHandler = adapter.getErrorHandler()
      if (userHandler) {
        app.onError(async (err, c) => {
          try {
            return await userHandler(err, normalizeRequest(c, trustProxy))
          } catch (e2) {
            const thrown = e2 instanceof Error ? e2 : new Error(String(e2))
            if (!isProd) {
              const html = renderErrorPage(thrown, { method: c.req.method, url: c.req.url, headers: Object.fromEntries(Object.entries(c.req.header())) })
              return c.html(html, 500)
            }
            return new Response(JSON.stringify({ message: 'Internal Server Error' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          }
        })
      } else if (!isProd) {
        app.onError((err, c) => {
          const html = renderErrorPage(err instanceof Error ? err : new Error(String(err)), { method: c.req.method, url: c.req.url, headers: Object.fromEntries(Object.entries(c.req.header())) })
          return c.html(html, 500)
        })
      }

      // Attach Vike SSR middleware
      vike(app)

      // Logging at the outermost fetch level catches ALL requests — including Vike's
      // client-side navigation data fetches, which bypass the Hono middleware chain.
      return async (request) => {
        const perfId = startRequest()
        markBoundary(perfId, B.HONO_FETCH_IN)
        // Vike client-router SPA nav: rewrite /<path>.pageContext.json → /<path>
        // so the controller route matches. Stash the original URL on a header so
        // ViewResponse.toResponse() can pass it back to Vike — Vike then emits the
        // JSON pageContext envelope instead of HTML, and the client does a smooth
        // SPA transition. Without this, every controller-view link is a full reload.
        // Vike's client router uses `/<path>/index.pageContext.json` (the
        // `/index` prefix is hard-coded — see Vike's handlePageContextRequestUrl).
        // For controller-view URLs, strip that suffix and route to the
        // controller; the controller returns a ViewResponse, and toResponse()
        // hands the original URL back to renderPage so Vike emits JSON.
        // For pageContext.json requests targeting normal Vike pages, leave
        // the request alone — Vike's middleware handles those directly.
        let actualRequest = request
        const reqUrl = new URL(request.url)
        const PAGE_CTX_SUFFIX = '/index.pageContext.json'
        if (reqUrl.pathname.endsWith(PAGE_CTX_SUFFIX)) {
          const stripped = reqUrl.pathname.slice(0, -PAGE_CTX_SUFFIX.length) || '/'
          if (adapter.controllerViewPaths.has(stripped)) {
            const rewrittenUrl = new URL(request.url)
            rewrittenUrl.pathname = stripped
            const headers = new Headers(request.headers)
            headers.set('x-rudder-original-url', request.url)
            actualRequest = new Request(rewrittenUrl.toString(), {
              method: request.method,
              headers,
            })
          }
        }

        const display = logPath(new URL(request.url).pathname)
        if (display === null) {
          markBoundary(perfId, B.APP_FETCH_IN)
          const r = await runWithRequest(perfId, () => app.fetch(actualRequest))
          markBoundary(perfId, B.APP_FETCH_OUT)
          markBoundary(perfId, B.HONO_FETCH_OUT)
          finishRequest(perfId)
          return r
        }
        const n     = nextReqId()
        const start = performance.now()
        markBoundary(perfId, B.APP_FETCH_IN)
        const res   = await runWithRequest(perfId, () => app.fetch(actualRequest))
        markBoundary(perfId, B.APP_FETCH_OUT)
        console.log(formatRequestLog(n, display, res.status, performance.now() - start))
        markBoundary(perfId, B.HONO_FETCH_OUT)
        finishRequest(perfId)
        return res
      }
    },
  }
}