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

const _locks = new Map<string, number>()

/**
 * Attempt to acquire a unique lock for a job.
 * Returns `true` if the lock was acquired (job can be dispatched).
 * Returns `false` if the lock is already held (job should be skipped).
 *
 * Uses `@rudderjs/cache` if available, otherwise falls back to in-memory.
 */
export async function acquireUniqueLock(job: Job & ShouldBeUnique): Promise<boolean> {
  const key = `rudderjs:unique:${job.uniqueId()}`
  const ttl = job.uniqueFor?.() ?? 0

  // Try cache adapter first
  const cache = _getCache()
  if (cache) {
    const existing = await cache.get(key)
    if (existing !== null && existing !== undefined) return false
    await cache.put(key, '1', ttl > 0 ? ttl : 86400)
    return true
  }

  // Fallback: in-memory
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

  const cache = _getCache()
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
