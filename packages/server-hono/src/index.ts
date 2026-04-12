import { Hono, type Context } from 'hono'
import type { StatusCode, RedirectStatusCode } from 'hono/utils/http-status'
import { renderErrorPage } from './error-page.js'
import { serve } from '@hono/node-server'
import http from 'node:http'

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

// ─── Request Normalizer ────────────────────────────────────

function normalizeRequest(c: Context): AppRequest {
  const url = new URL(c.req.url)
  const req: Record<string, unknown> = {
    method:  c.req.method,
    url:     c.req.url,
    path:    url.pathname,
    query:   Object.fromEntries(url.searchParams.entries()),
    params:  c.req.param() ?? {},
    headers: Object.fromEntries(
      Object.entries(c.req.header() ?? {}).map(([k, v]) => [k, String(v)])
    ),
    body:    null, // populated lazily per route
    raw:     c,
  }
  // Forward per-request augmentations stored on c by middleware (e.g. session, user).
  // Both applyMiddleware and registerRoute call normalizeRequest(c) with the same
  // Hono context, so getters ensure the route handler always sees what was set.
  const ctx = c as unknown as Record<string, unknown>
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
  attachInputAccessors(req)
  return req as unknown as AppRequest
}

// ─── Response Normalizer ───────────────────────────────────

function normalizeResponse(c: Context): AppResponse {
  let statusCode = 200
  const headers: Record<string, string> = {}

  return {
    raw: c,
    statusCode,
    status(code) {
      statusCode = code
      ;(this as unknown as Record<string, unknown>)['statusCode'] = code
      return this
    },
    header(key, value) {
      headers[key] = value
      return this
    },
    json(data) {
      c.header('Content-Type', 'application/json')
      Object.entries(headers).forEach(([k, v]) => c.header(k, v))
      c.status(statusCode as StatusCode)
      // Hono v4: c.json() returns a Response but does NOT set c.res automatically.
      // We must set c.res explicitly so Hono/srvx always has a valid response to send.
      c.res = c.json(data)
      return c.res
    },
    send(data) {
      Object.entries(headers).forEach(([k, v]) => c.header(k, v))
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

// ─── Hono Adapter ─────────────────────────────────────────

class HonoAdapter implements ServerAdapter {
  private app: Hono
  private _errorHandler?: (err: unknown, req: AppRequest) => Response | Promise<Response>
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

  constructor(app?: Hono) {
    this.app = app ?? new Hono()
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
      const req = normalizeRequest(c)
      const res = normalizeResponse(c)

      // Parse body for mutating methods — JSON only; leave multipart/form-data untouched
      if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
        const ct = c.req.header('content-type') ?? ''
        if (ct.includes('application/json')) {
          try { req.body = await c.req.json() } catch { req.body = {} }
        }
      }

      // Run middleware chain with the handler as the final step.
      // Middleware and handler share the same `res` so headers set by middleware
      // (e.g. Set-Cookie from SessionMiddleware) are included in the final response.
      // We always return `c.res` at the end — middleware that runs after the handler
      // (like session.save()) can modify `c.res` and their changes will be included.
      const middleware = [...route.middleware]
      let idx = 0

      const next = async (): Promise<void> => {
        const fn = middleware[idx++]
        if (fn) {
          await fn(req, res, next)
        } else {
          // All middleware passed — run the handler with the same res
          const result = await route.handler(req, res)
          if (isViewResponse(result)) {
            // @rudderjs/view ViewResponse — resolve via Vike's renderPage().
            // Detected by duck-typing on the static __rudder_view__ marker so
            // server-hono has no hard import on @rudderjs/view.
            // Pass the original URL (preserving any .pageContext.json suffix
            // from Vike's client router) so toResponse() can request JSON
            // instead of HTML for SPA navigation.
            const originalUrl = c.req.header('x-rudder-original-url') ?? c.req.url
            c.res = await result.toResponse({ url: originalUrl })
          } else if (result instanceof Response) {
            c.res = result
          } else if (result !== undefined && result !== null) {
            c.res = c.json(result) as Response
          }
          // else: handler called res.json()/res.send() which already set c.res
        }
      }

      await next()
      return c.res as Response
    })
  }

  applyMiddleware(middleware: MiddlewareHandler): void {
    this.app.use('*', async (c, honoNext) => {
      const req = normalizeRequest(c)
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

export function hono(config: HonoConfig = {}): ServerAdapterProvider {
  return {
    type: 'hono',

    create(): ServerAdapter {
      return new HonoAdapter()
    },

    createApp(): Hono {
      return new Hono()
    },

    async createFetchHandler(setup?: (adapter: ServerAdapter) => void): Promise<FetchHandler> {
      // Dynamic import keeps @vikejs/hono out of the vite.config.ts load path
      const vike = (await import('@vikejs/hono')).default

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

      const adapter = new HonoAdapter(app)
      setup?.(adapter)

      // Install error handler — setup() may have registered one via adapter.setErrorHandler().
      // The registered handler auto-handles ValidationError → 422 and re-throws everything
      // else, which falls through to the dev error page (dev) or a JSON 500 (prod).
      const userHandler = adapter.getErrorHandler()
      if (userHandler) {
        app.onError(async (err, c) => {
          try {
            return await userHandler(err, normalizeRequest(c))
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
        if (display === null) return app.fetch(actualRequest)
        const n     = nextReqId()
        const start = performance.now()
        const res   = await app.fetch(actualRequest)
        console.log(formatRequestLog(n, display, res.status, performance.now() - start))
        return res
      }
    },
  }
}