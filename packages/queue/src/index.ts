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
  /**
   * Serialized request-context payload (from `@rudderjs/context`). Public on
   * the contract because queue adapters (`@rudderjs/queue-bullmq` etc.) read
   * and forward it to job execution. The double-underscore signals "framework
   * wiring; not for app code."
   */
  __context?: Record<string, unknown>
}

/**
 * Worker-loop options parsed from `queue:work` flags. Honored by self-hosted
 * polling drivers (the native `database` driver); managed drivers (BullMQ,
 * Inngest) own their own retry/concurrency model and ignore these.
 */
export interface WorkerOptions {
  /** Process a single job, then exit (`--once`). */
  once?: boolean
  /** Process all available jobs, then exit gracefully (`--stop-when-empty`). */
  stopWhenEmpty?: boolean
  /** Seconds to sleep when no job is available (`--sleep`, default 3). */
  sleep?: number
  /** Max attempts before a job is moved to failed_jobs (`--tries`). */
  tries?: number
  /** Seconds to wait before retrying a released job (`--backoff`). */
  backoff?: number
  /** Seconds a single job may run before the await is abandoned (`--timeout`). */
  timeout?: number
  /** Process this many jobs, then exit (`--max-jobs`). */
  maxJobs?: number
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

  /** Start processing jobs (for self-hosted adapters like BullMQ / database) —
   *  comma-separated queue names (priority order) + parsed worker options. */
  work?(queues?: string, options?: WorkerOptions): Promise<void>

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

  /**
   * Drop the registered queue adapter. Test-cleanup hook — kept on the
   * public API because other packages' test suites (`@rudderjs/mail` is
   * one) reset the registry across the package boundary.
   */
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

// ─── queue:work argument parsing ───────────────────────────

/**
 * Split `queue:work` args into the positional queue list and parsed
 * {@link WorkerOptions} flags. The first non-flag token is the comma-separated
 * queue names (priority order); `--flag` / `--flag=value` tokens populate options.
 */
export function parseWorkerArgs(args: string[]): { queues: string; options: WorkerOptions } {
  const positional: string[] = []
  const options: WorkerOptions = {}
  // Parse a numeric flag value, ignoring a missing or non-numeric one. A bare
  // `--sleep` / `--tries` (no `=value`) yields `Number(undefined) === NaN`;
  // because NaN is not nullish, leaving it on the option would defeat every
  // downstream `?? default` (NaN sleep → busy-spin; NaN tries → `attempts >=
  // NaN` is always false → the job is released forever and never dead-lettered).
  // Returning undefined lets the default apply instead.
  const num = (v: string | undefined): number | undefined => {
    if (v === undefined || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  for (const arg of args) {
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const [flag, raw] = arg.slice(2).split('=')
    switch (flag) {
      case 'once':            options.once = true; break
      case 'stop-when-empty': options.stopWhenEmpty = true; break
      case 'sleep':    { const n = num(raw); if (n !== undefined) options.sleep   = n; break }
      case 'tries':    { const n = num(raw); if (n !== undefined) options.tries   = n; break }
      case 'backoff':  { const n = num(raw); if (n !== undefined) options.backoff = n; break }
      case 'timeout':  { const n = num(raw); if (n !== undefined) options.timeout = n; break }
      case 'max-jobs': { const n = num(raw); if (n !== undefined) options.maxJobs = n; break }
    }
  }
  return { queues: positional[0] ?? 'default', options }
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
      } else if (driver === 'database') {
        // In-package native driver — no optional peer. It reaches the ORM
        // lazily (resolveOptionalPeer) so this import stays dependency-free.
        const { database } = await import('./native/index.js')
        adapter = database(connectionConfig).create()
      } else if (driver === 'inngest') {
        const { inngest } = await resolveOptionalPeer<{ inngest: (c: unknown) => QueueAdapterProvider }>('@rudderjs/queue-inngest')
        adapter = inngest(connectionConfig).create()
      } else if (driver === 'bullmq') {
        const { bullmq } = await resolveOptionalPeer<{ bullmq: (c: unknown) => QueueAdapterProvider }>('@rudderjs/queue-bullmq')
        adapter = bullmq(connectionConfig).create()
      } else {
        throw new Error(`[RudderJS Queue] Unknown driver "${driver}". Available: sync, database, inngest, bullmq`)
      }

      QueueRegistry.set(adapter)
      this.app.instance('queue', adapter)

      // All commands resolve the adapter at invocation via `QueueRegistry.get()`
      // instead of closing over `adapter` captured at boot — Vite SSR re-eval
      // calls `boot()` again, the dedup in `rudder.command()` replaces our
      // closure with a fresh one, but any stale handler that survived would
      // operate against the previous adapter. Lazy lookup means the latest
      // adapter is always the one acted on, and tests that swap the adapter
      // via `QueueRegistry.set(...)` work end-to-end with no boot re-run.
      const currentAdapter = (): QueueAdapter => {
        const a = QueueRegistry.get()
        if (!a) throw new Error('[RudderJS Queue] No queue adapter registered')
        return a
      }
      const driverName = (): string => driver

      rudder.command('queue:work', async (args) => {
        const a = currentAdapter()
        if (typeof a.work !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driverName()}" does not support workers. Switch to "bullmq" or "database" in config/queue.ts.`)
        }
        const { queues, options } = parseWorkerArgs(args)
        await a.work(queues, options)
      }).description('Start a queue worker — pnpm rudder queue:work [queues=default] [--once --sleep=3 --tries=3 --backoff=0 --timeout=60 --max-jobs=N --stop-when-empty]')

      rudder.command('queue:table', async () => {
        const { writeQueueMigrations } = await import('./native/table-command.js')
        const cfg2  = config<QueueConfig>('queue')
        const conn: QueueConnectionConfig = cfg2.connections[cfg2.default] ?? { driver: 'database' }
        const table = (conn['table'] as string | undefined) ?? 'jobs'
        const failedTable = (conn['failedTable'] as string | undefined) ?? 'failed_jobs'
        const written = await writeQueueMigrations(process.cwd(), table, failedTable)
        for (const p of written) console.log(`  ✓ ${p}`)
        console.log('\nRun `pnpm rudder migrate` to create the tables.')
      }).description('Stub the jobs + failed_jobs migrations — pnpm rudder queue:table')

      rudder.command('queue:status', async (args) => {
        const a = currentAdapter()
        if (typeof a.status !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driverName()}" does not support queue:status.`)
        }
        const queueName = args[0] ?? 'default'
        const stats = await a.status(queueName)
        console.log(`\nQueue: ${queueName}`)
        console.log(`  Waiting:   ${stats.waiting}`)
        console.log(`  Active:    ${stats.active}`)
        console.log(`  Completed: ${stats.completed}`)
        console.log(`  Failed:    ${stats.failed}`)
        console.log(`  Delayed:   ${stats.delayed}`)
        console.log(`  Paused:    ${stats.paused}\n`)
        // Close the adapter's connection so this one-shot command exits — an open
        // BullMQ/Redis connection keeps the event loop alive and hangs the CLI.
        await a.disconnect?.()
      }).description('Show queue stats — pnpm rudder queue:status [queue=default]')

      rudder.command('queue:clear', async (args) => {
        const a = currentAdapter()
        if (typeof a.flush !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driverName()}" does not support queue:clear.`)
        }
        const queueName = args[0] ?? 'default'
        await a.flush(queueName)
        console.log(`Queue "${queueName}" cleared.`)
        await a.disconnect?.()
      }).description('Drain waiting + delayed jobs — pnpm rudder queue:clear [queue=default]')

      rudder.command('queue:failed', async (args) => {
        const a = currentAdapter()
        if (typeof a.failures !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driverName()}" does not support queue:failed.`)
        }
        const queueName = args[0] ?? 'default'
        const jobs = await a.failures(queueName)
        if (jobs.length === 0) {
          console.log(`No failed jobs in queue "${queueName}".`)
        } else {
          console.log(`\nFailed jobs in queue "${queueName}" (${jobs.length}):\n`)
          for (const job of jobs) {
            console.log(`  ID:       ${job.id}`)
            console.log(`  Name:     ${job.name}`)
            console.log(`  Error:    ${job.error}`)
            console.log(`  Attempts: ${job.attempts}`)
            console.log(`  Failed:   ${job.failedAt.toISOString()}`)
            console.log()
          }
        }
        await a.disconnect?.()
      }).description('List failed jobs — pnpm rudder queue:failed [queue=default]')

      rudder.command('queue:retry', async (args) => {
        const a = currentAdapter()
        if (typeof a.retryFailed !== 'function') {
          throw new Error(`[RudderJS Queue] Driver "${driverName()}" does not support queue:retry.`)
        }
        const queueName = args[0] ?? 'default'
        const count = await a.retryFailed(queueName)
        console.log(`Re-enqueued ${count} failed job(s) from queue "${queueName}".`)
        await a.disconnect?.()
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
