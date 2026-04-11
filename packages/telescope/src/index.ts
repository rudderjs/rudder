import { ServiceProvider, config } from '@rudderjs/core'
import { MemoryStorage, SqliteStorage } from './storage.js'
import { RequestCollector } from './collectors/request.js'
import { QueryCollector } from './collectors/query.js'
import { JobCollector } from './collectors/job.js'
import { ExceptionCollector } from './collectors/exception.js'
import { LogCollector } from './collectors/log.js'
import { MailCollector } from './collectors/mail.js'
import { NotificationCollector } from './collectors/notification.js'
import { EventCollector } from './collectors/event.js'
import { CacheCollector } from './collectors/cache.js'
import { ScheduleCollector } from './collectors/schedule.js'
import { ModelCollector } from './collectors/model.js'
import { registerTelescopeRoutes } from './routes.js'
import { defaultConfig, type TelescopeConfig, type TelescopeStorage, type TelescopeEntry, type EntryType, type Collector, type ListOptions } from './types.js'

// ─── Re-exports ────────────────────────────────────────────

export type { TelescopeConfig, TelescopeStorage, TelescopeEntry, EntryType, Collector, ListOptions }
export { MemoryStorage, SqliteStorage, createEntry } from './storage.js'
export { RequestCollector } from './collectors/request.js'
export { QueryCollector } from './collectors/query.js'
export { JobCollector } from './collectors/job.js'
export { ExceptionCollector } from './collectors/exception.js'
export { LogCollector } from './collectors/log.js'
export { MailCollector } from './collectors/mail.js'
export { NotificationCollector } from './collectors/notification.js'
export { EventCollector } from './collectors/event.js'
export { CacheCollector } from './collectors/cache.js'
export { ScheduleCollector } from './collectors/schedule.js'
export { ModelCollector } from './collectors/model.js'

// ─── Telescope Registry ────────────────────────────────────

export class TelescopeRegistry {
  private static storage: TelescopeStorage | null = null

  static set(storage: TelescopeStorage): void { this.storage = storage }
  static get(): TelescopeStorage | null        { return this.storage }
  /** @internal — clears the registered storage. Used for testing. */
  static reset(): void                         { this.storage = null }
}

// ─── Telescope Facade ──────────────────────────────────────

export class Telescope {
  private static store(): TelescopeStorage {
    const s = TelescopeRegistry.get()
    if (!s) throw new Error('[RudderJS Telescope] No storage registered. Add telescope() to providers.')
    return s
  }

  static list(options: ListOptions = {}): Promise<TelescopeEntry[]> | TelescopeEntry[] {
    return this.store().list(options)
  }

  static find(id: string): Promise<TelescopeEntry | null> | TelescopeEntry | null {
    return this.store().find(id)
  }

  static count(type?: EntryType): Promise<number> | number {
    return this.store().count(type)
  }

  static prune(type?: EntryType): Promise<void> | void {
    return this.store().prune(type)
  }

  static record(entry: TelescopeEntry): Promise<void> | void {
    return this.store().store(entry)
  }
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a TelescopeServiceProvider class configured for the given config.
 *
 * Records requests, queries, jobs, exceptions, logs, mail, notifications,
 * events, cache operations, scheduled tasks, and model changes.
 *
 * Usage in bootstrap/providers.ts:
 *   import { telescope } from '@rudderjs/telescope'
 *   export default [..., telescope(configs.telescope), ...]
 */
export class TelescopeProvider extends ServiceProvider {
  register(): void {
    this.publishes({
      from: new URL('../../boost/guidelines.md', import.meta.url).pathname,
      to:   'boost',
      tag:  'telescope-boost',
    })
  }

  async boot(): Promise<void> {
    const cfg = config<TelescopeConfig>('telescope', {})
    const merged = { ...defaultConfig, ...cfg }
  // Strip undefined values introduced by exactOptionalPropertyTypes spread
  const resolved = {
    enabled:             merged.enabled             ?? defaultConfig.enabled,
    path:                merged.path                ?? defaultConfig.path,
    storage:             merged.storage             ?? defaultConfig.storage,
    sqlitePath:          merged.sqlitePath          ?? defaultConfig.sqlitePath,
    maxEntries:          merged.maxEntries          ?? defaultConfig.maxEntries,
    pruneAfterHours:     merged.pruneAfterHours     ?? defaultConfig.pruneAfterHours,
    recordRequests:      merged.recordRequests      ?? defaultConfig.recordRequests,
    recordQueries:       merged.recordQueries       ?? defaultConfig.recordQueries,
    recordJobs:          merged.recordJobs           ?? defaultConfig.recordJobs,
    recordExceptions:    merged.recordExceptions    ?? defaultConfig.recordExceptions,
    recordLogs:          merged.recordLogs           ?? defaultConfig.recordLogs,
    recordMail:          merged.recordMail           ?? defaultConfig.recordMail,
    recordNotifications: merged.recordNotifications ?? defaultConfig.recordNotifications,
    recordEvents:        merged.recordEvents        ?? defaultConfig.recordEvents,
    recordCache:         merged.recordCache         ?? defaultConfig.recordCache,
    recordSchedule:      merged.recordSchedule      ?? defaultConfig.recordSchedule,
    recordModels:        merged.recordModels        ?? defaultConfig.recordModels,
    ignoreRequests:      merged.ignoreRequests      ?? defaultConfig.ignoreRequests,
    slowQueryThreshold:  merged.slowQueryThreshold  ?? defaultConfig.slowQueryThreshold,
    auth:                merged.auth                ?? defaultConfig.auth,
    }

    if (!resolved.enabled) return

      // ── Create storage ────────────────────────────────────
      let storage: TelescopeStorage

      if (resolved.storage === 'sqlite') {
        storage = new SqliteStorage(resolved.sqlitePath)
      } else {
        storage = new MemoryStorage(resolved.maxEntries)
      }

      TelescopeRegistry.set(storage)
      this.app.instance('telescope', storage)

      // ── Auto-prune on interval ────────────────────────────
      const pruneHours = resolved.pruneAfterHours as number
      if (pruneHours > 0) {
        const interval = Math.min(pruneHours * 60 * 60 * 1000, 3_600_000)
        const timer = setInterval(() => {
          const cutoff = new Date(Date.now() - pruneHours * 60 * 60 * 1000)
          storage.pruneOlderThan(cutoff)
        }, interval)
        timer.unref()
      }

      // ── Register collectors ───────────────────────────────
      const collectors: Collector[] = []

      const requestCollector = new RequestCollector(storage, resolved)
      collectors.push(requestCollector)

      if (resolved.recordQueries)        collectors.push(new QueryCollector(storage, resolved))
      if (resolved.recordJobs)           collectors.push(new JobCollector(storage))
      if (resolved.recordExceptions)     collectors.push(new ExceptionCollector(storage))
      if (resolved.recordLogs)           collectors.push(new LogCollector(storage))
      if (resolved.recordMail)           collectors.push(new MailCollector(storage))
      if (resolved.recordNotifications)  collectors.push(new NotificationCollector(storage))
      if (resolved.recordEvents)         collectors.push(new EventCollector(storage))
      if (resolved.recordCache)          collectors.push(new CacheCollector(storage))
      if (resolved.recordSchedule)       collectors.push(new ScheduleCollector(storage))
      if (resolved.recordModels)         collectors.push(new ModelCollector(storage))

      for (const collector of collectors) {
        await collector.register()
      }

      // ── Register request middleware ───────────────────────
      if (resolved.recordRequests) {
        try {
          const { router } = await import('@rudderjs/router')
          router.use(requestCollector.middleware())
        } catch {
          // @rudderjs/router not available — request recording disabled
        }
      }

    // ── Register UI + API routes ──────────────────────────
    const routeOpts: Parameters<typeof registerTelescopeRoutes>[1] = {}
    if (resolved.path) routeOpts.path = resolved.path
    if (resolved.auth) routeOpts.auth = resolved.auth
    await registerTelescopeRoutes(storage, routeOpts)
  }
}

// ─── Re-exports ────────────────────────────────────────────

export { registerTelescopeRoutes, type RegisterTelescopeRoutesOptions } from './routes.js'
