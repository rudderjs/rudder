import { ServiceProvider, artisan, type Application } from '@boostkit/core'
import { resolveOptionalPeer } from '@boostkit/core'

// ─── Job Contract ──────────────────────────────────────────

export abstract class Job {
  /** The queue this job should be dispatched to */
  static queue = 'default'

  /** Number of times to retry on failure */
  static retries = 3

  /** Delay before job runs (ms) */
  static delay = 0

  /** The job's main logic */
  abstract handle(): void | Promise<void>

  /** Called when all retries are exhausted */
  failed?(error: unknown): void | Promise<void>

  /** Dispatch this job via the global dispatcher */
  static dispatch<T extends Job>(
    this: new (...args: unknown[]) => T,
    ...args: ConstructorParameters<typeof this>
  ): DispatchBuilder<T> {
    const instance = new this(...args)
    return new DispatchBuilder(instance)
  }
}

// ─── Dispatch Builder ──────────────────────────────────────

export class DispatchBuilder<T extends Job> {
  private _delay  = 0
  private _queue  = 'default'

  constructor(private job: T) {
    this._delay = (job.constructor as typeof Job).delay
    this._queue = (job.constructor as typeof Job).queue
  }

  delay(ms: number): this {
    this._delay = ms
    return this
  }

  onQueue(name: string): this {
    this._queue = name
    return this
  }

  async send(): Promise<void> {
    const adapter = QueueRegistry.get()
    if (!adapter) throw new Error('[BoostKit Queue] No queue adapter registered')
    await adapter.dispatch(this.job, { delay: this._delay, queue: this._queue })
  }
}

// ─── Queue Adapter Contract ────────────────────────────────

export interface DispatchOptions {
  delay?: number
  queue?: string
}

export interface QueueStats {
  waiting:   number
  active:    number
  completed: number
  failed:    number
  delayed:   number
  paused:    number
}

export interface FailedJobInfo {
  id:       string
  name:     string
  data:     unknown
  error:    string
  failedAt: Date
  attempts: number
}

export interface QueueAdapter {
  /** Dispatch a job */
  dispatch(job: Job, options?: DispatchOptions): Promise<void>

  /** Start processing jobs (for self-hosted adapters like BullMQ) — comma-separated queue names */
  work?(queues?: string): Promise<void>

  /**
   * For cloud adapters (Inngest etc.): returns the serve handler for the
   * /api/inngest endpoint. The QueueServiceProvider mounts it automatically.
   * The returned function receives the framework-native context (Hono Context).
   */
  serveHandler?(): (ctx: unknown) => Promise<Response>

  /** Return waiting/active/completed/failed/delayed/paused counts for a queue */
  status?(queueName?: string): Promise<QueueStats>

  /** Drain waiting + delayed jobs from a queue */
  flush?(queueName?: string): Promise<void>

  /** List recently failed jobs */
  failures?(queueName?: string, limit?: number): Promise<FailedJobInfo[]>

  /** Re-enqueue all failed jobs, returns count */
  retryFailed?(queueName?: string): Promise<number>

  /** Close queue connections */
  disconnect?(): Promise<void>
}

// ─── Queue Adapter Factory ─────────────────────────────────

export interface QueueAdapterProvider {
  create(): QueueAdapter
}

export interface QueueAdapterFactory<TConfig = unknown> {
  (config?: TConfig): QueueAdapterProvider
}

// ─── Global Queue Registry ─────────────────────────────────

export class QueueRegistry {
  private static adapter: QueueAdapter | null = null

  static set(adapter: QueueAdapter): void {
    this.adapter = adapter
  }

  static get(): QueueAdapter | null {
    return this.adapter
  }

  /** @internal — clears the registered adapter. Used for testing. */
  static reset(): void {
    this.adapter = null
  }
}

// ─── Sync Adapter ──────────────────────────────────────────

export class SyncAdapter implements QueueAdapter {
  async dispatch(job: Job, _options?: DispatchOptions): Promise<void> {
    try {
      await job.handle()
    } catch (error) {
      await job.failed?.(error)
      throw error
    }
  }
}

// ─── Queue Config ──────────────────────────────────────────

export interface QueueConnectionConfig {
  driver: string
  [key: string]: unknown
}

export interface QueueConfig {
  /** The default connection name (e.g. 'sync', 'inngest', 'bullmq') */
  default: string
  /** Named connections — must have at least one matching `default` */
  connections: Record<string, QueueConnectionConfig>
}

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a QueueServiceProvider class configured for the given queue config.
 * Reads `config.default` to pick the driver, then boots the matching adapter.
 *
 * Built-in drivers:  sync
 * Plugin drivers:    inngest (@boostkit/queue-inngest), bullmq (@boostkit/queue-bullmq)
 *
 * Usage in bootstrap/providers.ts:
 *   import { queue } from '@boostkit/queue'
 *   import configs from '../config/index.js'
 *   export default [..., queue(configs.queue), ...]
 */
export function queue(config: QueueConfig): new (app: Application) => ServiceProvider {
  class QueueServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      const connectionName   = config.default
      const connectionConfig = config.connections[connectionName] ?? { driver: 'sync' }
      const driver           = connectionConfig['driver'] as string

      let adapter: QueueAdapter

      if (driver === 'sync') {
        adapter = new SyncAdapter()
      } else if (driver === 'inngest') {
        const { inngest } = await resolveOptionalPeer<any>('@boostkit/queue-inngest')
        adapter = (inngest as (c: unknown) => QueueAdapterProvider)(connectionConfig).create()
      } else if (driver === 'bullmq') {
        const { bullmq } = await resolveOptionalPeer<any>('@boostkit/queue-bullmq')
        adapter = (bullmq as (c: unknown) => QueueAdapterProvider)(connectionConfig).create()
      } else {
        throw new Error(`[BoostKit Queue] Unknown driver "${driver}". Available: sync, inngest, bullmq`)
      }

      QueueRegistry.set(adapter)
      this.app.instance('queue', adapter)

      artisan.command('queue:work', async (args) => {
        if (typeof adapter.work !== 'function') {
          throw new Error(`[BoostKit Queue] Driver "${driver}" does not support workers. Switch to "bullmq" in config/queue.ts.`)
        }
        const queues = args[0] ?? 'default'
        await adapter.work(queues)
      }).description('Start a queue worker — pnpm artisan queue:work [queues=default]')

      artisan.command('queue:status', async (args) => {
        if (typeof adapter.status !== 'function') {
          throw new Error(`[BoostKit Queue] Driver "${driver}" does not support queue:status.`)
        }
        const queueName = args[0] ?? 'default'
        const stats = await adapter.status(queueName)
        console.log(`\nQueue: ${queueName}`)
        console.log(`  Waiting:   ${stats.waiting}`)
        console.log(`  Active:    ${stats.active}`)
        console.log(`  Completed: ${stats.completed}`)
        console.log(`  Failed:    ${stats.failed}`)
        console.log(`  Delayed:   ${stats.delayed}`)
        console.log(`  Paused:    ${stats.paused}\n`)
      }).description('Show queue stats — pnpm artisan queue:status [queue=default]')

      artisan.command('queue:clear', async (args) => {
        if (typeof adapter.flush !== 'function') {
          throw new Error(`[BoostKit Queue] Driver "${driver}" does not support queue:clear.`)
        }
        const queueName = args[0] ?? 'default'
        await adapter.flush(queueName)
        console.log(`Queue "${queueName}" cleared.`)
      }).description('Drain waiting + delayed jobs — pnpm artisan queue:clear [queue=default]')

      artisan.command('queue:failed', async (args) => {
        if (typeof adapter.failures !== 'function') {
          throw new Error(`[BoostKit Queue] Driver "${driver}" does not support queue:failed.`)
        }
        const queueName = args[0] ?? 'default'
        const jobs = await adapter.failures(queueName)
        if (jobs.length === 0) {
          console.log(`No failed jobs in queue "${queueName}".`)
          return
        }
        console.log(`\nFailed jobs in queue "${queueName}" (${jobs.length}):\n`)
        for (const job of jobs) {
          console.log(`  ID:       ${job.id}`)
          console.log(`  Name:     ${job.name}`)
          console.log(`  Error:    ${job.error}`)
          console.log(`  Attempts: ${job.attempts}`)
          console.log(`  Failed:   ${job.failedAt.toISOString()}`)
          console.log()
        }
      }).description('List failed jobs — pnpm artisan queue:failed [queue=default]')

      artisan.command('queue:retry', async (args) => {
        if (typeof adapter.retryFailed !== 'function') {
          throw new Error(`[BoostKit Queue] Driver "${driver}" does not support queue:retry.`)
        }
        const queueName = args[0] ?? 'default'
        const count = await adapter.retryFailed(queueName)
        console.log(`Re-enqueued ${count} failed job(s) from queue "${queueName}".`)
      }).description('Retry all failed jobs — pnpm artisan queue:retry [queue=default]')

      // Cloud adapters (Inngest etc.) expose a serve endpoint.
      // Mount it automatically — no user config needed.
      if (typeof adapter.serveHandler === 'function') {
        const { router } = await import('@boostkit/router')
        const handler = adapter.serveHandler()
        router.all('/api/inngest', (req) => handler(req.raw))
      }
    }
  }

  return QueueServiceProvider
}
