import { randomUUID } from 'node:crypto'
import { ServiceProvider, rudder, config } from '@rudderjs/core'
import { resolveOptionalPeer } from '@rudderjs/core'
import { queueObservers } from './observers.js'
import { encodePayload } from './serialize.js'
import { executeJob } from './execute.js'
import { acquireUniqueLock, isUniqueJob } from './unique.js'
import { FakeQueueAdapter } from './fake.js'

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

  /** Job middleware — override to return middleware instances. */
  middleware?(): import('./job-middleware.js').JobMiddleware[]

  /** Called when all retries are exhausted */
  failed?(error: unknown): void | Promise<void>

  /** Dispatch this job via the global dispatcher */
  // Uses `any[]` for the `this` constraint so subclasses with typed
  // constructors (e.g. `constructor(public name: string)`) remain assignable.
  // `unknown[]` would force contravariance and reject every typed constructor.
  // Arg-level type safety is still preserved via `ConstructorParameters<typeof this>`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static dispatch<T extends Job>(
    this: new (...args: any[]) => T,
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
    if (!adapter) throw new Error('[RudderJS Queue] No queue adapter registered')

    // ShouldBeUnique: acquire the dispatch lock atomically. If another
    // dispatcher already won the race, silently skip enqueueing — Laravel
    // semantics. `executeJob` releases the lock when the worker side
    // finishes (or right before processing starts for
    // `ShouldBeUniqueUntilProcessing`).
    if (isUniqueJob(this.job)) {
      const acquired = await acquireUniqueLock(this.job)
      if (!acquired) return
    }

    // Propagate request context to the job if @rudderjs/context is installed
    let contextPayload: Record<string, unknown> | undefined
    try {
      const specifier = '@rudderjs/context'
      const mod = await import(/* @vite-ignore */ specifier) as {
        Context: { dehydrate(): Record<string, unknown> }
        hasContext(): boolean
      }
      if (mod.hasContext()) {
        contextPayload = mod.Context.dehydrate()
      }
    } catch {
      // @rudderjs/context not installed — skip
    }

    await adapter.dispatch(this.job, {
      delay: this._delay,
      queue: this._queue,
      ...(contextPayload ? { __context: contextPayload } : undefined),
    })
  }
}

// ─── Queue Adapter Contract ────────────────────────────────

export interface DispatchOptions {
  delay?: number
  queue?: string
  /** @internal — serialized context from @rudderjs/context */
  __context?: Record<string, unknown>
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

  /**
   * Whether closure-style `dispatch(fn)` is supported. The default runner
   * stuffs the user's function into a `{ handle: fn }` object and dispatches
   * it — that survives only on in-process drivers (Sync, Fake). Async drivers
   * serialize the wrapper through JSON, dropping the function silently and
   * leaving the worker with no `handle` to call. Drivers that can run closures
   * (in-process) set this `true`; everyone else `false`.
   */
  readonly supportsClosures?: boolean

  /**
   * Whether `Chain.of([...]).dispatch()` is supported. The default chain
   * runner wraps the job array in a closure — same JSON-loses-functions
   * trap as `supportsClosures`. Adapters that ship a native `dispatchChain`
   * (or whose default runner is safe, i.e. Sync) flip this `true`.
   */
  readonly supportsChain?: boolean

  /**
   * Whether `Bus.batch([...]).dispatch()` is supported. The default batch
   * runner wraps each job in a closure-tracked dispatcher — again, the
   * JSON-loses-functions trap. Adapters with a native `dispatchBatch` (or
   * in-process drivers) flip this `true`.
   */
  readonly supportsBatch?: boolean

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

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/queue` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/queue` inline (`Queue.dispatch`
 * and worker boot read `QueueRegistry`), but driver packages
 * (`@rudderjs/queue-bullmq`) are externalized and resolve their own copy of
 * `@rudderjs/queue` from `node_modules`. Without a shared store,
 * `QueueRegistry.set()` from the externalized driver would land on a different
 * class than the one `Queue.*` reads from inside the bundle, producing a
 * misleading `No queue adapter registered` error on every `Queue.dispatch`
 * call in prod. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`),
 * PR #500 (`@rudderjs/pennant`), and PR #501 (`@rudderjs/cache`).
 */
interface QueueRegistryStore {
  adapter: QueueAdapter | null
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_queue_registry__']) {
  _g['__rudderjs_queue_registry__'] = {
    adapter: null,
  } satisfies QueueRegistryStore
}
const _store = _g['__rudderjs_queue_registry__'] as QueueRegistryStore

export class QueueRegistry {
  static set(adapter: QueueAdapter): void {
    _store.adapter = adapter
  }

  static get(): QueueAdapter | null {
    return _store.adapter
  }

  /** @internal — clears the registered adapter. Used for testing. */
  static reset(): void {
    _store.adapter = null
  }
}

// ─── Sync Adapter ──────────────────────────────────────────

/**
 * Encode a job into a JSON-safe payload that round-trips Date/BigInt/Buffer/
 * Map/Set through the queue transport. Throws on a non-serialisable value
 * (BigInt key conflicts, circular refs) — the prior `try/catch { return {} }`
 * silently dropped the entire payload and made the bug invisible to observers.
 */
function safePayload(job: Job): Record<string, unknown> {
  // `JSON.parse(JSON.stringify(...))` round-trip after `encodePayload` keeps
  // the payload shape identical to what the worker will receive over the
  // wire (after the transport's own JSON round-trip), so the sync adapter's
  // observers see the same data type the BullMQ/Inngest workers would.
  return JSON.parse(JSON.stringify(encodePayload(job))) as Record<string, unknown>
}

export class SyncAdapter implements QueueAdapter {
  // In-process driver runs the job in the same tick as dispatch, so the
  // wrapped closures in `dispatch(fn)` / `Chain` / `Bus.batch` keep their
  // `handle` reference intact (no JSON round-trip).
  readonly supportsClosures = true
  readonly supportsChain    = true
  readonly supportsBatch    = true

  async dispatch(job: Job, options?: DispatchOptions): Promise<void> {
    const jobId        = randomUUID()
    const name         = job.constructor.name
    const queue        = options?.queue ?? (job.constructor as typeof Job).queue
    const payload      = safePayload(job)
    const dispatchedAt = new Date()
    const base         = { jobId, name, queue, payload, attempts: 1, dispatchedAt }

    queueObservers.emit({ ...base, kind: 'job.dispatched', attempts: 0 })

    const startedAt = new Date()
    queueObservers.emit({ ...base, kind: 'job.active', startedAt })

    try {
      // Route through the shared `executeJob` helper so middleware /
      // unique-lock release / failed() hook all fire on this driver. Pass
      // the original instance — Sync runs in-process so there's no wire
      // round-trip, and the instance keeps closure-style `handle` methods
      // intact (used by `dispatch(fn)`, `Chain`, batch wrappers).
      await executeJob(job, options ? { __context: options.__context } : {})
      const completedAt = new Date()
      queueObservers.emit({
        ...base,
        kind: 'job.completed',
        startedAt, completedAt,
        duration: completedAt.getTime() - startedAt.getTime(),
      })
    } catch (error) {
      const completedAt = new Date()
      queueObservers.emit({
        ...base,
        kind: 'job.failed',
        startedAt, completedAt,
        duration: completedAt.getTime() - startedAt.getTime(),
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      })
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
 * Plugin drivers:    inngest (@rudderjs/queue-inngest), bullmq (@rudderjs/queue-bullmq)
 *
 * Usage in bootstrap/providers.ts:
 *   import { queue } from '@rudderjs/queue'
 *   import configs from '../config/index.js'
 *   export default [..., queue(configs.queue), ...]
 */
export class QueueProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg              = config<QueueConfig>('queue')
    const connectionName   = cfg.default
    const connectionConfig = cfg.connections[connectionName] ?? { driver: 'sync' }
      const driver           = connectionConfig['driver'] as string

      let adapter: QueueAdapter

      if (driver === 'sync') {
        adapter = new SyncAdapter()
      } else if (driver === 'inngest') {
        const { inngest } = await resolveOptionalPeer<{ inngest: (c: unknown) => QueueAdapterProvider }>('@rudderjs/queue-inngest')
        adapter = inngest(connectionConfig).create()
      } else if (driver === 'bullmq') {
        const { bullmq } = await resolveOptionalPeer<{ bullmq: (c: unknown) => QueueAdapterProvider }>('@rudderjs/queue-bullmq')
        adapter = bullmq(connectionConfig).create()
      } else {
        throw new Error(`[RudderJS Queue] Unknown driver "${driver}". Available: sync, inngest, bullmq`)
      }

      QueueRegistry.set(adapter)
      this.app.instance('queue', adapter)

      rudder.command('queue:work', async (args) => {
        if (typeof adapter.work !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driver}" does not support workers. Switch to "bullmq" in config/queue.ts.`)
        }
        const queues = args[0] ?? 'default'
        await adapter.work(queues)
      }).description('Start a queue worker — pnpm rudder queue:work [queues=default]')

      rudder.command('queue:status', async (args) => {
        if (typeof adapter.status !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driver}" does not support queue:status.`)
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
      }).description('Show queue stats — pnpm rudder queue:status [queue=default]')

      rudder.command('queue:clear', async (args) => {
        if (typeof adapter.flush !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driver}" does not support queue:clear.`)
        }
        const queueName = args[0] ?? 'default'
        await adapter.flush(queueName)
        console.log(`Queue "${queueName}" cleared.`)
      }).description('Drain waiting + delayed jobs — pnpm rudder queue:clear [queue=default]')

      rudder.command('queue:failed', async (args) => {
        if (typeof adapter.failures !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driver}" does not support queue:failed.`)
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
      }).description('List failed jobs — pnpm rudder queue:failed [queue=default]')

      rudder.command('queue:retry', async (args) => {
        if (typeof adapter.retryFailed !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driver}" does not support queue:retry.`)
        }
        const queueName = args[0] ?? 'default'
        const count = await adapter.retryFailed(queueName)
        console.log(`Re-enqueued ${count} failed job(s) from queue "${queueName}".`)
      }).description('Retry all failed jobs — pnpm rudder queue:retry [queue=default]')

    // Cloud adapters (Inngest etc.) expose a serve endpoint.
    // Mount it automatically — no user config needed.
    if (typeof adapter.serveHandler === 'function') {
      const { router } = await import('@rudderjs/router')
      const handler = adapter.serveHandler()
      router.all('/api/inngest', (req) => handler(req.raw))
    }
  }
}

// ─── Queue Facade ─────────────────────────────────────────

export class Queue {
  /** Replace the queue adapter with a fake for testing. */
  static fake(): FakeQueueAdapter {
    return FakeQueueAdapter.fake()
  }
}

// ─── Re-exports ────────────────────────────────────────────

export { Chain, getChainState }                        from './chain.js'
export { Bus, Batch, PendingBatch }                    from './batch.js'
export { dispatch }                                    from './closure.js'
export type { ShouldBeUnique, ShouldBeUniqueUntilProcessing }  from './unique.js'
export { isUniqueJob, isUniqueUntilProcessing, acquireUniqueLock, releaseUniqueLock }  from './unique.js'
export type { JobMiddleware }                          from './job-middleware.js'
export { runJobMiddleware, RateLimited, WithoutOverlapping, ThrottlesExceptions, Skip }  from './job-middleware.js'
export { encodePayload, decodePayload }                from './serialize.js'
export { executeJob, type ExecuteJobContext }          from './execute.js'
export { FakeQueueAdapter }                           from './fake.js'
