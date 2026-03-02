import { CacheRegistry } from '@forge/cache'
import type { ForgeRequest, ForgeResponse, MiddlewareHandler } from '@forge/contracts'

// ─── Internal types ────────────────────────────────────────

type KeyExtractor = 'ip' | 'route' | ((req: ForgeRequest) => string)

interface RateLimitOptions {
  max:      number
  windowMs: number
  keyBy:    KeyExtractor
  message:  string
  skipIf?:  (req: ForgeRequest) => boolean
}

interface RateRecord {
  count:     number
  expiresAt: number   // epoch ms — end of the current window
}

// ─── Helpers ───────────────────────────────────────────────

function clientIp(req: ForgeRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    (req.headers['x-real-ip'] as string | undefined) ??
    'unknown'
  )
}

function buildKey(keyBy: KeyExtractor, req: ForgeRequest): string {
  if (keyBy === 'ip')    return clientIp(req)
  if (keyBy === 'route') return `${req.method}:${req.path}`
  return keyBy(req)
}

function isAsset(path: string): boolean {
  if (path.startsWith('/@'))           return true  // Vite internals
  if (path.startsWith('/node_modules')) return true
  return (path.split('/').pop() ?? '').includes('.')  // static files
}

// ─── Core handler ──────────────────────────────────────────

function makeHandler(opts: RateLimitOptions): MiddlewareHandler {
  return async (req: ForgeRequest, res: ForgeResponse, next: () => Promise<void>) => {
    if (isAsset(req.path))        return next()
    if (opts.skipIf?.(req))       return next()

    const cache = CacheRegistry.get()
    if (!cache) return next()   // no cache registered — fail open

    const now    = Date.now()
    const cKey   = `forge:rl:${buildKey(opts.keyBy, req)}`
    const record = await cache.get<RateRecord>(cKey)

    let count:     number
    let expiresAt: number

    if (!record || now > record.expiresAt) {
      // New window
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

// ─── Fluent Builder ────────────────────────────────────────

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
  by(fn: (req: ForgeRequest) => string): this { this.opts = { ...this.opts, keyBy: fn }; return this }

  /** Override the 429 response message */
  message(msg: string): this { this.opts = { ...this.opts, message: msg }; return this }

  /** Skip rate limiting entirely when this predicate returns true */
  skipIf(fn: (req: ForgeRequest) => boolean): this { this.opts = { ...this.opts, skipIf: fn }; return this }

  /** Returns a MiddlewareHandler ready for use in router or withMiddleware() */
  toHandler(): MiddlewareHandler { return makeHandler(this.opts) }
}

// ─── Facade ────────────────────────────────────────────────

/**
 * Cache-backed rate limiter middleware.
 *
 * Uses the active @forge/cache adapter — works with memory (dev) or Redis (prod).
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
