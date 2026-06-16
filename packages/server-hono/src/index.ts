import { Hono, type Context } from 'hono'
import type { StatusCode, RedirectStatusCode } from 'hono/utils/http-status'
import { renderErrorPage, applyDevStackFix } from './error-page.js'
import { serve } from '@hono/node-server'
import http from 'node:http'
import { B, startRequest, markBoundary, finishRequest, runWithRequest, currentPerfId } from './perf-boundaries.js'
import { safeRedirectTarget } from './safe-redirect.js'

export { isSafeRedirect, safeRedirectTarget } from './safe-redirect.js'

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
import { attachInputAccessors, MalformedBodyError, PayloadTooLargeError } from '@rudderjs/contracts'
import { AsyncLocalStorage } from 'node:async_hooks'

// Carries the SPA-nav "original URL" from the outer fetch handler (which does
// the `.pageContext.json` rewrite) into the route handler that builds the
// ViewResponse — WITHOUT a client-visible header. The previous header channel
// (`x-rudder-original-url`) was forgeable: a direct request could set it and
// inject an arbitrary URL into Vike's renderPage routing. ALS is per-request
// and unreachable from the client.
const spaNavUrlStore = new AsyncLocalStorage<string>()

// Default cap on the JSON / form-urlencoded body the adapter buffers itself.
// Multipart is NOT buffered here (handlers stream it via c.req.parseBody()), so
// this does not constrain file uploads. Overridable per-app via HonoConfig.bodyLimit.
const DEFAULT_BODY_LIMIT = 1024 * 1024 // 1 MB

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
  /**
   * Trust proxy-forwarded client-IP headers (`X-Forwarded-For` / `X-Real-IP`).
   *
   * - `false` (default): never read forwarding headers — the socket address is
   *   the client.
   * - `true`: trust ONE proxy hop. `req.ip` is the rightmost `X-Forwarded-For`
   *   entry — the address the immediately-trusted proxy appended, which a client
   *   can't forge. (Taking the *leftmost* entry, as before, let a client spoof
   *   `req.ip` whenever the proxy appends rather than replaces the header — the
   *   nginx `proxy_add_x_forwarded_for` default — defeating ip-keyed rate limits
   *   and allowlists.)
   * - `number N`: trust N chained proxy hops — `req.ip` is the Nth entry from the
   *   right (`parts[len - N]`). Use when several reverse proxies sit in front.
   *
   * Secure-by-default vs Laravel's `TrustProxies = '*'`: the boolean default
   * trusts exactly one hop instead of the whole client-supplied chain.
   */
  trustProxy?: boolean | number
  /**
   * Max bytes the adapter will buffer for a JSON / form-urlencoded request body
   * before rejecting it with HTTP 413. Enforced via a streaming byte count, so a
   * chunked body with no (or a lying) Content-Length can't exhaust memory.
   * Default 1 MB. Does not apply to multipart/form-data (streamed by handlers).
   */
  bodyLimit?: number
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
  // IPv4-mapped IPv6 (`::ffff:203.0.113.5`) → bare IPv4, so socket-derived
  // and header-derived addresses key identically (rate limits, logs).
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  return ip === '::1' ? '127.0.0.1' : ip
}

/**
 * The direct socket address, in every runtime that exposes one:
 *
 * - srvx (the vike production server, `node dist/server/index.mjs`): its
 *   `NodeRequest` carries an `ip` getter (`req.socket.remoteAddress`) and a
 *   `runtime.node` handle.
 * - `@hono/node-server` (`adapter.listen()`): the bindings land on hono's
 *   env as `{ incoming }`.
 *
 * Edge/worker runtimes expose neither — callers fall back to headers or
 * `undefined`.
 */
function socketAddress(c: Context): string | undefined {
  const raw = c.req.raw as Request & {
    ip?: string
    runtime?: { node?: { req?: { socket?: { remoteAddress?: string } } } }
  }
  if (typeof raw.ip === 'string' && raw.ip) return raw.ip
  const viaRuntime = raw.runtime?.node?.req?.socket?.remoteAddress
  if (viaRuntime) return viaRuntime
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress
}

/** Number of trusted proxy hops from a `trustProxy` config value. */
function trustedHops(trustProxy: boolean | number): number {
  if (trustProxy === true) return 1
  if (typeof trustProxy === 'number' && trustProxy > 0) return Math.floor(trustProxy)
  return 0
}

/**
 * Resolve the client IP.
 *
 * With `trustProxy` enabled, proxy headers win: `x-forwarded-for` then
 * `x-real-ip`. The `x-forwarded-for` entry chosen is the one the trusted proxy
 * chain appended — the **rightmost** entry, or the Nth-from-right when N hops
 * are trusted — NOT the leftmost (the leftmost is whatever the client sent and
 * is forgeable when the proxy appends rather than replaces the header). In every
 * case the direct socket address is the fallback (`REMOTE_ADDR` parity) — a
 * trusted-proxy config hit directly (no header) still resolves the caller, and
 * with `trustProxy` off the socket IS the client. Client-sent proxy headers are
 * never read when `trustProxy` is false.
 *
 * One dev-only exception: the vite dev pipeline converts the Node request to a
 * plain web `Request` before it reaches this adapter, so no socket is reachable.
 * There the `x-real-ip` header injected by `@rudderjs/vite`'s `rudderjs:ip`
 * plugin (from `req.socket.remoteAddress`) stands in for the socket channel. The
 * branch is gated off `NODE_ENV=production`, which the production server pins.
 *
 * Returns `undefined` only when no channel exists (edge runtimes with
 * `trustProxy` off). Addresses normalize via {@link normalizeIp}.
 */
function extractIp(c: Context, trustProxy: boolean | number): string | undefined {
  const hops = trustedHops(trustProxy)
  if (hops > 0) {
    const xff = c.req.header('x-forwarded-for')
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
      if (parts.length > 0) {
        // The real client is the entry the trusted proxy chain appended. With one
        // trusted proxy that's the rightmost entry; with N proxies it's N from the
        // right. Clamp so a short (or spoofed-short) chain falls back to leftmost.
        const idx = Math.max(0, parts.length - hops)
        return normalizeIp(parts[idx]!)
      }
    }
    const xri = c.req.header('x-real-ip')
    if (xri) return normalizeIp(xri)
    // Trusted proxy configured but no header on this hit (direct request) —
    // fall through: the socket address is the client.
  }
  const sock = socketAddress(c)
  if (sock) return normalizeIp(sock)
  if (hops === 0 && process.env['NODE_ENV'] !== 'production') {
    const xri = c.req.header('x-real-ip')
    if (xri) return normalizeIp(xri)
  }
  return undefined
}

/**
 * @internal — exposed for tests. Whether the rich dev error page (full stack +
 * on-disk source + all request headers) should render for the given env.
 * Secure-by-default: TRUE only when the env is EXPLICITLY development/local; an
 * unset or unknown env returns FALSE (treated as production), so a misconfigured
 * deploy that forgets `NODE_ENV=production` can't leak source + secret headers.
 */
export function devErrorPageEnabled(env: { APP_ENV?: string | undefined; NODE_ENV?: string | undefined }): boolean {
  const appEnv = env.APP_ENV
  const nodeEnv = env.NODE_ENV
  if (appEnv === 'production' || nodeEnv === 'production') return false
  if (appEnv === 'local' || appEnv === 'development' || appEnv === 'dev') return true
  if (appEnv === undefined && nodeEnv === 'development') return true
  return false
}

/**
 * @internal — exposed for tests. Whether the per-request access log (the colored
 * `#n PATH .... 12ms 200` line) is written. It is a **development affordance**:
 * on by default only in a dev-like env (same gate as {@link devErrorPageEnabled}),
 * off in production. A `console.log` per request is synchronous stdout I/O that
 * caps throughput and, under stdout backpressure (a piped log sink), degrades into
 * error-object formatting (`ErrnoException` + stack capture + `util.inspect`) — a
 * dominant per-request cost a profile of a no-op route surfaces immediately.
 * Force it on or off in any env with `RUDDER_REQUEST_LOG=1` / `=0`.
 */
export function requestLogEnabled(env: {
  APP_ENV?: string | undefined
  NODE_ENV?: string | undefined
  RUDDER_REQUEST_LOG?: string | undefined
}): boolean {
  const flag = env.RUDDER_REQUEST_LOG
  if (flag === '1' || flag === 'true') return true
  if (flag === '0' || flag === 'false') return false
  return devErrorPageEnabled(env)
}

/**
 * Read a request body as text, bounded to `limit` bytes. A declared
 * `Content-Length` over the limit is rejected BEFORE anything is buffered — the
 * realistic large-body attack — so it can't exhaust memory. A body with no (or a
 * lying) `Content-Length` is buffered once and then rejected if oversized, which
 * caps a single request to one body and never amplifies. Reads a CLONE so the
 * original stream stays intact for handlers that consume it themselves (e.g. MCP
 * streaming).
 */
async function readBodyText(raw: Request, limit: number, contentType: string): Promise<string> {
  const cl = raw.headers.get('content-length')
  if (cl !== null && Number.isFinite(Number(cl)) && Number(cl) > limit) {
    throw new PayloadTooLargeError(contentType, limit)
  }
  const text = await raw.clone().text()
  if (Buffer.byteLength(text, 'utf8') > limit) {
    throw new PayloadTooLargeError(contentType, limit)
  }
  return text
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
function normalizeRequest(c: Context, trustProxy: boolean | number = false): AppRequest {
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
  // SPA-nav original URL + a boolean convenience, both backed by the per-request
  // `spaNavUrlStore` ALS (NOT a client header) so they're unforgeable. The store
  // is populated only when the outer fetch handler rewrote a controller-view
  // `.pageContext.json` request, so these read `undefined`/`false` for any direct
  // request. Supported replacement for the removed `x-rudder-original-url` header.
  Object.defineProperty(req, 'spaNavUrl', {
    get: () => spaNavUrlStore.getStore(),
    enumerable: true,
    configurable: true,
  })
  Object.defineProperty(req, 'isPageContextRequest', {
    get: () => spaNavUrlStore.getStore() !== undefined,
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

  // 204/205/304 (and 1xx) are null-body statuses: undici's Response constructor
  // throws "Invalid response status code" when a body is attached. send()/json()
  // must emit a bodyless response for these — e.g. a route doing
  // `res.status(204).send('')` (the Laravel `noContent()` equivalent).
  const isNullBodyStatus = () =>
    statusCode === 204 || statusCode === 205 || statusCode === 304 ||
    (statusCode >= 100 && statusCode < 200)

  // Tracks whether the wrapper's pending headers/cookies have already been
  // applied — either staged onto the Hono context by applyHeaders() (the
  // json()/send()/redirect() path) or merged into a finalized Response by
  // mergeInto() (the raw Response / ViewResponse path). Guards against applying
  // them twice, which for Set-Cookie means a duplicated cookie.
  let flushed = false

  const applyHeaders = () => {
    for (const [k, v] of Object.entries(headers)) c.header(k, v)
    for (const cookie of cookies) c.header('Set-Cookie', cookie, { append: true })
    flushed = true
  }

  // Merge pending headers/cookies into an already-finalized Response (used when
  // a ViewResponse or raw Response is returned directly, and by applyMiddleware
  // for global middleware that set headers then call next() — both bypass
  // res.json()/res.send() so applyHeaders() never fired). No-op once flushed, so
  // a double merge (or a merge after applyHeaders already ran) can't duplicate a
  // Set-Cookie. Mutates res.headers in place — cloning via
  // `new Response(body, { headers })` collapses multi-value Set-Cookie down to
  // one in Node's undici-backed fetch.
  const mergeInto = (res: Response): Response => {
    if (flushed) return res
    if (Object.keys(headers).length === 0 && cookies.length === 0) return res
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
    for (const cookie of cookies) res.headers.append('Set-Cookie', cookie)
    flushed = true
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
      c.res = isNullBodyStatus() ? c.body(null) : c.json(data)
      return c.res
    },
    send(data) {
      applyHeaders()
      c.status(statusCode as StatusCode)
      if (isNullBodyStatus()) {
        // No body allowed on 204/205/304 — honor the status, drop the body.
        c.res = c.body(null)
      } else if (headers['Content-Type'] || headers['content-type']) {
        // Use c.body() (not c.text()) so a custom Content-Type set via res.header()
        // is preserved. c.text() forces Content-Type: text/plain and overrides headers.
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
    intended(target, fallback = '/', code = 302) {
      c.res = c.redirect(safeRedirectTarget(target, fallback), code as RedirectStatusCode)
      return c.res
    },
  }
}

// ─── Request logger ────────────────────────────────────────

const g     = globalThis as Record<string, unknown>
const isTTY = process.stdout.isTTY ?? false
// Per-request access logging is a dev affordance — gated off in production (see
// requestLogEnabled). Captured once at module load; env does not change at runtime.
const REQUEST_LOG = requestLogEnabled(process.env)

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

// ─── controller-view path matcher ─────────────────────────
//
// Compile a Hono-style route pattern (`/users/:id`, `/posts/:slug{[a-z]+}`,
// `/admin/:tenant/:section?`) into a regex that tests whether a stripped
// `.pageContext.json` URL path corresponds to that route. Used purely as
// a yes/no gate for the Vike SPA-nav rewrite — we don't need to extract
// params here (Hono does that during real routing), just decide whether
// the controller would have matched.
//
// Optional `:param?` after a slash treats the slash as part of the
// optional group, so `/users/:id?` matches both `/users` and `/users/42`.
// Custom regex shards (`:slug{[a-z]+}`) pass through verbatim — this is
// the same syntax `RouteBuilder.where()` produces, and Hono evaluates
// the same way internally, so behaviour stays consistent across the
// `routes/web.ts` → adapter → SPA-nav rewrite path.
//
// Exported as `@internal` for the unit tests below; not part of the
// public API surface.
export function compileControllerViewRegex(path: string): RegExp {
  let result = '^'
  let i = 0
  while (i < path.length) {
    const ch = path[i]!
    // `/:param[?]{regex?}` — when a slash directly precedes a param, fold
    // it into the optional group so `/users/:id?` matches `/users` too.
    if (ch === '/' && path[i + 1] === ':') {
      let j = i + 2
      while (j < path.length && /[A-Za-z0-9_]/.test(path[j]!)) j++
      const optional = path[j] === '?'
      const afterOpt = optional ? j + 1 : j
      let segPattern = '[^/]+'
      let nextI      = afterOpt
      if (path[afterOpt] === '{') {
        const consumed = consumeBraceBlockLocal(path, afterOpt)
        segPattern = path.slice(afterOpt + 1, consumed - 1)
        nextI      = consumed
      }
      result += optional ? `(?:/${segPattern})?` : `/${segPattern}`
      i = nextI
      continue
    }
    if (ch === ':') {
      // Param at the start of the path (rare). Don't swallow a slash.
      let j = i + 1
      while (j < path.length && /[A-Za-z0-9_]/.test(path[j]!)) j++
      const optional = path[j] === '?'
      const afterOpt = optional ? j + 1 : j
      let segPattern = '[^/]+'
      let nextI      = afterOpt
      if (path[afterOpt] === '{') {
        const consumed = consumeBraceBlockLocal(path, afterOpt)
        segPattern = path.slice(afterOpt + 1, consumed - 1)
        nextI      = consumed
      }
      result += optional ? `(?:${segPattern})?` : segPattern
      i = nextI
      continue
    }
    if (ch === '*') { result += '.*';        i++; continue }
    if (/[.+?^${}()|[\]\\]/.test(ch)) { result += '\\' + ch; i++; continue }
    result += ch
    i++
  }
  return new RegExp(result + '$')
}

/**
 * Consume a `{...}` block starting at index `start` (which must point at
 * the opening `{`). Handles balanced nesting (`[0-9]{8}-...{12}` style),
 * `\{` / `\}` escapes, and `}` literals inside `[^}]` character classes.
 * Returns the index just past the closing `}`.
 *
 * Local to this file — `RouteBuilder.where()` in `@rudderjs/router` ships
 * its own copy under the same contract, so the two paths produce the
 * same regex segments. Kept private to avoid a circular import on the
 * router package.
 */
function consumeBraceBlockLocal(path: string, start: number): number {
  let depth   = 0
  let i       = start
  let inClass = false
  while (i < path.length) {
    const ch = path[i]!
    if (ch === '\\') { i += 2; continue }
    if (inClass) {
      if (ch === ']') inClass = false
      i++
      continue
    }
    if (ch === '[') { inClass = true; i++; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
    i++
  }
  // Unbalanced — fall back to "rest of string" so the regex at least
  // compiles. The route would never have worked at the Hono level either.
  return path.length
}

// ─── Test-mode side channel ───────────────────────────────
//
// `@rudderjs/testing` flips `globalThis['__rudderjs_test_mode__']` during
// bootstrap so the route handler emits two extra response headers:
//
//   x-rudderjs-test-session   base64(JSON({ data, flash }))   — when a session
//                                                              instance is on
//                                                              the request
//   x-rudderjs-test-view      base64(JSON({ id, props }))     — when the route
//                                                              returned a
//                                                              ViewResponse
//
// TestResponse on the test side reads + decodes these so apps can call
// `assertSessionHas('cart', ...)` / `assertViewIs('dashboard')` without
// re-coupling the testing package to session or view internals.
//
// Headers are inert in production — the global flag is never set unless a
// TestCase is running in this process.
function attachTestSideChannel(
  res:  Response,
  ctx:  Record<string, unknown>,
  meta: Record<string, unknown>,
): void {
  // Session — duck-typed on `.all()` so we don't depend on @rudderjs/session.
  // SessionInstance exposes `.all()` (data) and `.allFlash()` (flash).
  const sess = ctx['__rjs_session'] as
    | { all?: () => Record<string, unknown>; allFlash?: () => Record<string, unknown> }
    | undefined
  if (sess && typeof sess.all === 'function') {
    try {
      const payload = {
        data:  sess.all(),
        flash: typeof sess.allFlash === 'function' ? sess.allFlash() : {},
      }
      res.headers.set(
        'x-rudderjs-test-session',
        Buffer.from(JSON.stringify(payload)).toString('base64'),
      )
    } catch {
      // best-effort — a serialization failure (e.g. a circular value) must
      // not break the test response itself
    }
  }

  // View — `__rjs_view` only gets stashed when the handler returned a
  // ViewResponse. Full props live on `__rjs_response_body` (telescope already
  // captures them there).
  const view = meta['__rjs_view'] as { id?: string } | undefined
  if (view?.id) {
    const body = ctx['__rjs_response_body'] as
      | { view?: string; props?: Record<string, unknown> }
      | undefined
    try {
      const payload = {
        id:    view.id,
        props: body?.view === view.id ? (body.props ?? {}) : {},
      }
      res.headers.set(
        'x-rudderjs-test-view',
        Buffer.from(JSON.stringify(payload)).toString('base64'),
      )
    } catch {
      // best-effort — same rationale as session
    }
  }
}

// ─── Hono Adapter ─────────────────────────────────────────

class HonoAdapter implements ServerAdapter {
  private app: Hono
  private _trustProxy: boolean | number
  private _bodyLimit: number
  private _errorHandler?: (err: unknown, req: AppRequest) => Response | Promise<Response>
  private _groupMiddleware: Record<'web' | 'api', MiddlewareHandler[]> = { web: [], api: [] }
  /**
   * Set of static GET route paths registered via the router — paths without
   * `:param` segments. Hot path: the outer fetch handler does an O(1) Set
   * lookup on every `.pageContext.json` request to decide whether to rewrite
   * to a controller URL or let Vike handle it directly. Without this gate,
   * Vike's pageContext.json requests for its own pages would be misrouted
   * into Hono and return HTML instead of JSON.
   */
  readonly controllerViewPaths = new Set<string>()

  /**
   * Parameterised controller-view routes — paths containing `:param`. The
   * outer fetch handler falls back to a linear regex match over this array
   * when the static Set misses. Without this, SPA navigation between
   * `/users/:id`-style routes silently degrades to a full reload because
   * the `.pageContext.json` rewrite never fires.
   *
   * Compiled once at registerRoute() time. Tiny per app (one entry per
   * dynamic GET/ALL route), and the Set fast-path absorbs the static-route
   * majority — so the scan only runs for the small dynamic set.
   */
  readonly controllerViewPatterns: Array<{ regex: RegExp; path: string }> = []

  /**
   * @internal — match a stripped URL pathname against the registered
   * controller-view routes. Tries the static Set first (O(1)), then walks
   * the parameterised pattern list (O(n) over the dynamic-route count).
   * Returns the original pattern that matched (for diagnostics), or
   * `undefined` if no controller view claims this path.
   */
  _matchesControllerView(path: string): string | undefined {
    if (this.controllerViewPaths.has(path)) return path
    for (const entry of this.controllerViewPatterns) {
      if (entry.regex.test(path)) return entry.path
    }
    return undefined
  }

  constructor(app?: Hono, trustProxy: boolean | number = false, bodyLimit: number = DEFAULT_BODY_LIMIT) {
    this.app = app ?? new Hono()
    this._trustProxy = trustProxy
    this._bodyLimit = bodyLimit
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

    // Track GET / ALL routes as candidates for `view()` returns. The outer
    // fetch handler uses this index to know when a `.pageContext.json`
    // request should be rewritten into a controller call. Static paths go
    // into the Set (O(1) lookup on the hot path); parameterised paths
    // (`:id`, `:slug{[a-z]+}`, etc.) get compiled to a regex once and
    // appended to controllerViewPatterns for the slow-path scan.
    // Wildcard-only routes (`*` with no `:`) are intentionally excluded:
    // they're typically catch-all fallbacks, not `view()` returns, and the
    // pre-2026-05-22 implementation never matched them against dynamic
    // URLs either — preserving that opt-out shape.
    if (route.method === 'GET' || route.method === 'ALL') {
      if (route.path.includes(':')) {
        this.controllerViewPatterns.push({
          regex: compileControllerViewRegex(route.path),
          path:  route.path,
        })
      } else if (!route.path.includes('*')) {
        this.controllerViewPaths.add(route.path)
      }
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
      //
      // **Clone before consuming.** `c.req.json()` / `c.req.text()` go straight
      // through to the raw Web Request's `.text()`, which consumes the body
      // stream. Handlers that need raw streaming access (e.g. `@rudderjs/mcp`'s
      // `WebStandardStreamableHTTPServerTransport`, which reads
      // `c.req.raw.body` to parse the JSON-RPC payload itself) would hang on
      // an empty stream. Cloning preserves the original stream for the handler.
      if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
        const ct = c.req.header('content-type') ?? ''
        if (ct.includes('application/json')) {
          // Read the body (size-bounded) as text first so we can distinguish
          // empty bodies (leave req.body at the default — validators emit their
          // normal "field required" errors) from malformed JSON (throw 400 via
          // the central exception pipeline — see MalformedBodyError's httpStatus
          // duck-type in `@rudderjs/core/src/app-builder.ts`). The old
          // `req.body = {}` fallback made malformed requests look like
          // missing-field validation errors to handlers.
          const text = await readBodyText(c.req.raw, this._bodyLimit, 'application/json')
          if (text.length > 0) {
            try { req.body = JSON.parse(text) }
            catch (e) {
              throw new MalformedBodyError('application/json', e instanceof Error ? e : undefined)
            }
          }
        } else if (ct.includes('application/x-www-form-urlencoded')) {
          // `URLSearchParams` is tolerant — it never throws on malformed
          // input, just parses what it can. Only a body-stream read error
          // (or the size guard) surfaces here.
          let text: string
          try {
            text = await readBodyText(c.req.raw, this._bodyLimit, 'application/x-www-form-urlencoded')
          } catch (e) {
            if (e instanceof PayloadTooLargeError) throw e
            throw new MalformedBodyError('application/x-www-form-urlencoded', e instanceof Error ? e : undefined)
          }
          if (text.length > 0) {
            req.body = Object.fromEntries(new URLSearchParams(text))
          }
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
            // instead of HTML for SPA navigation. The original URL comes from a
            // per-request ALS set ONLY by the outer fetch handler's SPA-nav
            // rewrite — never from a client header, which a direct request could
            // forge to inject an arbitrary URL into Vike's renderPage routing.
            const originalUrl = spaNavUrlStore.getStore() ?? c.req.url
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

      // Test-mode side channel — only emitted when @rudderjs/testing has
      // flipped the global flag during bootstrap. Lets TestResponse assert on
      // session payload and rendered view id/props without re-coupling to the
      // session or view packages on the test side. Headers use the reserved
      // `x-rudderjs-` prefix (so apps can't set them) and base64-encode JSON
      // to dodge header-value escaping rules.
      if (g['__rudderjs_test_mode__'] === true && c.res) {
        attachTestSideChannel(c.res, stash(c), meta)
      }

      return c.res as Response
    })
  }

  applyMiddleware(middleware: MiddlewareHandler): void {
    this.app.use('*', async (c, honoNext) => {
      const req = normalizeRequest(c, this._trustProxy)
      const res = normalizeResponse(c)
      // Capture THIS wrapper's pending-merge now — a downstream normalizeResponse
      // (route handler, inner global middleware) overwrites the stash before we
      // unwind. On the short-circuit path (middleware called res.json()/send())
      // applyHeaders already ran, so merge is a no-op via the flushed guard.
      const merge = stash(c)['__rjs_merge_pending'] as ((r: Response) => Response) | undefined
      await middleware(req, res, honoNext)
      // Apply anything the middleware wrote via res.header() on the pass-through
      // path — without this, a global m.use middleware that sets a response
      // header then calls next() (e.g. RateLimit's X-RateLimit-*) silently loses
      // it, because the downstream response bypasses this wrapper's applyHeaders.
      if (merge && c.res) c.res = merge(c.res)
      // Hono v4 requires the handler to finalize the context.
      // c.res is always a valid Response (downstream response, or Hono's 404 default).
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
  // `/* @vite-ignore */` silences Vite's "dynamic import cannot be analyzed"
  // warning — the string-variable indirection is intentional so the TS build
  // doesn't hard-resolve the peer.
  void import(/* @vite-ignore */ viewModuleSpecifier)
    .then((m: { prewarmVikeServer?: () => Promise<unknown> }) =>
      m.prewarmVikeServer?.())
    .catch(() => { /* view not installed — fine */ })
}

export function hono(config: HonoConfig = {}): ServerAdapterProvider {
  return {
    type: 'hono',

    create(): ServerAdapter {
      return new HonoAdapter(undefined, config.trustProxy ?? false, config.bodyLimit ?? DEFAULT_BODY_LIMIT)
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

      // Secure-by-default: the rich dev error page (full stack + on-disk source
      // + ALL request headers, incl. Authorization/Cookie) renders ONLY when the
      // env is EXPLICITLY development/local. An unset or unrecognized env is
      // treated as production, so a deploy that forgets `NODE_ENV=production`
      // can't leak source + secrets — the inverse of the old
      // `APP_ENV==='production' || NODE_ENV==='production'` gate, which defaulted
      // to the leaky dev page whenever neither var was set.
      const isProd = !devErrorPageEnabled(process.env)

      const adapter = new HonoAdapter(app, trustProxy, config.bodyLimit ?? DEFAULT_BODY_LIMIT)
      setup?.(adapter)

      // Install error handler — setup() may have registered one via adapter.setErrorHandler().
      // The registered handler auto-handles ValidationError → 422 and re-throws everything
      // else, which falls through to the dev error page (dev) or a JSON 500 (prod).
      const userHandler = adapter.getErrorHandler()
      if (userHandler) {
        app.onError(async (err, c) => {
          // Remap the stack to true source positions BEFORE any consumer reads
          // it — the app's error handler (e.g. a JSON debug-trace renderer), the
          // dev Ignition page, and logging all benefit. Dev-only no-op (the hook
          // is only registered under `vite dev`).
          if (err instanceof Error) applyDevStackFix(err)
          try {
            return await userHandler(err, normalizeRequest(c, trustProxy))
          } catch (e2) {
            const thrown = e2 instanceof Error ? e2 : new Error(String(e2))
            if (!isProd) {
              applyDevStackFix(thrown)
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
          const e = err instanceof Error ? err : new Error(String(err))
          applyDevStackFix(e)
          const html = renderErrorPage(e, { method: c.req.method, url: c.req.url, headers: Object.fromEntries(Object.entries(c.req.header())) })
          return c.html(html, 500)
        })
      }

      // Attach Vike SSR middleware.
      //
      // Pass Vike's config-declared middlewares (https://vike.dev/middleware) so
      // they mount as their OWN routes ahead of the catch-all, rather than only
      // being dispatched from inside the catch-all's renderPageServer. This is
      // load-bearing for React Server Components: vike-react-rsc-rudder declares a
      // `/_rsc` middleware that itself calls renderPageServer — reachable only via
      // the catch-all, that becomes a *re-entrant* renderPageServer (catch-all
      // renderPageServer → dispatch `/_rsc` → renderPageServer again), which trips
      // Vike's dev request logger and 500s server actions. A direct route renders
      // `/_rsc` exactly once.
      //
      // No-op for renderers without config middlewares (e.g. vike-react):
      // `vike(app, [])` is byte-identical to `vike(app)`. Best-effort — if the
      // global context isn't ready at setup time, fall back to the catch-all,
      // which still dispatches config middlewares internally (fine for page
      // renders; only RSC actions need the direct route).
      let configMiddlewares: unknown[] = []
      try {
        const { getGlobalContext } = await import('vike/server')
        const gc = (await getGlobalContext()) as { config?: { middleware?: unknown[] } }
        configMiddlewares = (gc?.config?.middleware ?? []).flat()
      } catch {
        // Vike global context not initialised yet — keep the catch-all only.
      }
      vike(app, configMiddlewares as Parameters<typeof vike>[1])

      // Logging at the outermost fetch level catches ALL requests — including Vike's
      // client-side navigation data fetches, which bypass the Hono middleware chain.
      return async (request) => {
        const perfId = startRequest()
        markBoundary(perfId, B.HONO_FETCH_IN)
        // Vike client-router SPA nav: rewrite /<path>.pageContext.json → /<path>
        // so the controller route matches. Carry the original URL on a per-request
        // ALS (spaNavUrlStore) so ViewResponse.toResponse() can pass it back to
        // Vike — Vike then emits the JSON pageContext envelope instead of HTML, and
        // the client does a smooth SPA transition. Without this, every controller-
        // view link is a full reload. The ALS (not a header) is what keeps a direct
        // client from forging the URL handed to Vike's renderPage routing.
        // Vike's client router uses `/<path>/index.pageContext.json` (the
        // `/index` prefix is hard-coded — see Vike's handlePageContextRequestUrl).
        // For controller-view URLs, strip that suffix and route to the
        // controller; the controller returns a ViewResponse, and toResponse()
        // hands the original URL back to renderPage so Vike emits JSON.
        // For pageContext.json requests targeting normal Vike pages, leave
        // the request alone — Vike's middleware handles those directly.
        let actualRequest = request
        let spaOriginalUrl: string | undefined
        const reqUrl = new URL(request.url)
        const PAGE_CTX_SUFFIX = '/index.pageContext.json'
        if (reqUrl.pathname.endsWith(PAGE_CTX_SUFFIX)) {
          const stripped = reqUrl.pathname.slice(0, -PAGE_CTX_SUFFIX.length) || '/'
          // _matchesControllerView() walks the static Set first (O(1)) and
          // falls back to scanning compiled patterns for parameterised
          // routes (`/users/:id` etc.) — without this fallback, SPA nav
          // between dynamic-segment views silently degrades to full reloads.
          if (adapter._matchesControllerView(stripped)) {
            const rewrittenUrl = new URL(request.url)
            rewrittenUrl.pathname = stripped
            actualRequest = new Request(rewrittenUrl.toString(), {
              method: request.method,
              headers: request.headers,
            })
            spaOriginalUrl = request.url
          }
        }

        // Run the app under the SPA-nav ALS when (and only when) we did the
        // rewrite ourselves. A non-rewritten request has no store, so the route
        // handler's `spaNavUrlStore.getStore()` returns undefined and falls back
        // to the request's own URL — a client-sent value never reaches Vike.
        const fetchApp = (): Response | Promise<Response> =>
          spaOriginalUrl !== undefined
            ? spaNavUrlStore.run(spaOriginalUrl, () => runWithRequest(perfId, () => app.fetch(actualRequest)))
            : runWithRequest(perfId, () => app.fetch(actualRequest))

        // Skip the access-log path entirely when logging is off (production
        // default): no URL parse, no logPath, no counter, no console.log.
        const display = REQUEST_LOG ? logPath(new URL(request.url).pathname) : null
        if (display === null) {
          markBoundary(perfId, B.APP_FETCH_IN)
          const r = await fetchApp()
          markBoundary(perfId, B.APP_FETCH_OUT)
          markBoundary(perfId, B.HONO_FETCH_OUT)
          finishRequest(perfId)
          return r
        }
        const n     = nextReqId()
        const start = performance.now()
        markBoundary(perfId, B.APP_FETCH_IN)
        const res   = await fetchApp()
        markBoundary(perfId, B.APP_FETCH_OUT)
        console.log(formatRequestLog(n, display, res.status, performance.now() - start))
        markBoundary(perfId, B.HONO_FETCH_OUT)
        finishRequest(perfId)
        return res
      }
    },
  }
}