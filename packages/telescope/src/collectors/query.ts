import type { Collector, TelescopeStorage, TelescopeConfig } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records database queries by hooking into the ORM's query logging.
 */
export class QueryCollector implements Collector {
  readonly name = 'Query Collector'
  readonly type = 'query' as const

  constructor(
    private readonly storage: TelescopeStorage,
    private readonly config:  TelescopeConfig,
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
        const tags: string[] = []
        if (info.duration > threshold) tags.push('slow')
        if (info.model) tags.push(`model:${info.model}`)

        storage.store(createEntry('query', {
          sql:        info.sql,
          bindings:   info.bindings,
          duration:   info.duration,
          connection: info.connection,
          model:      info.model,
        }, { tags }))
      })
    } catch {
      // @rudderjs/orm not installed or adapter doesn't support onQuery — skip
    }
  }
}

interface QueryInfo {
  sql:         string
  bindings:    unknown[]
  duration:    number
  connection?: string
  model?:      string
}
