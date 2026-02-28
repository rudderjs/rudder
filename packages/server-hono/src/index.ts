import { Hono, type Context } from 'hono'
import { serve } from '@hono/node-server'
import type {
  ServerAdapter,
  ServerAdapterProvider,
  FetchHandler,
  RouteDefinition,
  MiddlewareHandler,
  ForgeRequest,
  ForgeResponse,
} from '@forge/server'

// ─── Request Normalizer ────────────────────────────────────

function normalizeRequest(c: any): ForgeRequest {
  const url = new URL(c.req.url)
  return {
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
}

// ─── Response Normalizer ───────────────────────────────────

function normalizeResponse(c: any): ForgeResponse {
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
      return c.json(data)
    },
    send(data) {
      Object.entries(headers).forEach(([k, v]) => c.header(k, v))
      c.status(statusCode)
      return c.text(data)
    },
    redirect(url, code = 302) {
      return c.redirect(url, code)
    },
  }
}

// ─── Request logger ────────────────────────────────────────

const g    = globalThis as Record<string, unknown>
const isTTY = process.stdout.isTTY ?? false

function clr(code: string, s: string): string {
  return isTTY ? `\x1b[${code}m${s}\x1b[0m` : s
}

const dim        = (s: string) => clr('2',    s)
const boldYellow = (s: string) => clr('1;33', s)

function statusColor(status: number): string {
  const s = String(status)
  if (status < 300) return clr('1;35', s)  // 2xx — bold magenta (matches Vike)
  if (status < 400) return clr('1;36', s)  // 3xx — bold cyan
  if (status < 500) return clr('1;33', s)  // 4xx — bold yellow
  return                     clr('1;31', s) // 5xx — bold red
}

function nextReqId(): number {
  g['__forge_req_n__'] = ((g['__forge_req_n__'] as number | undefined) ?? 0) + 1
  return g['__forge_req_n__'] as number
}

function ts(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour:   'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
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

  constructor(app?: Hono) {
    this.app = app ?? new Hono()
  }

  registerRoute(route: RouteDefinition): void {
    const method = route.method.toLowerCase() as
      'get' | 'post' | 'put' | 'patch' | 'delete' | 'options'

    this.app[method](route.path, async (c: Context) => {
      const req = normalizeRequest(c)
      const res = normalizeResponse(c)

      // Parse body for mutating methods
      if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
        try { req.body = await c.req.json() } catch { req.body = {} }
      }

      // Run middleware chain
      const middleware = [...route.middleware]
      let idx = 0
      const next = async (): Promise<void> => {
        const fn = middleware[idx++]
        if (fn) await fn(req, res, next)
      }
      await next()

      // Run handler — auto JSON serialize if data is returned
      const result = await route.handler(req, res)
      let response: Response
      if (result instanceof Response)                      response = result
      else if (result !== undefined && result !== null)    response = c.json(result) as Response
      else                                                 response = c.res as Response

      return response
    })
  }

  applyMiddleware(middleware: MiddlewareHandler): void {
    this.app.use('*', async (c, honoNext) => {
      const req = normalizeRequest(c)
      const res = normalizeResponse(c)
      await middleware(req, res, honoNext)
    })
  }

  listen(port: number, callback?: () => void): void {
    serve({ fetch: this.app.fetch, port }, () => {
      callback?.()
      console.log(`[Forge] Server running on http://localhost:${port}`)
    })
  }

  getNativeServer(): Hono {
    return this.app
  }
}

// ─── Factory ───────────────────────────────────────────────

export function hono(): ServerAdapterProvider {
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

      // Forge owns all HTTP request logging — silence Vike's duplicate lines.
      // Only the two HTTP request/response lines are suppressed; errors/warnings pass through.
      const _log = console.log
      console.log = (...args: unknown[]) => {
        const msg = String(args[0] ?? '')
        if (msg.includes('[vike]') && (msg.includes('HTTP request') || msg.includes('HTTP response'))) return
        _log(...args)
      }

      const app = new Hono()

      // Unified request logger — runs for all requests before routes or Vike SSR.
      // Filters out static assets and Vite internals so only page/API routes appear.
      app.use('*', async (c, next) => {
        const path = new URL(c.req.url).pathname
        if (!shouldLog(path)) return next()
        const n = nextReqId()
        console.log(`${dim(ts())} ${boldYellow('[forge]')}[request-${n}] HTTP request  → ${path}`)
        await next()
        const status = (c.res as Response | undefined)?.status ?? 200
        console.log(`${dim(ts())} ${boldYellow('[forge]')}[request-${n}] HTTP response ← ${path} ${statusColor(status)}`)
      })

      setup?.(new HonoAdapter(app))
      apply(app)
      const server = photonServe(app)
      return async (request) => server.fetch(request)
    },
  }
}