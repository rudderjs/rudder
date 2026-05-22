import type { Job } from './index.js'

// ─── ShouldBeUnique ─────────────────────────────────────────

/**
 * Interface for jobs that should not be dispatched if a duplicate is already queued.
 * Uses a cache-backed lock to enforce uniqueness.
 *
 * @example
 * class SyncInventory extends Job implements ShouldBeUnique {
 *   uniqueId() { return `sync-inventory-${this.warehouseId}` }
 *   uniqueFor() { return 3600 }  // seconds
 *
 *   async handle() { ... }
 * }
 */
export interface ShouldBeUnique {
  /** A unique identifier for deduplication. Jobs with the same ID are skipped. */
  uniqueId(): string
  /** How long the lock is held (seconds). Default: 0 (until job completes). */
  uniqueFor?(): number
}

/**
 * Variant: lock is released when the job starts processing (not when it finishes).
 * Allows re-dispatching while the current one is running.
 */
export interface ShouldBeUniqueUntilProcessing extends ShouldBeUnique {
  /** Marker — lock is released when processing starts. */
  readonly releaseOnProcessing: true
}

/** Type guard: does this job implement ShouldBeUnique? */
export function isUniqueJob(job: Job): job is Job & ShouldBeUnique {
  return typeof (job as unknown as ShouldBeUnique).uniqueId === 'function'
}

/** Type guard: does this job release the lock on processing? */
export function isUniqueUntilProcessing(job: Job): job is Job & ShouldBeUniqueUntilProcessing {
  return isUniqueJob(job) && (job as unknown as ShouldBeUniqueUntilProcessing).releaseOnProcessing === true
}

// ─── In-memory lock store (fallback when no cache adapter) ──
//
// The fallback map is module-scoped, so it is **process-local** and grows
// without an external eviction trigger. For long-running processes that
// dispatch many unique jobs without `@rudderjs/cache`, register the cache
// (Redis or a TTL-aware driver) so locks expire centrally — otherwise the
// map accumulates entries with `ttl=0` jobs held until the heuristic
// 24-hour fallback expires.

const _locks = new Map<string, number>()

/**
 * Attempt to acquire a unique lock for a job.
 * Returns `true` if the lock was acquired (job can be dispatched).
 * Returns `false` if the lock is already held (job should be skipped).
 *
 * Uses `@rudderjs/cache`'s atomic `add()` (SETNX) when available so two
 * concurrent dispatchers can't both win the race. Falls back to a
 * process-local in-memory map otherwise — use a shared cache driver
 * (Redis) for cross-process uniqueness.
 */
export async function acquireUniqueLock(job: Job & ShouldBeUnique): Promise<boolean> {
  const key = `rudderjs:unique:${job.uniqueId()}`
  const ttl = job.uniqueFor?.() ?? 0

  const cache = await _getCache()
  if (cache) {
    return await cache.add(key, '1', ttl > 0 ? ttl : 86400)
  }

  // Fallback: in-memory check-and-set. Single-tick synchronous between the
  // expiry check and the write — safe under Node's single-threaded event
  // loop because no `await` sits between them.
  const now = Date.now()
  const expiry = _locks.get(key)
  if (expiry !== undefined && expiry > now) return false
  _locks.set(key, ttl > 0 ? now + ttl * 1000 : now + 86400_000)
  return true
}

/**
 * Release the unique lock for a job.
 * Called when the job completes or when `ShouldBeUniqueUntilProcessing` starts.
 */
export async function releaseUniqueLock(job: Job & ShouldBeUnique): Promise<void> {
  const key = `rudderjs:unique:${job.uniqueId()}`

  const cache = await _getCache()
  if (cache) {
    await cache.forget(key)
    return
  }

  _locks.delete(key)
}

/** @internal — clear in-memory locks (for testing) */
export function _clearLocks(): void {
  _locks.clear()
}

// ─── Cache integration ──────────────────────────────────────

interface CacheLike {
  add(key: string, value: unknown, ttl?: number): Promise<boolean>
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
