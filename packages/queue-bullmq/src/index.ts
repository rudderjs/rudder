import { Queue, Worker } from 'bullmq'
import type { Job, QueueAdapter, QueueAdapterProvider, DispatchOptions, QueueStats, FailedJobInfo } from '@forge/queue'

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
  /** Redis key prefix — default: 'forge' */
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

// ─── Adapter ───────────────────────────────────────────────

class BullMQAdapter implements QueueAdapter {
  private readonly queues            = new Map<string, Queue>()
  private readonly jobRegistry       = new Map<string, new (...args: never[]) => Job>()
  private readonly connection:        Record<string, unknown>
  private readonly prefix:            string
  private readonly concurrency:       number
  private readonly removeOnComplete:  number
  private readonly removeOnFail:      number

  constructor(config: BullMQConfig) {
    this.connection        = redisOpts(config)
    this.prefix            = config.prefix           ?? 'forge'
    this.concurrency       = config.concurrency      ?? 1
    this.removeOnComplete  = config.removeOnComplete ?? 100
    this.removeOnFail      = config.removeOnFail     ?? 500

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
    return this.queues.get(name)!
  }

  private async processor(bullJob: { name: string; data: Record<string, unknown> }): Promise<void> {
    const JobClass = this.jobRegistry.get(bullJob.name)
    if (!JobClass) {
      throw new Error(
        `[BullMQ] Unknown job "${bullJob.name}". ` +
        `Add it to the jobs[] array in config/queue.ts.`,
      )
    }
    const instance = Object.assign(new (JobClass as new () => Job)(), bullJob.data)
    await instance.handle()
  }

  async dispatch(job: Job, options: DispatchOptions = {}): Promise<void> {
    const Cls       = job.constructor as typeof Job
    const queueName = options.queue ?? Cls.queue  ?? 'default'
    const delay     = options.delay ?? Cls.delay  ?? 0
    const attempts  = Cls.retries ?? 3

    await this.getQueue(queueName).add(
      job.constructor.name,
      JSON.parse(JSON.stringify(job)) as Record<string, unknown>,
      {
        ...(delay ? { delay } : {}),
        attempts,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: this.removeOnComplete },
        removeOnFail:     { count: this.removeOnFail },
      },
    )
  }

  async work(queues = 'default'): Promise<void> {
    const names   = queues.split(',').map(q => q.trim()).filter(Boolean)
    const workers = names.map(name =>
      new Worker(name, this.processor.bind(this), {
        connection:  this.connection as never,
        prefix:      this.prefix,
        concurrency: this.concurrency,
      }),
    )

    for (const worker of workers) {
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
        console.log(`[BullMQ] ✓ "${bullJob.name}" completed (id: ${bullJob.id})`)
      })

      worker.on('failed', async (bullJob, error) => {
        if (!bullJob) return
        const JobClass = this.jobRegistry.get(bullJob.name)
        if (JobClass) {
          const instance = Object.assign(new (JobClass as new () => Job)(), bullJob.data)
          await instance.failed?.(error)
        }
        console.error(
          `[BullMQ] ✗ "${bullJob.name}" failed ` +
          `(attempt ${bullJob.attemptsMade}/${String(bullJob.opts.attempts ?? '?')}): ${error.message}`,
        )
      })
    }

    console.log(`[BullMQ] Worker ready — queues: "${names.join(', ')}", concurrency: ${this.concurrency}`)

    await new Promise<void>((resolve) => {
      const shutdown = () => {
        console.log(`[BullMQ] Shutting down ${workers.length} worker(s)...`)
        void Promise.all(workers.map(w => w.close())).then(() => resolve())
      }
      process.once('SIGTERM', shutdown)
      process.once('SIGINT',  shutdown)
    })
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
    await Promise.all([...this.queues.values()].map(q => q.close()))
    this.queues.clear()
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
