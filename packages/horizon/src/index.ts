import { ServiceProvider, type Application } from '@rudderjs/core'
import { MemoryStorage, SqliteStorage } from './storage.js'
import { JobCollector } from './collectors/job.js'
import { MetricsCollector } from './collectors/metrics.js'
import { WorkerCollector } from './collectors/worker.js'
import { registerRoutes } from './api/routes.js'
import {
  defaultConfig,
  type HorizonConfig, type HorizonStorage, type HorizonJob,
  type QueueMetric, type WorkerInfo, type JobStatus, type JobListOptions,
} from './types.js'

// ─── Re-exports ────────────────────────────────────────────

export type { HorizonConfig, HorizonStorage, HorizonJob, QueueMetric, WorkerInfo, JobStatus, JobListOptions }
export { MemoryStorage, SqliteStorage } from './storage.js'
export { JobCollector } from './collectors/job.js'
export { MetricsCollector } from './collectors/metrics.js'
export { WorkerCollector } from './collectors/worker.js'

// ─── Horizon Registry ──────────────────────────────────────

export class HorizonRegistry {
  private static storage: HorizonStorage | null = null

  static set(storage: HorizonStorage): void { this.storage = storage }
  static get(): HorizonStorage | null        { return this.storage }
  /** @internal — clears the registered storage. Used for testing. */
  static reset(): void                       { this.storage = null }
}

// ─── Horizon Facade ────────────────────────────────────────

export class Horizon {
  private static store(): HorizonStorage {
    const s = HorizonRegistry.get()
    if (!s) throw new Error('[RudderJS Horizon] No storage registered. Add horizon() to providers.')
    return s
  }

  static recentJobs(options?: JobListOptions): HorizonJob[] | Promise<HorizonJob[]> {
    return this.store().recentJobs(options)
  }

  static failedJobs(options?: JobListOptions): HorizonJob[] | Promise<HorizonJob[]> {
    return this.store().failedJobs(options)
  }

  static findJob(id: string): HorizonJob | null | Promise<HorizonJob | null> {
    return this.store().findJob(id)
  }

  static currentMetrics(): QueueMetric[] | Promise<QueueMetric[]> {
    return this.store().currentMetrics()
  }

  static workers(): WorkerInfo[] | Promise<WorkerInfo[]> {
    return this.store().workers()
  }

  static jobCount(status?: JobStatus): number | Promise<number> {
    return this.store().jobCount(status)
  }
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a HorizonServiceProvider class for deep queue monitoring.
 *
 * Tracks job lifecycle (dispatch → processing → completed/failed),
 * queue-level metrics (throughput, wait time, runtime),
 * and worker status (memory, jobs processed).
 *
 * Usage in bootstrap/providers.ts:
 *   import { horizon } from '@rudderjs/horizon'
 *   export default [..., horizon(configs.horizon), ...]
 */
export function horizon(config: HorizonConfig = {}): new (app: Application) => ServiceProvider {
  const resolved = {
    enabled:           config.enabled           ?? defaultConfig.enabled,
    path:              config.path              ?? defaultConfig.path,
    storage:           config.storage           ?? defaultConfig.storage,
    sqlitePath:        config.sqlitePath        ?? defaultConfig.sqlitePath,
    maxJobs:           config.maxJobs           ?? defaultConfig.maxJobs,
    pruneAfterHours:   config.pruneAfterHours   ?? defaultConfig.pruneAfterHours,
    metricsIntervalMs: config.metricsIntervalMs ?? defaultConfig.metricsIntervalMs,
    auth:              config.auth              ?? defaultConfig.auth,
  }

  class HorizonServiceProvider extends ServiceProvider {
    register(): void {
      this.publishes({
        from: new URL('../../boost/guidelines.md', import.meta.url).pathname,
        to:   'boost',
        tag:  'horizon-boost',
      })
    }

    async boot(): Promise<void> {
      if (!resolved.enabled) return

      // ── Create storage ────────────────────────────────────
      let storage: HorizonStorage

      if (resolved.storage === 'sqlite') {
        storage = new SqliteStorage(resolved.sqlitePath)
      } else {
        storage = new MemoryStorage(resolved.maxJobs)
      }

      HorizonRegistry.set(storage)
      this.app.instance('horizon', storage)

      // ── Auto-prune ────────────────────────────────────────
      const pruneHours = resolved.pruneAfterHours
      if (pruneHours > 0) {
        const interval = Math.min(pruneHours * 60 * 60 * 1000, 3_600_000)
        const timer = setInterval(() => {
          storage.pruneOlderThan(new Date(Date.now() - pruneHours * 60 * 60 * 1000))
        }, interval)
        timer.unref()
      }

      // ── Register collectors ───────────────────────────────
      const jobCollector     = new JobCollector(storage)
      const metricsCollector = new MetricsCollector(storage, resolved.metricsIntervalMs)
      const workerCollector  = new WorkerCollector(storage)

      jobCollector.register()
      metricsCollector.register()
      workerCollector.register()

      // ── Register API routes ───────────────────────────────
      await registerRoutes(storage, resolved)
    }
  }

  return HorizonServiceProvider
}
