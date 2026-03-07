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
const cyan = (s: string) => clr('1;36', s)

function statusColor(status: number): string {
  const s = String(status)
  if (status < 300) return clr('1;35', s)  // 2xx — bold magenta (matches Vike)
  if (status < 400) return clr('1;36', s)  // 3xx — bold cyan
  if (status < 500) return clr('1;33', s)  // 4xx — bold yellow
  return                     clr('1;31', s) // 5xx — bold red
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
  return `~${ms}ms`
}

// Total display width for path + dots combined (terminal fill)
const LOG_WIDTH = 60

function formatRequestLog(n: number, path: string, status: number, ms: number): string {
  const counter  = cyan(`#${n}`)
  const dots     = dim('.'.repeat(Math.max(4, LOG_WIDTH - path.length)))
  const dur      = dim(duration(ms))
  const stat     = statusColor(status)
  return `${dim(ts())}  ${counter}  ${path} ${dots} ${dur}  ${stat}`
}

/** Skip Vite internals and static asset requests — only log page/API routes */
function shouldLog(path: string): boolean {
  if (path.startsWith('/@'))            return false  // Vite internals
  if (path.startsWith('/node_modules')) return false
  const last = path.split('/').pop() ?? ''
  return !last.includes('.')                          // skip anything with a file extension
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
    serve({ fetch: this.app.fetch, port: port }, () => {
      callback?.()
      console.log(`[BoostKit] Server running on http://localhost:${port}`)
    })
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
        const path = new URL(request.url).pathname
        if (!shouldLog(path)) return server.fetch(request)
        const n     = nextReqId()
        const start = Date.now()
        const res   = await server.fetch(request)
        console.log(formatRequestLog(n, path, res.status, Date.now() - start))
        return res
      }
    },
  }
}