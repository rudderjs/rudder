import type { Aggregator, PulseStorage, PulseConfig } from '../types.js'

/**
 * Tracks slow database queries by hooking into the ORM adapter.
 */
export class QueryAggregator implements Aggregator {
  readonly name = 'Query Aggregator'

  constructor(
    private readonly storage: PulseStorage,
    private readonly config:  PulseConfig,
  ) {}

  async register(): Promise<void> {
    try {
      const orm = await import('@rudderjs/orm')
      const registry = orm.ModelRegistry as unknown as {
        getAdapter(): { onQuery?(listener: (info: QueryInfo) => void): void } | null
      }
      if (!registry.getAdapter) return

      const adapter = registry.getAdapter()
      if (!adapter?.onQuery) return

      const storage   = this.storage
      const threshold = this.config.slowQueryThreshold ?? 100

      adapter.onQuery((info: QueryInfo) => {
        if (info.duration > threshold) {
          storage.storeEntry('slow_query', {
            sql:      info.sql,
            bindings: info.bindings,
            duration: info.duration,
            model:    info.model,
          })
        }
      })
    } catch {
      // @rudderjs/orm not installed — skip
    }
  }
}

interface QueryInfo {
  sql:       string
  bindings:  unknown[]
  duration:  number
  model?:    string
}
