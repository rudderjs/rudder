import type { Job } from './index.js'

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
    const cache = _getCache()
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

    await cache.put(key, count + 1, this._decaySeconds)
    return next()
  }
}

// ─── WithoutOverlapping ─────────────────────────────────────

/**
 * Prevent concurrent execution of jobs with the same key.
 * If a lock exists, the job is released back to the queue.
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
    const lockKey = `rudderjs:job-lock:${this._key}`
    const cache   = _getCache()

    if (cache) {
      const locked = await cache.get(lockKey)
      if (locked) {
        throw new Error(
          `[RudderJS Queue] Job "${this._key}" is already running. Releasing back to queue.`
        )
      }
      await cache.put(lockKey, '1', this._expiresAfter)
      try {
        await next()
      } finally {
        await cache.forget(lockKey)
      }
    } else {
      // No cache — just run (no overlap protection)
      await next()
    }
  }
}

// ─── ThrottlesExceptions ────────────────────────────────────

/**
 * If the job throws, wait before retrying. Useful for external APIs
 * that return temporary errors.
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
    const cache = _getCache()

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
        await cache.put(key, count + 1, this._decayMinutes * 60)
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

// ─── Cache helper ───────────────────────────────────────────

interface CacheLike {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown, ttl?: number): Promise<void>
  forget(key: string): Promise<void>
}

function _getCache(): CacheLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@rudderjs/cache') as { CacheRegistry?: { get(): CacheLike | null } }
    return mod.CacheRegistry?.get() ?? null
  } catch {
    return null
  }
}
