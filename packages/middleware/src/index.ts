import crypto from 'node:crypto'
import type { MiddlewareHandler, AppRequest, AppResponse } from '@boostkit/contracts'

// ─── Base Middleware Class ─────────────────────────────────

export abstract class Middleware {
  abstract handle(
    req: AppRequest,
    res: AppResponse,
    next: () => Promise<void>
  ): void | Promise<void>

  /** Convert class instance to a handler function */
  toHandler(): MiddlewareHandler {
    return (req, res, next) => this.handle(req, res, next)
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
    const origin  = Array.isArray(this.options.origin)
      ? this.options.origin.join(', ')
      : (this.options.origin ?? '*')
    const methods = (this.options.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', ')
    const headers = (this.options.headers ?? ['Content-Type', 'Authorization']).join(', ')

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
    console.log(`[BoostKit] ${req.method} ${req.path} — ${ms}ms`)
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
    return (
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
      req.headers['x-real-ip'] ??
      'unknown'
    )
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
      res.status(429).json({ message: 'Too many requests. Please slow down.' })
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
      .map(([k, ...v]) => [k!.trim(), v.join('=')])
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
      res.status(419).json({ message: 'CSRF token mismatch.', error: 'CSRF_MISMATCH' })
      return
    }

    return next()
  }
}

export function CsrfMiddleware(options?: CsrfOptions): MiddlewareHandler {
  return new _CsrfMiddleware(options).toHandler()
}

/**
 * Read the CSRF token from the browser cookie (client-side only).
 * Safe to call in SSR — returns '' on the server.
 */
export function getCsrfToken(cookieName = 'csrf_token'): string {
  if (typeof (globalThis as Record<string, unknown>)['document'] === 'undefined') return ''
  const doc = (globalThis as Record<string, unknown>)['document'] as { cookie: string }
  const match = doc.cookie.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`))
  return match ? decodeURIComponent(match[1]!) : ''
}

// ─── Helper to convert class-based middleware to handler ───

export function fromClass(MiddlewareClass: new () => Middleware): MiddlewareHandler {
  return new MiddlewareClass().toHandler()
}

// ─── Rate Limiting ─────────────────────────────────────────

import { CacheRegistry } from '@boostkit/cache'

let _rateLimitWarned = false

type KeyExtractor = 'ip' | 'route' | ((req: AppRequest) => string)

interface RateLimitOptions {
  max:      number
  windowMs: number
  keyBy:    KeyExtractor
  message:  string
  skipIf?:  (req: AppRequest) => boolean
}

interface RateRecord {
  count:     number
  expiresAt: number   // epoch ms — end of the current window
}

function clientIp(req: AppRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    (req.headers['x-real-ip'] as string | undefined) ??
    'unknown'
  )
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

function makeRateLimitHandler(opts: RateLimitOptions): MiddlewareHandler {
  return async (req: AppRequest, res: AppResponse, next: () => Promise<void>) => {
    if (isRateLimitAsset(req.path)) return next()
    if (opts.skipIf?.(req))         return next()

    const cache = CacheRegistry.get()
    if (!cache) {
      if (!_rateLimitWarned) {
        _rateLimitWarned = true
        console.warn(
          '[BoostKit] RateLimit is active but no cache adapter is registered — throttling disabled.\n' +
          '  Add cache(configs.cache) to your providers list in bootstrap/providers.ts'
        )
      }
      return next()
    }

    const now    = Date.now()
    const cKey   = `boostkit:rl:${buildKey(opts.keyBy, req)}`
    const record = await cache.get<RateRecord>(cKey)

    let count:     number
    let expiresAt: number

    if (!record || now > record.expiresAt) {
      count     = 1
      expiresAt = now + opts.windowMs
    } else {
      count     = record.count + 1
      expiresAt = record.expiresAt
    }

    const ttlSec = Math.max(1, Math.ceil((expiresAt - now) / 1000))
    await cache.set(cKey, { count, expiresAt } satisfies RateRecord, ttlSec)

    const remaining = Math.max(0, opts.max - count)

    res.header('X-RateLimit-Limit',     String(opts.max))
    res.header('X-RateLimit-Remaining', String(remaining))
    res.header('X-RateLimit-Reset',     String(Math.ceil(expiresAt / 1000)))

    if (count > opts.max) {
      res.header('Retry-After', String(ttlSec))
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
  const fn = makeRateLimitHandler(opts) as RateLimitHandler
  fn.byIp    = ()  => buildRateLimit({ ...opts, keyBy: 'ip' })
  fn.byRoute = ()  => buildRateLimit({ ...opts, keyBy: 'route' })
  fn.by      = (f) => buildRateLimit({ ...opts, keyBy: f })
  fn.message = (m) => buildRateLimit({ ...opts, message: m })
  fn.skipIf  = (f) => buildRateLimit({ ...opts, skipIf: f })
  fn.toHandler = () => makeRateLimitHandler(opts)
  return fn
}

/** @deprecated Use RateLimitHandler directly — kept for backwards compatibility */
export type RateLimitBuilder = RateLimitHandler

/**
 * Cache-backed rate limiter middleware.
 *
 * Uses the active @boostkit/cache adapter — works with memory (dev) or Redis (prod).
 * Respects X-Forwarded-For and sets standard X-RateLimit-* + Retry-After headers.
 *
 * Usage:
 *   // Global (in bootstrap/app.ts)
 *   .withMiddleware(m => m.use(RateLimit.perMinute(60)))
 *
 *   // Per-route
 *   Route.post('/api/auth/sign-in', handler, [
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
