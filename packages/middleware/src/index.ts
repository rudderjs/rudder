import type { MiddlewareHandler, BoostKitRequest, BoostKitResponse } from '@boostkit/contracts'

// ─── Base Middleware Class ─────────────────────────────────

export abstract class Middleware {
  abstract handle(
    req: BoostKitRequest,
    res: BoostKitResponse,
    next: () => Promise<void>
  ): void | Promise<void>

  /** Convert class instance to a handler function */
  toHandler(): MiddlewareHandler {
    return (req, res, next) => this.handle(req, res, next)
  }
}

// ─── Pipeline ─────────────────────────────────────────────

export class Pipeline {
  private middleware: MiddlewareHandler[] = []

  static make(): Pipeline {
    return new Pipeline()
  }

  through(middleware: MiddlewareHandler[]): this {
    this.middleware = middleware
    return this
  }

  async run(
    req: BoostKitRequest,
    res: BoostKitResponse,
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

  handle(req: BoostKitRequest, res: BoostKitResponse, next: () => Promise<void>): Promise<void> {
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
  async handle(req: BoostKitRequest, res: BoostKitResponse, next: () => Promise<void>): Promise<void> {
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
  private clientKey(req: BoostKitRequest): string {
    return (
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
      req.headers['x-real-ip'] ??
      'unknown'
    )
  }

  handle(req: BoostKitRequest, res: BoostKitResponse, next: () => Promise<void>): Promise<void> {
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

// ─── Helper to convert class-based middleware to handler ───

export function fromClass(MiddlewareClass: new () => Middleware): MiddlewareHandler {
  return new MiddlewareClass().toHandler()
}

// ─── Rate Limiting ─────────────────────────────────────────

import { CacheRegistry } from '@boostkit/cache'

type KeyExtractor = 'ip' | 'route' | ((req: BoostKitRequest) => string)

interface RateLimitOptions {
  max:      number
  windowMs: number
  keyBy:    KeyExtractor
  message:  string
  skipIf?:  (req: BoostKitRequest) => boolean
}

interface RateRecord {
  count:     number
  expiresAt: number   // epoch ms — end of the current window
}

function clientIp(req: BoostKitRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    (req.headers['x-real-ip'] as string | undefined) ??
    'unknown'
  )
}

function buildKey(keyBy: KeyExtractor, req: BoostKitRequest): string {
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
  return async (req: BoostKitRequest, res: BoostKitResponse, next: () => Promise<void>) => {
    if (isRateLimitAsset(req.path)) return next()
    if (opts.skipIf?.(req))         return next()

    const cache = CacheRegistry.get()
    if (!cache) return next()

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

export class RateLimitBuilder {
  private opts: RateLimitOptions

  constructor(max: number, windowMs: number) {
    this.opts = { max, windowMs, keyBy: 'ip', message: 'Too many requests. Please slow down.' }
  }

  /** Identify clients by IP address (default) */
  byIp(): this    { this.opts = { ...this.opts, keyBy: 'ip' };    return this }

  /** Identify clients by HTTP method + path (useful for endpoint-level limits) */
  byRoute(): this { this.opts = { ...this.opts, keyBy: 'route' }; return this }

  /** Identify clients by a custom key function */
  by(fn: (req: BoostKitRequest) => string): this { this.opts = { ...this.opts, keyBy: fn }; return this }

  /** Override the 429 response message */
  message(msg: string): this { this.opts = { ...this.opts, message: msg }; return this }

  /** Skip rate limiting entirely when this predicate returns true */
  skipIf(fn: (req: BoostKitRequest) => boolean): this { this.opts = { ...this.opts, skipIf: fn }; return this }

  /** Returns a MiddlewareHandler ready for use in router or withMiddleware() */
  toHandler(): MiddlewareHandler { return makeRateLimitHandler(this.opts) }
}

/**
 * Cache-backed rate limiter middleware.
 *
 * Uses the active @boostkit/cache adapter — works with memory (dev) or Redis (prod).
 * Respects X-Forwarded-For and sets standard X-RateLimit-* + Retry-After headers.
 *
 * Usage:
 *   // Global (in bootstrap/app.ts)
 *   .withMiddleware(m => m.use(RateLimit.perMinute(60).toHandler()))
 *
 *   // Per-route
 *   router.post('/api/auth/sign-in', handler, [
 *     RateLimit.perMinute(5).message('Too many login attempts.').toHandler()
 *   ])
 */
export class RateLimit {
  /** N requests per minute */
  static perMinute(max: number): RateLimitBuilder { return new RateLimitBuilder(max, 60_000) }

  /** N requests per hour */
  static perHour(max: number): RateLimitBuilder   { return new RateLimitBuilder(max, 3_600_000) }

  /** N requests per day */
  static perDay(max: number): RateLimitBuilder    { return new RateLimitBuilder(max, 86_400_000) }

  /** N requests per custom window (milliseconds) */
  static per(max: number, windowMs: number): RateLimitBuilder { return new RateLimitBuilder(max, windowMs) }
}
