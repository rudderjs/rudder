import { ServiceProvider, type Application } from '@rudderjs/core'
import { MemoryStorage, SqliteStorage } from './storage.js'
import { RequestAggregator } from './aggregators/request.js'
import { QueueAggregator } from './aggregators/queue.js'
import { CacheAggregator } from './aggregators/cache.js'
import { ExceptionAggregator } from './aggregators/exception.js'
import { UserAggregator } from './aggregators/user.js'
import { QueryAggregator } from './aggregators/query.js'
import { ServerAggregator } from './aggregators/server.js'
import { registerRoutes } from './api/routes.js'
import {
  defaultConfig,
  type PulseConfig, type PulseStorage, type PulseAggregate, type PulseEntry,
  type MetricType, type EntryType, type Aggregator, type EntryListOptions,
} from './types.js'

// ─── Re-exports ────────────────────────────────────────────

export type { PulseConfig, PulseStorage, PulseAggregate, PulseEntry, MetricType, EntryType, Aggregator, EntryListOptions }
export { MemoryStorage, SqliteStorage } from './storage.js'
export { RequestAggregator } from './aggregators/request.js'
export { QueueAggregator } from './aggregators/queue.js'
export { CacheAggregator } from './aggregators/cache.js'
export { ExceptionAggregator } from './aggregators/exception.js'
export { UserAggregator } from './aggregators/user.js'
export { QueryAggregator } from './aggregators/query.js'
export { ServerAggregator } from './aggregators/server.js'

// ─── Pulse Registry ────────────────────────────────────────

export class PulseRegistry {
  private static storage: PulseStorage | null = null

  static set(storage: PulseStorage): void { this.storage = storage }
  static get(): PulseStorage | null        { return this.storage }
  /** @internal — clears the registered storage. Used for testing. */
  static reset(): void                     { this.storage = null }
}

// ─── Pulse Facade ──────────────────────────────────────────

export class Pulse {
  private static store(): PulseStorage {
    const s = PulseRegistry.get()
    if (!s) throw new Error('[RudderJS Pulse] No storage registered. Add pulse() to providers.')
    return s
  }

  static record(type: MetricType, value: number, key?: string | null): void | Promise<void> {
    return this.store().record(type, value, key)
  }

  static aggregates(type: MetricType, since: Date, key?: string | null): PulseAggregate[] | Promise<PulseAggregate[]> {
    return this.store().aggregates(type, since, key)
  }

  static entries(type: EntryType, options?: EntryListOptions): PulseEntry[] | Promise<PulseEntry[]> {
    return this.store().entries(type, options)
  }

  static overview(since: Date): PulseAggregate[] | Promise<PulseAggregate[]> {
    return this.store().overview(since)
  }
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a PulseServiceProvider class configured for the given config.
 *
 * Tracks request throughput/duration, queue metrics, cache hit rates,
 * exception counts, active users, slow queries, and server resource usage.
 *
 * Usage in bootstrap/providers.ts:
 *   import { pulse } from '@rudderjs/pulse'
 *   export default [..., pulse(configs.pulse), ...]
 */
export function pulse(config: PulseConfig = {}): new (app: Application) => ServiceProvider {
  const resolved = {
    enabled:              config.enabled              ?? defaultConfig.enabled,
    path:                 config.path                 ?? defaultConfig.path,
    storage:              config.storage              ?? defaultConfig.storage,
    sqlitePath:           config.sqlitePath           ?? defaultConfig.sqlitePath,
    pruneAfterHours:      config.pruneAfterHours      ?? defaultConfig.pruneAfterHours,
    slowRequestThreshold: config.slowRequestThreshold ?? defaultConfig.slowRequestThreshold,
    slowQueryThreshold:   config.slowQueryThreshold   ?? defaultConfig.slowQueryThreshold,
    recordRequests:       config.recordRequests       ?? defaultConfig.recordRequests,
    recordQueues:         config.recordQueues         ?? defaultConfig.recordQueues,
    recordCache:          config.recordCache          ?? defaultConfig.recordCache,
    recordExceptions:     config.recordExceptions     ?? defaultConfig.recordExceptions,
    recordUsers:          config.recordUsers          ?? defaultConfig.recordUsers,
    recordServers:        config.recordServers        ?? defaultConfig.recordServers,
    serverStatsIntervalMs: config.serverStatsIntervalMs ?? defaultConfig.serverStatsIntervalMs,
    auth:                 config.auth                 ?? defaultConfig.auth,
  }

  class PulseServiceProvider extends ServiceProvider {
    register(): void {
      this.publishes({
        from: new URL('../../boost/guidelines.md', import.meta.url).pathname,
        to:   'boost',
        tag:  'pulse-boost',
      })
    }

    async boot(): Promise<void> {
      if (!resolved.enabled) return

      // ── Create storage ────────────────────────────────────
      let storage: PulseStorage

      if (resolved.storage === 'sqlite') {
        storage = new SqliteStorage(resolved.sqlitePath)
      } else {
        storage = new MemoryStorage()
      }

      PulseRegistry.set(storage)
      this.app.instance('pulse', storage)

      // ── Auto-prune ────────────────────────────────────────
      const pruneHours = resolved.pruneAfterHours
      if (pruneHours > 0) {
        const interval = Math.min(pruneHours * 60 * 60 * 1000, 3_600_000)
        const timer = setInterval(() => {
          const cutoff = new Date(Date.now() - pruneHours * 60 * 60 * 1000)
          storage.pruneOlderThan(cutoff)
        }, interval)
        timer.unref()
      }

      // ── Register aggregators ──────────────────────────────
      const requestAgg = new RequestAggregator(storage, resolved)
      const userAgg    = new UserAggregator(storage)

      const aggregators: Aggregator[] = []

      if (resolved.recordQueues)     aggregators.push(new QueueAggregator(storage))
      if (resolved.recordCache)      aggregators.push(new CacheAggregator(storage))
      if (resolved.recordExceptions) aggregators.push(new ExceptionAggregator(storage))
      if (resolved.recordServers)    aggregators.push(new ServerAggregator(storage, resolved.serverStatsIntervalMs))

      // Query aggregator for slow queries
      aggregators.push(new QueryAggregator(storage, resolved))

      for (const agg of aggregators) {
        await agg.register()
      }

      // ── Register middleware ───────────────────────────────
      try {
        const { router } = await import('@rudderjs/router')
        if (resolved.recordRequests) router.use(requestAgg.middleware())
        if (resolved.recordUsers)    router.use(userAgg.middleware())
      } catch {
        // @rudderjs/router not available
      }

      // ── Register API routes ───────────────────────────────
      await registerRoutes(storage, resolved)
    }
  }

  return PulseServiceProvider
}
