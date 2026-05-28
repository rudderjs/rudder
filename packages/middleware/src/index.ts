import crypto from 'node:crypto'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@rudderjs/contracts'

// ─── Base Middleware Class ─────────────────────────────────

export abstract class Middleware {
  abstract handle(
    req: AppRequest,
    res: AppResponse,
    next: () => Promise<void>
  ): void | Promise<void>

  /** Convert class instance to a handler function */
  toHandler(): MiddlewareHandler {
    const handler = (req: AppRequest, res: AppResponse, next: () => Promise<void>) => this.handle(req, res, next)
    Object.defineProperty(handler, 'name', { value: this.constructor.name })
    return handler
  }
}

// ─── Pipeline ─────────────────────────────────────────────

export class Pipeline {
  private middleware: MiddlewareHandler[]

  constructor(middleware: MiddlewareHandler[] = []) {
    this.middleware = middleware
  }

  static make(): Pipeline {
    return new Pipeline()
  }

  through(middleware: MiddlewareHandler[]): this {
    this.middleware = middleware
    return this
  }

  async run(
    req: AppRequest,
    res: AppResponse,
    destination: () => Promise<void>
  ): Promise<void> {
    let idx = 0
    const stack = [...this.middleware]

    const next = async (): Promise<void> => {
      const fn = stack[idx++]
      if (fn) {
        await fn(req, res, next)
      } else {
        await destination()
      }
    }

    await next()
  }
}

// ─── Built-in Middleware ───────────────────────────────────

/** CORS middleware */
export class CorsMiddleware extends Middleware {
  constructor(
    private options: {
      origin?: string | string[]
      methods?: string[]
      headers?: string[]
    } = {}
  ) {
    super()
  }

  handle(req: AppRequest, res: AppResponse, next: () => Promise<void>): Promise<void> {
    const methods = (this.options.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', ')
    const headers = (this.options.headers ?? ['Content-Type', 'Authorization']).join(', ')

    // CORS spec: Access-Control-Allow-Origin must be '*' or a single origin.
    // For an allowlist, reflect the request's Origin only when it matches.
    const requestOrigin = req.headers['origin'] as string | undefined
    let origin: string
    if (Array.isArray(this.options.origin)) {
      origin = (requestOrigin && this.options.origin.includes(requestOrigin))
        ? requestOrigin
        : this.options.origin[0] ?? '*'
    } else {
      origin = this.options.origin ?? '*'
    }

    res.header('Access-Control-Allow-Origin',  origin)
    res.header('Access-Control-Allow-Methods', methods)
    res.header('Access-Control-Allow-Headers', headers)

    return next()
  }
}

/** Request logger middleware */
export class LoggerMiddleware extends Middleware {
  async handle(req: AppRequest, res: AppResponse, next: () => Promise<void>): Promise<void> {
    const start = Date.now()
    await next()
    const ms = Date.now() - start
    console.log(`[RudderJS] ${req.method} ${req.path} — ${ms}ms`)
  }
}

/** Simple rate limiter middleware (in-memory, skips static assets & Vite internals) */
export class ThrottleMiddleware extends Middleware {
  private hits = new Map<string, { count: number; reset: number }>()

  constructor(
    private max: number = 60,
    private windowMs: number = 60_000
  ) {
    super()
  }

  /** True for Vite internals and static assets — these should not be rate-limited */
  private isAsset(path: string): boolean {
    if (path.startsWith('/@')) return true        // Vite internals (/@vite, /@react-refresh, …)
    if (path.startsWith('/node_modules')) return true
    const segment = path.split('/').pop() ?? ''
    return segment.includes('.')                  // any file extension → static asset
  }

  /** Best-effort client identifier from request headers */
  private clientKey(req: AppRequest): string {
    return (req as unknown as Record<string, unknown>)['ip'] as string ?? 'unknown'
  }

  handle(req: AppRequest, res: AppResponse, next: () => Promise<void>): Promise<void> {
    // Never throttle static assets — would break Vite HMR and page loads in dev
    if (this.isAsset(req.path)) return next()

    const key = this.clientKey(req)
    const now = Date.now()
    const rec = this.hits.get(key)

    if (!rec || now > rec.reset) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs })
      return next()
    }

    if (rec.count >= this.max) {
      const retryAfter = Math.max(1, Math.ceil((rec.reset - now) / 1000))
      res.header('Retry-After', String(retryAfter))
      res.status(429).json({ message: `Too many requests. Retry after ${retryAfter}s.` })
      return Promise.resolve()
    }

    rec.count++
    return next()
  }
}

// ─── CSRF Middleware ───────────────────────────────────────

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(
    header.split(';')
      .map(c => c.trim().split('='))
      .filter(([k]) => k?.trim())
      .map(([k, ...v]) => [(k ?? '').trim(), v.join('=')])
  )
}

function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

export interface CsrfOptions {
  /** Paths to skip CSRF validation (supports trailing * wildcard) */
  exclude?: string[]
  cookieName?: string
  headerName?: string
  fieldName?: string
}

/**
 * CSRF protection using the double-submit cookie pattern.
 *
 * - Sets a `csrf_token` cookie on every GET request (readable by JS, not HttpOnly)
 * - Validates that POST/PUT/PATCH/DELETE requests include a matching token via
 *   the `X-CSRF-Token` header or `_token` body field
 * - Returns 419 when the token is missing or mismatched
 *
 * Client-side: use `getCsrfToken()` to read the token from the cookie.
 */
class _CsrfMiddleware extends Middleware {
  private readonly cookieName: string
  private readonly headerName: string
  private readonly fieldName:  string

  constructor(private readonly options: CsrfOptions = {}) {
    super()
    this.cookieName = options.cookieName ?? 'csrf_token'
    this.headerName = options.headerName ?? 'x-csrf-token'
    this.fieldName  = options.fieldName  ?? '_token'
  }

  private isExcluded(path: string): boolean {
    return (this.options.exclude ?? []).some(p =>
      p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p
    )
  }

  async handle(req: AppRequest, res: AppResponse, next: () => Promise<void>): Promise<void> {
    // Skip static assets and Vite internals
    if (req.path.startsWith('/@') || (req.path.split('/').pop() ?? '').includes('.')) {
      return next()
    }

    const cookies  = parseCookies(req.headers['cookie'] ?? '')
    const existing = cookies[this.cookieName]

    // Ensure cookie is always present
    if (!existing) {
      const token = generateCsrfToken()
      res.header('Set-Cookie', `${this.cookieName}=${token}; Path=/; SameSite=Strict`)
    }

    // Safe methods — no validation needed
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

    // Excluded paths
    if (this.isExcluded(req.path)) return next()

    // Validate
    const body         = req.body as Record<string, unknown> | null
    const requestToken = (req.headers[this.headerName] as string | undefined)
                      ?? (body?.[this.fieldName] as string | undefined)

    if (!existing || !requestToken || !timingSafeEqual(existing, requestToken)) {
      res.status(419).json({
        message:
          'CSRF token mismatch. The "_token" form field or "X-CSRF-Token" header didn\'t match the ' +
          '"csrf_token" cookie. For fetch() calls, read the token via getCsrfToken() and set the ' +
          'X-CSRF-Token header.',
        error: 'CSRF_MISMATCH',
      })
      return
    }

    return next()
  }
}

export function CsrfMiddleware(options?: CsrfOptions): MiddlewareHandler {
  const handler = new _CsrfMiddleware(options).toHandler()
  Object.defineProperty(handler, 'name', { value: 'CsrfMiddleware' })
  return handler
}

// Re-exported from the client subpath so server code can still
// `import { getCsrfToken } from '@rudderjs/middleware'`. Browser code
// should import from `@rudderjs/middleware/client` to avoid pulling
// the server-only barrel into the client bundle.
export { getCsrfToken } from './client.js'

// ─── Helper to convert class-based middleware to handler ───

export function fromClass(MiddlewareClass: new () => Middleware): MiddlewareHandler {
  return new MiddlewareClass().toHandler()
}

// ─── Rate Limiting ─────────────────────────────────────────

import { CacheRegistry } from '@rudderjs/cache'

type KeyExtractor = 'ip' | 'route' | ((req: AppRequest) => string)

interface RateLimitOptions {
  max:      number
  windowMs: number
  keyBy:    KeyExtractor
  message:  string
  skipIf?:  (req: AppRequest) => boolean
}

function clientIp(req: AppRequest): string {
  return (req as unknown as Record<string, unknown>)['ip'] as string ?? 'unknown'
}

function buildKey(keyBy: KeyExtractor, req: AppRequest): string {
  if (keyBy === 'ip')    return clientIp(req)
  if (keyBy === 'route') return `${req.method}:${req.path}`
  return keyBy(req)
}

function isRateLimitAsset(path: string): boolean {
  if (path.startsWith('/@'))           return true
  if (path.startsWith('/node_modules')) return true
  return (path.split('/').pop() ?? '').includes('.')
}

// First-time warning when RateLimit runs with no cache provider registered.
// The middleware deliberately falls through to `next()` (silent bypass) so a
// missing cache doesn't 500 every request — but a deployment that THOUGHT it
// had rate limits when it doesn't is a security-relevant gap. One stderr line
// per process surfaces the misconfiguration without log-spamming on every
// hit. Process-scoped (module variable) is fine: re-evaluation under HMR
// re-arms the warning, which is desirable in dev.
let _warnedNoCache = false
function _warnNoCacheOnce(): void {
  if (_warnedNoCache) return
  _warnedNoCache = true
  console.warn(
    '[RudderJS Middleware] RateLimit installed but no cache provider is registered — ' +
    'limits are NOT being enforced. Register @rudderjs/cache (or another cache adapter) ' +
    'to enable.',
  )
}

// Per-limiter cache-key namespace. Every `RateLimit.perMinute(...)` call
// (and every chained `.by(...).message(...)` derivation) gets its own slot.
// Without this, two limiters keyed by the same client identifier (e.g. IP)
// would share a single bucket — a global `RateLimit.perMinute(60)` on the
// `web` group would consume the same counter as a route-scoped
// `RateLimit.perMinute(5)` on `/auth/sign-up`, so 5 web-group GETs would
// burn the 6th sign-up attempt's quota even though the user has done one.
// Each handler-instance now namespaces its bucket so siblings stay isolated.
let _rateLimitInstanceCounter = 0
function nextRateLimitId(): string {
  _rateLimitInstanceCounter++
  return `rl${_rateLimitInstanceCounter}`
}

function makeRateLimitHandler(opts: RateLimitOptions, instanceId: string): MiddlewareHandler {
  return async function RateLimit(req: AppRequest, res: AppResponse, next: () => Promise<void>) {
    if (isRateLimitAsset(req.path)) return next()
    if (opts.skipIf?.(req))         return next()

    const cache = CacheRegistry.get()
    if (!cache) {
      _warnNoCacheOnce()
      return next()
    }

    const now    = Date.now()
    const ttlSec = Math.max(1, Math.ceil(opts.windowMs / 1000))
    const cKey   = `rudderjs:rl:${instanceId}:${buildKey(opts.keyBy, req)}`
    const mKey   = `${cKey}:exp`

    // Atomic counter — race-free under concurrent requests (RFC 6819 §5.2.2.3
    // class of bug). The previous get → modify → set let two parallel hits
    // both observe `count = N` and both write `N + 1`, doubling the effective
    // limit. INCRBY on Redis (or the in-process atomic on the Memory driver)
    // closes that window.
    const count = await cache.increment(cKey, 1, ttlSec)

    // Window expiry is tracked in a sibling key so the X-RateLimit-Reset
    // header reflects the same moment for every request in the window. The
    // first hit (count === 1) writes it; later hits read it. A vanishingly
    // small race between A's `increment` returning 1 and A's meta write
    // can make B (with `count === 2`) miss the meta — we fall back to
    // `now + windowMs`, off by milliseconds and corrected on the next hit.
    let expiresAt: number
    if (count === 1) {
      expiresAt = now + opts.windowMs
      await cache.set(mKey, expiresAt, ttlSec)
    } else {
      expiresAt = (await cache.get<number>(mKey)) ?? (now + opts.windowMs)
    }

    const remaining = Math.max(0, opts.max - count)
    const retryAfter = Math.max(1, Math.ceil((expiresAt - now) / 1000))

    res.header('X-RateLimit-Limit',     String(opts.max))
    res.header('X-RateLimit-Remaining', String(remaining))
    res.header('X-RateLimit-Reset',     String(Math.ceil(expiresAt / 1000)))

    if (count > opts.max) {
      res.header('Retry-After', String(retryAfter))
      res.status(429).json({ message: opts.message })
      return
    }

    return next()
  }
}

// ─── RateLimit fluent handler ──────────────────────────────
//
// RateLimit.perMinute(60) returns a MiddlewareHandler that is also
// chainable — no .toHandler() call needed.

export interface RateLimitHandler extends MiddlewareHandler {
  /** Identify clients by IP address (default) */
  byIp():   RateLimitHandler
  /** Identify clients by HTTP method + path */
  byRoute(): RateLimitHandler
  /** Identify clients by a custom key function */
  by(fn: (req: AppRequest) => string): RateLimitHandler
  /** Override the 429 response message */
  message(msg: string): RateLimitHandler
  /** Skip rate limiting when this predicate returns true */
  skipIf(fn: (req: AppRequest) => boolean): RateLimitHandler
  /** @deprecated Use the handler directly — kept for backwards compatibility */
  toHandler(): MiddlewareHandler
}

function buildRateLimit(opts: RateLimitOptions): RateLimitHandler {
  const id = nextRateLimitId()
  const fn = makeRateLimitHandler(opts, id) as RateLimitHandler
  // Chainable methods construct fresh limiters with fresh ids — the chained
  // result is the one attached to the route, so each chain produces an
  // independent bucket. Configurations meant to share a bucket (one handler
  // reused across multiple routes) keep doing so naturally because the same
  // handler reference carries the same id.
  fn.byIp    = ()  => buildRateLimit({ ...opts, keyBy: 'ip' })
  fn.byRoute = ()  => buildRateLimit({ ...opts, keyBy: 'route' })
  fn.by      = (f) => buildRateLimit({ ...opts, keyBy: f })
  fn.message = (m) => buildRateLimit({ ...opts, message: m })
  fn.skipIf  = (f) => buildRateLimit({ ...opts, skipIf: f })
  fn.toHandler = () => makeRateLimitHandler(opts, id)
  return fn
}

/** @deprecated Use RateLimitHandler directly — kept for backwards compatibility */
export type RateLimitBuilder = RateLimitHandler

/**
 * Cache-backed rate limiter middleware.
 *
 * Uses the active @rudderjs/cache adapter — works with memory (dev) or Redis (prod).
 * Respects X-Forwarded-For and sets standard X-RateLimit-* + Retry-After headers.
 *
 * Usage:
 *   // Global (in bootstrap/app.ts)
 *   .withMiddleware(m => m.use(RateLimit.perMinute(60)))
 *
 *   // Per-route
 *   Route.post('/auth/sign-in', handler, [
 *     RateLimit.perMinute(5).message('Too many login attempts.')
 *   ])
 */
export class RateLimit {
  /** N requests per minute */
  static perMinute(max: number): RateLimitHandler { return buildRateLimit({ max, windowMs: 60_000,      keyBy: 'ip', message: 'Too many requests. Please slow down.' }) }

  /** N requests per hour */
  static perHour(max: number): RateLimitHandler   { return buildRateLimit({ max, windowMs: 3_600_000,   keyBy: 'ip', message: 'Too many requests. Please slow down.' }) }

  /** N requests per day */
  static perDay(max: number): RateLimitHandler    { return buildRateLimit({ max, windowMs: 86_400_000,  keyBy: 'ip', message: 'Too many requests. Please slow down.' }) }

  /** N requests per custom window (milliseconds) */
  static per(max: number, windowMs: number): RateLimitHandler { return buildRateLimit({ max, windowMs, keyBy: 'ip', message: 'Too many requests. Please slow down.' }) }
}
