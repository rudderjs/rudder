import type { Job } from './index.js'
import type { CacheAdapter } from '@rudderjs/cache'

// ─── Job Middleware Contract ────────────────────────────────

/**
 * Middleware that wraps a job's `handle()` execution.
 * Return `next()` to continue, or skip it to prevent execution.
 *
 * @example
 * class MyJob extends Job {
 *   middleware() {
 *     return [new RateLimited('api', 60), new WithoutOverlapping('import')]
 *   }
 * }
 */
export interface JobMiddleware {
  handle(job: Job, next: () => Promise<void>): Promise<void>
}

/** Run a job through its middleware pipeline, then execute `handle()`. */
export async function runJobMiddleware(job: Job, middlewares: JobMiddleware[]): Promise<void> {
  let index = 0

  const run = async (): Promise<void> => {
    if (index >= middlewares.length) {
      await job.handle()
      return
    }
    const mw = middlewares[index++]!
    await mw.handle(job, run)
  }

  await run()
}

// ─── RateLimited ────────────────────────────────────────────

/**
 * Rate-limit job execution. If the limit is exceeded, the job is released
 * back to the queue (by throwing a retriable error).
 *
 * **Requires `@rudderjs/cache`.** When no cache adapter is registered this
 * middleware **fails open** — every invocation runs as if under the limit.
 * Asymmetric to `WithoutOverlapping`, which fails closed (throws) without a
 * cache. Install and register `@rudderjs/cache` in any environment that
 * needs the limit enforced.
 *
 * @example
 * middleware() { return [new RateLimited('api-calls', 60)] }
 */
export class RateLimited implements JobMiddleware {
  constructor(
    private readonly _key: string,
    private readonly _maxAttempts: number,
    private readonly _decaySeconds = 60,
  ) {}

  async handle(_job: Job, next: () => Promise<void>): Promise<void> {
    const cache = await _getCache()
    if (!cache) {
      // No cache — fail open (allow execution)
      return next()
    }

    const key   = `rudderjs:job-rate:${this._key}`
    const count = Number(await cache.get(key) ?? 0)

    if (count >= this._maxAttempts) {
      throw new Error(
        `[RudderJS Queue] Job rate limit exceeded for "${this._key}" (${this._maxAttempts}/${this._decaySeconds}s). Releasing back to queue.`
      )
    }

    await cache.set(key, count + 1, this._decaySeconds)
    return next()
  }
}

// ─── WithoutOverlapping ─────────────────────────────────────

/**
 * Prevent concurrent execution of jobs with the same key.
 * If the lock is already held, the job is released back to the queue.
 *
 * Backed by `Cache.lock()` — atomic across processes when using a shared
 * driver (Redis). Requires `@rudderjs/cache` to be installed and registered;
 * throws a clear error otherwise (overlap protection without a cache adapter
 * is silently broken under contention, so we fail fast).
 *
 * @example
 * middleware() { return [new WithoutOverlapping(`import-${this.userId}`)] }
 */
export class WithoutOverlapping implements JobMiddleware {
  constructor(
    private readonly _key: string,
    private readonly _expiresAfter = 300,
  ) {}

  async handle(_job: Job, next: () => Promise<void>): Promise<void> {
    const cache = await _getCacheAdapter()
    if (!cache) {
      throw new Error(
        '[RudderJS Queue] WithoutOverlapping requires a cache adapter. Install @rudderjs/cache and add CacheProvider.'
      )
    }

    const lock = cache.lock(`rudderjs:job-lock:${this._key}`, this._expiresAfter)
    let ran = false
    const result = await lock.get(async () => {
      ran = true
      await next()
    })
    if (!ran && result === false) {
      throw new Error(
        `[RudderJS Queue] Job "${this._key}" is already running. Releasing back to queue.`
      )
    }
  }
}

// ─── ThrottlesExceptions ────────────────────────────────────

/**
 * If the job throws, wait before retrying. Useful for external APIs
 * that return temporary errors.
 *
 * **Requires `@rudderjs/cache`.** When no cache adapter is registered the
 * throttle is a no-op — every exception passes through unthrottled. Install
 * and register `@rudderjs/cache` in any environment where you want backoff
 * to take effect.
 *
 * @example
 * middleware() { return [new ThrottlesExceptions(3, 5)] }
 * // Allow 3 exceptions within 5 minutes before backing off
 */
export class ThrottlesExceptions implements JobMiddleware {
  constructor(
    private readonly _maxExceptions: number,
    private readonly _decayMinutes = 5,
  ) {}

  async handle(job: Job, next: () => Promise<void>): Promise<void> {
    const key   = `rudderjs:job-throttle:${job.constructor.name}`
    const cache = await _getCache()

    if (cache) {
      const count = Number(await cache.get(key) ?? 0)

      if (count >= this._maxExceptions) {
        throw new Error(
          `[RudderJS Queue] Job "${job.constructor.name}" throttled — ${this._maxExceptions} exceptions in ${this._decayMinutes}m.`
        )
      }

      try {
        await next()
        // Success — reset counter
        await cache.forget(key)
      } catch (err) {
        await cache.set(key, count + 1, this._decayMinutes * 60)
        throw err
      }
    } else {
      await next()
    }
  }
}

// ─── Skip ───────────────────────────────────────────────────

/**
 * Conditionally skip job execution.
 *
 * @example
 * middleware() { return [Skip.when(() => isMaintenanceMode())] }
 * middleware() { return [Skip.unless(() => isFeatureEnabled('exports'))] }
 */
export class Skip implements JobMiddleware {
  private constructor(
    private readonly _condition: () => boolean | Promise<boolean>,
    private readonly _invert: boolean,
  ) {}

  static when(condition: () => boolean | Promise<boolean>): Skip {
    return new Skip(condition, false)
  }

  static unless(condition: () => boolean | Promise<boolean>): Skip {
    return new Skip(condition, true)
  }

  async handle(_job: Job, next: () => Promise<void>): Promise<void> {
    const result = await this._condition()
    const shouldSkip = this._invert ? !result : result

    if (shouldSkip) return // silently skip
    return next()
  }
}

// ─── Cache helpers ──────────────────────────────────────────

interface CacheLike {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown, ttl?: number): Promise<void>
  forget(key: string): Promise<void>
}

async function _getCache(): Promise<CacheLike | null> {
  try {
    const mod = await import('@rudderjs/cache') as unknown as { CacheRegistry?: { get(): CacheLike | null } }
    return mod.CacheRegistry?.get() ?? null
  } catch {
    return null
  }
}

async function _getCacheAdapter(): Promise<CacheAdapter | null> {
  try {
    const mod = await import('@rudderjs/cache')
    return mod.CacheRegistry?.get() ?? null
  } catch {
    return null
  }
}
