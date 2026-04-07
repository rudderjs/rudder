import type { Aggregator, PulseStorage } from '../types.js'

/**
 * Tracks cache hit/miss ratio by wrapping the CacheRegistry adapter.
 */
export class CacheAggregator implements Aggregator {
  readonly name = 'Cache Aggregator'

  constructor(private readonly storage: PulseStorage) {}

  async register(): Promise<void> {
    try {
      const { CacheRegistry } = await import('@rudderjs/cache')
      const adapter = CacheRegistry.get()
      if (!adapter) return

      const storage = this.storage
      const origGet = adapter.get.bind(adapter)

      ;(adapter as unknown as Record<string, unknown>)['get'] = async <T = unknown>(key: string): Promise<T | null> => {
        const value = await (origGet as (key: string) => Promise<T | null>)(key)
        if (value !== null) {
          storage.record('cache_hits', 1)
        } else {
          storage.record('cache_misses', 1)
        }
        return value
      }
    } catch {
      // @rudderjs/cache not installed — skip
    }
  }
}
