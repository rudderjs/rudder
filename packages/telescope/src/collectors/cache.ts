import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

/**
 * Records cache operations by wrapping the CacheRegistry adapter methods.
 * Intercepts get/set/forget/flush and records hit/miss/set/forget ops.
 */
export class CacheCollector implements Collector {
  readonly name = 'Cache Collector'
  readonly type = 'cache' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { CacheRegistry } = await import('@rudderjs/cache')
      const original = CacheRegistry.get()
      if (!original) return

      const storage = this.storage
      const store   = CacheRegistry.getDefaultName() ?? null

      const origGet    = original.get.bind(original)
      const origSet    = original.set.bind(original)
      const origForget = original.forget.bind(original)
      const origFlush  = original.flush.bind(original)

      original.get = async <T = unknown>(key: string): Promise<T | null> => {
        const value = await (origGet as (key: string) => Promise<T | null>)(key)
        const op = value !== null ? 'hit' : 'miss'
        storage.store(createEntry('cache', { key, operation: op, store }, { tags: [`cache:${op}`], ...batchOpts() }))
        return value
      }

      original.set = async (key: string, value: unknown, ttl?: number): Promise<void> => {
        await (origSet as (key: string, value: unknown, ttl?: number) => Promise<void>)(key, value, ttl)
        storage.store(createEntry('cache', { key, operation: 'set', store, ttl }, { tags: ['cache:set'], ...batchOpts() }))
      }

      original.forget = async (key: string): Promise<void> => {
        await (origForget as (key: string) => Promise<void>)(key)
        storage.store(createEntry('cache', { key, operation: 'forget', store }, { tags: ['cache:forget'], ...batchOpts() }))
      }

      original.flush = async (): Promise<void> => {
        await (origFlush as () => Promise<void>)()
        storage.store(createEntry('cache', { operation: 'flush', store }, { tags: ['cache:flush'], ...batchOpts() }))
      }
    } catch {
      // @rudderjs/cache not installed — skip
    }
  }
}
