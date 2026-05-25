import { Queue, Worker, type Job as BullJob } from 'bullmq'
import type { Job, QueueAdapter, QueueAdapterProvider, DispatchOptions, QueueStats, FailedJobInfo } from '@rudderjs/queue'
import { encodePayload, decodePayload, executeJob } from '@rudderjs/queue'
import { queueObservers } from '@rudderjs/queue/observers'

// ─── Config ────────────────────────────────────────────────

export interface BullMQConfig {
  driver?:   string
  /** Redis URL: redis://[:password@]host[:port][/db] */
  url?:      string
  /** Redis host — default: '127.0.0.1' */
  host?:     string
  /** Redis port — default: 6379 */
  port?:     number
  password?: string
  /** Redis key prefix — default: 'rudderjs' */
  prefix?:   string
  /** Worker concurrency per queue. Default: 1 */
  concurrency?: number
  /** Keep N completed jobs in Redis. Default: 100 */
  removeOnComplete?: number
  /** Keep N failed jobs in Redis. Default: 500 */
  removeOnFail?: number
  /**
   * Job classes that this worker can execute.
   * Must match the classes dispatched with Job.dispatch().
   *
   * @example
   *   jobs: [SendWelcomeEmailJob, ProcessOrderJob]
   */
  jobs?: (new (...args: never[]) => Job)[]
  [key: string]: unknown
}

// ─── Connection helper ─────────────────────────────────────

function redisOpts(config: BullMQConfig): Record<string, unknown> {
  // maxRetriesPerRequest: null is required by BullMQ for blocking commands (BRPOP etc.)
  const base = { maxRetriesPerRequest: null, enableReadyCheck: false }

  if (config.url) {
    try {
      const u = new URL(config.url.replace(/^rediss?:\/\//, 'http://'))
      return {
        ...base,
        host:     u.hostname || '127.0.0.1',
        port:     parseInt(u.port || '6379', 10),
        ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
        ...(u.pathname.length > 1 ? { db: parseInt(u.pathname.slice(1), 10) } : {}),
      }
    } catch {
      return { ...base, host: '127.0.0.1', port: 6379 }
    }
  }
  return {
    ...base,
    host: config.host ?? '127.0.0.1',
    port: config.port ?? 6379,
    ...(config.password ? { password: config.password } : {}),
  }
}

// ─── Dev HMR: shared Queue map across re-boots ─────────────

interface BullQueuesCache { signature: string; queues: Map<string, Queue> }
const BULLMQ_QUEUES_KEY = '__rudderjs_bullmq_queues__'

/**
 * @internal Reuse the per-name `Queue` map across Vite dev HMR re-boots.
 *
 * `QueueProvider` rebuilds the `BullMQAdapter` on every `app/` edit. Without
 * sharing, each re-boot's first dispatch lazily opens a fresh `Queue` (a Redis
 * connection) per name and orphans the previous one — a connection leaked per
 * edit toward Redis's `maxclients`. The map is cached on `globalThis` keyed by
 * the connection + prefix signature: an unchanged signature reuses the live
 * queues (no new connection); a changed signature closes the superseded ones.
 *
 * Safe to reuse a `Queue`: it's a producer-only handle carrying no app/job code
 * (job classes live in `jobRegistry`, rebuilt each boot). Workers are NOT shared
 * — they're created only in `work()` (the `queue:work` CLI, a separate process
 * that doesn't HMR). No-op in production (single boot).
 */
export function sharedBullMqQueues(signature: string): Map<string, Queue> {
  const g = globalThis as Record<string, unknown>
  const cached = g[BULLMQ_QUEUES_KEY] as BullQueuesCache | undefined
  if (cached) {
    if (cached.signature === signature) return cached.queues
    for (const q of cached.queues.values()) void q.close().catch(() => { /* releasing a superseded queue */ })
    delete g[BULLMQ_QUEUES_KEY]
  }
  const queues = new Map<string, Queue>()
  g[BULLMQ_QUEUES_KEY] = { signature, queues } satisfies BullQueuesCache
  return queues
}

// ─── Adapter ───────────────────────────────────────────────

class BullMQAdapter implements QueueAdapter {
  // Closure / chain / batch wrappers store the user's `handle` function on a
  // plain object, then go through JSON serialisation when BullMQ enqueues
  // them — the function silently becomes `undefined` and the worker has no
  // handler to call. Surface the limitation explicitly via capability flags.
  readonly supportsClosures = false
  readonly supportsChain    = false
  readonly supportsBatch    = false

  /** Shared across dev HMR re-boots via globalThis (keyed by connection +
   *  prefix) so a re-boot's first dispatch reuses the live Queue instead of
   *  opening a fresh Redis connection per name. Assigned in the constructor. */
  private readonly queues:            Map<string, Queue>
  /** @internal — track active workers so `disconnect()` can close them. Public
   *  read-only access is fine for tests; never mutate externally. */
  readonly         workers:           Worker[] = []
  private readonly jobRegistry       = new Map<string, new (...args: never[]) => Job>()
  private readonly connection:        Record<string, unknown>
  private readonly prefix:            string
  private readonly concurrency:       number
  private readonly removeOnComplete:  number
  private readonly removeOnFail:      number
  /** Bound once per adapter instance so `process.off(...)` in `disconnect()`
   *  matches the registered listener — re-creating the closure per call would
   *  silently leak it. */
  private readonly _shutdown:         () => void
  /** Resolves when `disconnect()` completes; used by `work()` to keep the
   *  CLI process blocked until shutdown. */
  private          _shutdownResolve: (() => void) | undefined

  constructor(config: BullMQConfig) {
    this.connection        = redisOpts(config)
    this.prefix            = config.prefix          ?? 'rudderjs'
    this.concurrency       = config.concurrency      ?? 1
    this.removeOnComplete  = config.removeOnComplete ?? 100
    this.removeOnFail      = config.removeOnFail     ?? 500
    this._shutdown         = () => { void this.disconnect() }
    this.queues            = sharedBullMqQueues(`${JSON.stringify(this.connection)}::${this.prefix}`)

    for (const JobClass of (config.jobs ?? [])) {
      this.jobRegistry.set(JobClass.name, JobClass)
    }
  }

  private getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, {
        connection: this.connection as never,
        prefix:     this.prefix,
      }))
    }
    // .get() is safe: key was just inserted via .set() above if missing
    return this.queues.get(name) as Queue
  }

  private async processor(bullJob: BullJob): Promise<void> {
    const JobClass = this.jobRegistry.get(bullJob.name)
    if (!JobClass) {
      throw new Error(
        `[BullMQ] Unknown job "${bullJob.name}". ` +
        `Add it to the jobs[] array in config/queue.ts.`,
      )
    }

    queueObservers.emit({
      kind:         'job.active',
      jobId:        String(bullJob.id ?? ''),
      name:         bullJob.name,
      queue:        bullJob.queueName,
      payload:      bullJob.data,
      attempts:     bullJob.attemptsMade,
      dispatchedAt: new Date(bullJob.timestamp),
      startedAt:    new Date(),
    })

    // Reconstruct the job instance — Date/BigInt/Buffer/Map/Set are untagged
    // by `decodePayload`, then `Object.assign` restores own properties onto
    // a fresh class instance. Hand off to `executeJob` so middleware,
    // ShouldBeUnique lock release, the `failed()` hook, and request-context
    // hydration all fire on this driver.
    const { __context, ...rawJobData } = bullJob.data
    const decoded = decodePayload(rawJobData) as Record<string, unknown>
    const instance = Object.assign(new (JobClass as new () => Job)(), decoded)
    await executeJob(
      instance,
      __context && typeof __context === 'object'
        ? { __context: __context as Record<string, unknown> }
        : {},
    )
  }

  async dispatch(job: Job, options: DispatchOptions = {}): Promise<void> {
    const Cls       = job.constructor as typeof Job
    const queueName = options.queue ?? Cls.queue  ?? 'default'
    const delay     = options.delay ?? Cls.delay  ?? 0
    const attempts  = Cls.retries ?? 3

    let data: Record<string, unknown>
    try {
      // Tag Date/BigInt/Buffer/Map/Set before the transport's JSON round-trip
      // so the worker receives the original types via `decodePayload` instead
      // of silent string/empty-object coercion.
      data = JSON.parse(JSON.stringify(encodePayload(job))) as Record<string, unknown>
    } catch (err) {
      throw new Error(
        `[BullMQ] Cannot serialize job "${job.constructor.name}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }

    // Attach serialized context if provided by DispatchBuilder
    if (options.__context) {
      data['__context'] = options.__context
    }

    const bullJob = await this.getQueue(queueName).add(
      job.constructor.name,
      data,
      {
        ...(delay ? { delay } : {}),
        attempts,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: this.removeOnComplete },
        removeOnFail:     { count: this.removeOnFail },
      },
    )

    queueObservers.emit({
      kind:         'job.dispatched',
      jobId:        String(bullJob.id ?? ''),
      name:         job.constructor.name,
      queue:        queueName,
      payload:      data,
      attempts:     0,
      dispatchedAt: new Date(bullJob.timestamp),
    })
  }

  async work(queues = 'default'): Promise<void> {
    // Mark this process as a queue worker so cross-cutting collectors (e.g.
    // @rudderjs/horizon's WorkerCollector) only self-register here, not in
    // the dev/web process that also boots HorizonProvider.
    process.env['RUDDERJS_QUEUE_WORKER'] = '1'

    const names = queues.split(',').map(q => q.trim()).filter(Boolean)
    const pairs = names.map(name => ({
      queue:  name,
      worker: new Worker(name, this.processor.bind(this), {
        connection:  this.connection as never,
        prefix:      this.prefix,
        concurrency: this.concurrency,
      }),
    }))

    for (const { worker } of pairs) this.workers.push(worker)

    for (const { queue, worker } of pairs) {
      worker.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ECONNREFUSED') {
          console.error(
            `[BullMQ] Cannot connect to Redis (ECONNREFUSED). ` +
            `Make sure Redis is running on ${String(this.connection['host'] ?? '127.0.0.1')}:${String(this.connection['port'] ?? 6379)}.`,
          )
        } else {
          console.error(`[BullMQ] Worker error: ${err.message}`)
        }
      })

      worker.on('completed', (bullJob) => {
        const finishedAt = bullJob.finishedOn  ? new Date(bullJob.finishedOn)  : new Date()
        const startedAt  = bullJob.processedOn ? new Date(bullJob.processedOn) : finishedAt
        queueObservers.emit({
          kind:         'job.completed',
          jobId:        String(bullJob.id ?? ''),
          name:         bullJob.name,
          queue,
          payload:      bullJob.data,
          attempts:     bullJob.attemptsMade,
          dispatchedAt: new Date(bullJob.timestamp),
          startedAt,
          completedAt:  finishedAt,
          duration:     finishedAt.getTime() - startedAt.getTime(),
        })
        console.log(`[BullMQ] ✓ "${bullJob.name}" completed (queue: ${queue}, id: ${bullJob.id})`)
      })

      // BullMQ fires this on every failed attempt. `instance.failed()` is
      // routed via `executeJob` inside `processor()` (Phase 1), so we do
      // NOT re-invoke it here — doing so would double-fire the hook per
      // attempt. This listener owns observer emission + the console log only.
      worker.on('failed', (bullJob, error) => {
        if (!bullJob) return
        const finishedAt = bullJob.finishedOn  ? new Date(bullJob.finishedOn)  : new Date()
        const startedAt  = bullJob.processedOn ? new Date(bullJob.processedOn) : undefined
        queueObservers.emit({
          kind:         'job.failed',
          jobId:        String(bullJob.id ?? ''),
          name:         bullJob.name,
          queue,
          payload:      bullJob.data,
          attempts:     bullJob.attemptsMade,
          dispatchedAt: new Date(bullJob.timestamp),
          ...(startedAt ? { startedAt } : {}),
          completedAt:  finishedAt,
          ...(startedAt ? { duration: finishedAt.getTime() - startedAt.getTime() } : {}),
          error:        error.stack ?? error.message,
        })
        console.error(
          `[BullMQ] ✗ "${bullJob.name}" failed ` +
          `(attempt ${bullJob.attemptsMade}/${String(bullJob.opts.attempts ?? '?')}): ${error.message}`,
        )
      })
    }

    // Register SIGTERM / SIGINT exactly once per adapter instance — previous
    // `process.once('SIGTERM', ...)` inside this `work()` body re-attached on
    // every call, accumulating listeners under multi-tenant boot or test re-runs
    // and never being removed. `disconnect()` removes both listeners.
    if (this.workers.length === pairs.length) {
      process.on('SIGTERM', this._shutdown)
      process.on('SIGINT',  this._shutdown)
    }

    console.log(`[BullMQ] Worker ready — queues: "${names.join(', ')}", concurrency: ${this.concurrency}`)

    // Block until `disconnect()` resolves — keeps the CLI process alive while
    // workers poll. Multiple `work()` calls share the same shutdown promise so
    // they all unblock together when a signal arrives.
    await new Promise<void>((resolve) => { this._shutdownResolve = resolve })
  }

  async status(queueName = 'default'): Promise<QueueStats> {
    const q = this.getQueue(queueName)
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
      q.getJobCountByTypes('paused'),
    ])
    return { waiting, active, completed, failed, delayed, paused }
  }

  async flush(queueName = 'default'): Promise<void> {
    await this.getQueue(queueName).drain()
  }

  async failures(queueName = 'default', limit = 50): Promise<FailedJobInfo[]> {
    const jobs = await this.getQueue(queueName).getFailed(0, limit - 1)
    return jobs.map(j => ({
      id:       j.id ?? '',
      name:     j.name,
      data:     j.data,
      error:    j.failedReason ?? 'Unknown',
      failedAt: new Date(j.timestamp),
      attempts: j.attemptsMade,
    }))
  }

  async retryFailed(queueName = 'default'): Promise<number> {
    const jobs = await this.getQueue(queueName).getFailed(0, 1000)
    await Promise.all(jobs.map(j => j.retry()))
    return jobs.length
  }

  async disconnect(): Promise<void> {
    // Remove signal handlers FIRST so a second SIGTERM during shutdown doesn't
    // re-enter `disconnect()`. `process.off` is a no-op if the listener
    // wasn't registered (work() was never called).
    process.off('SIGTERM', this._shutdown)
    process.off('SIGINT',  this._shutdown)

    if (this.workers.length > 0) {
      console.log(`[BullMQ] Shutting down ${this.workers.length} worker(s)...`)
    }

    // Close workers BEFORE queues — a worker mid-BRPOP holds a Redis
    // connection from the same pool, and closing the queue first throws
    // "Connection is closed" inside the worker's polling loop, producing
    // a confusing unhandled rejection during k8s rolling restarts.
    // `allSettled` so a single worker rejection doesn't abandon the others.
    const workerResults = await Promise.allSettled(this.workers.map(w => w.close()))
    for (const r of workerResults) {
      if (r.status === 'rejected') {
        console.error('[BullMQ] Worker close failed:', r.reason)
      }
    }
    this.workers.length = 0

    const queueResults = await Promise.allSettled([...this.queues.values()].map(q => q.close()))
    for (const r of queueResults) {
      if (r.status === 'rejected') {
        console.error('[BullMQ] Queue close failed:', r.reason)
      }
    }
    this.queues.clear()

    this._shutdownResolve?.()
    this._shutdownResolve = undefined
  }
}

// ─── Factory ───────────────────────────────────────────────

export function bullmq(config: BullMQConfig = {}): QueueAdapterProvider {
  return {
    create(): QueueAdapter {
      return new BullMQAdapter(config)
    },
  }
}
