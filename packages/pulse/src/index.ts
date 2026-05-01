import { ServiceProvider, config } from '@rudderjs/core'
import { MemoryStorage, SqliteStorage } from './storage.js'
import { RequestRecorder } from './recorders/request.js'
import { QueueRecorder } from './recorders/queue.js'
import { CacheRecorder } from './recorders/cache.js'
import { ExceptionRecorder } from './recorders/exception.js'
import { UserRecorder } from './recorders/user.js'
import { QueryRecorder } from './recorders/query.js'
import { ServerRecorder } from './recorders/server.js'
import { registerPulseRoutes } from './routes.js'
import {
  defaultConfig,
  type PulseConfig, type PulseStorage, type PulseAggregate, type PulseEntry,
  type MetricType, type EntryType, type Recorder, type EntryListOptions,
} from './types.js'

// ─── Re-exports ────────────────────────────────────────────

export type { PulseConfig, PulseStorage, PulseAggregate, PulseEntry, MetricType, EntryType, Recorder, EntryListOptions }
export { MemoryStorage, SqliteStorage } from './storage.js'
export { RequestRecorder } from './recorders/request.js'
export { QueueRecorder } from './recorders/queue.js'
export { CacheRecorder } from './recorders/cache.js'
export { ExceptionRecorder } from './recorders/exception.js'
export { UserRecorder } from './recorders/user.js'
export { QueryRecorder } from './recorders/query.js'
export { ServerRecorder } from './recorders/server.js'
export { registerPulseRoutes, type RegisterPulseRoutesOptions } from './routes.js'

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
export class PulseProvider extends ServiceProvider {
  register(): void {
    this.publishes({
      from: new URL('../../boost/guidelines.md', import.meta.url).pathname,
      to:   'boost',
      tag:  'pulse-boost',
    })
  }

  async boot(): Promise<void> {
    const cfg = config<PulseConfig>('pulse', {})
    const resolved = {
      enabled:              cfg.enabled              ?? defaultConfig.enabled,
      path:                 cfg.path                 ?? defaultConfig.path,
      storage:              cfg.storage              ?? defaultConfig.storage,
      sqlitePath:           cfg.sqlitePath           ?? defaultConfig.sqlitePath,
      pruneAfterHours:      cfg.pruneAfterHours      ?? defaultConfig.pruneAfterHours,
      slowRequestThreshold: cfg.slowRequestThreshold ?? defaultConfig.slowRequestThreshold,
      slowQueryThreshold:   cfg.slowQueryThreshold   ?? defaultConfig.slowQueryThreshold,
      recordRequests:       cfg.recordRequests       ?? defaultConfig.recordRequests,
      recordQueues:         cfg.recordQueues         ?? defaultConfig.recordQueues,
      recordCache:          cfg.recordCache          ?? defaultConfig.recordCache,
      recordExceptions:     cfg.recordExceptions     ?? defaultConfig.recordExceptions,
      recordUsers:          cfg.recordUsers          ?? defaultConfig.recordUsers,
      recordServers:        cfg.recordServers        ?? defaultConfig.recordServers,
      serverStatsIntervalMs: cfg.serverStatsIntervalMs ?? defaultConfig.serverStatsIntervalMs,
      auth:                 cfg.auth                 ?? defaultConfig.auth,
    }

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

      // ── Register recorders ────────────────────────────────
      const requestRec = new RequestRecorder(storage, resolved)
      const userRec    = new UserRecorder(storage)

      const recorders: Recorder[] = []

      if (resolved.recordQueues)     recorders.push(new QueueRecorder(storage))
      if (resolved.recordCache)      recorders.push(new CacheRecorder(storage))
      if (resolved.recordExceptions) recorders.push(new ExceptionRecorder(storage))
      if (resolved.recordServers)    recorders.push(new ServerRecorder(storage, resolved.serverStatsIntervalMs))

      // Query recorder for slow queries
      recorders.push(new QueryRecorder(storage, resolved))

      for (const rec of recorders) {
        await rec.register()
      }

      // ── Register middleware ───────────────────────────────
      try {
        const { router } = await import('@rudderjs/router')
        if (resolved.recordRequests) router.use(requestRec.middleware())
        if (resolved.recordUsers)    router.use(userRec.middleware())
      } catch {
        // @rudderjs/router not available
      }

    // ── Register UI + API routes ──────────────────────────
    await registerPulseRoutes(storage, {
      path:       resolved.path,
      ...(resolved.auth ? { auth: resolved.auth } : {}),
    })
  }
}
