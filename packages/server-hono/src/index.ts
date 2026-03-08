import { Hono, type Context } from 'hono'
import { renderErrorPage } from './error-page.js'
import { serve } from '@hono/node-server'
import type {
  ServerAdapter,
  ServerAdapterProvider,
  FetchHandler,
  RouteDefinition,
  MiddlewareHandler,
  AppRequest,
  AppResponse,
} from '@boostkit/contracts'

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

function normalizeRequest(c: any): AppRequest {
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
  Object.defineProperty(req, 'session', {
    get: () => (c as Record<string, unknown>)['__bk_session'],
    enumerable: true,
    configurable: true,
  })
  Object.defineProperty(req, 'user', {
    get: () => (c as Record<string, unknown>)['__bk_user'],
    enumerable: true,
    configurable: true,
  })
  return req as unknown as AppRequest
}

// ─── Response Normalizer ───────────────────────────────────

function normalizeResponse(c: any): AppResponse {
  let statusCode = 200
  const headers: Record<string, string> = {}

  return {
    raw: c,
    status(code) {
      statusCode = code
      return this
    },
    header(key, value) {
      headers[key] = value
      return this
    },
    json(data) {
      c.header('Content-Type', 'application/json')
      Object.entries(headers).forEach(([k, v]) => c.header(k, v))
      c.status(statusCode)
      // Hono v4: c.json() returns a Response but does NOT set c.res automatically.
      // We must set c.res explicitly so Hono/srvx always has a valid response to send.
      c.res = c.json(data)
      return c.res
    },
    send(data) {
      Object.entries(headers).forEach(([k, v]) => c.header(k, v))
      c.status(statusCode)
      c.res = c.text(data)
      return c.res
    },
    redirect(url, code = 302) {
      c.res = c.redirect(url, code)
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
  g['__boostkit_req_n__'] = ((g['__boostkit_req_n__'] as number | undefined) ?? 0) + 1
  return g['__boostkit_req_n__'] as number
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

    this.app[method](route.path, async (c: Context) => {
      const req = normalizeRequest(c)
      const res = normalizeResponse(c)

      // Parse body for mutating methods
      if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
        try { req.body = await c.req.json() } catch { req.body = {} }
      }

      // Run middleware chain with the handler as the final step.
      // If any middleware short-circuits (doesn't call next), the handler never runs.
      let response: Response | undefined
      const middleware = [...route.middleware]
      let idx = 0

      const next = async (): Promise<void> => {
        const fn = middleware[idx++]
        if (fn) {
          await fn(req, res, next)
        } else {
          // All middleware passed — run the handler with a fresh response context
          // so its status/headers are independent of any middleware state
          const handlerRes = normalizeResponse(c)
          const result = await route.handler(req, handlerRes)
          if (result instanceof Response)                    response = result
          else if (result !== undefined && result !== null)  response = c.json(result) as Response
          else                                               response = c.res as Response
        }
      }

      await next()
      return response ?? c.res as Response
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
    const server = serve({ fetch: this.app.fetch, port: port }, () => {
      callback?.()
      console.log(`[BoostKit] Server running on http://localhost:${port}`)
    })
    // Attach the @boostkit/ws upgrade handler if registered.
    // Uses globalThis so there is no hard dependency on @boostkit/ws.
    const wsHandler = (globalThis as Record<string, unknown>)['__boostkit_ws_upgrade__'] as
      | ((req: unknown, socket: unknown, head: unknown) => void)
      | undefined
    if (wsHandler) (server as unknown as { on: (e: string, h: unknown) => void }).on('upgrade', wsHandler)
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
      // Dynamic import keeps @photonjs/hono out of the vite.config.ts load path
      // (virtual: URLs only exist inside Vite's runtime, not during config parsing)
      const { apply, serve: photonServe } = await import('@photonjs/hono')

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apply(app as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const server = photonServe(app as any)

      // Logging at the outermost fetch level catches ALL requests — including Vike's
      // client-side navigation data fetches, which bypass the Hono middleware chain.
      return async (request) => {
        const display = logPath(new URL(request.url).pathname)
        if (display === null) return server.fetch(request)
        const n     = nextReqId()
        const start = performance.now()
        const res   = await server.fetch(request)
        console.log(formatRequestLog(n, display, res.status, performance.now() - start))
        return res
      }
    },
  }
}