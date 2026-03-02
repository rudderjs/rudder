import { Queue, Worker } from 'bullmq'
import type { Job, QueueAdapter, QueueAdapterProvider, DispatchOptions } from '@forge/queue'

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
  private readonly queues      = new Map<string, Queue>()
  private readonly jobRegistry = new Map<string, new (...args: never[]) => Job>()
  private readonly connection:  Record<string, unknown>
  private readonly prefix:      string

  constructor(config: BullMQConfig) {
    this.connection = redisOpts(config)
    this.prefix     = config.prefix ?? 'forge'

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
      },
    )
  }

  async work(queueName = 'default'): Promise<void> {
    const worker = new Worker(
      queueName,
      async (bullJob) => {
        const JobClass = this.jobRegistry.get(bullJob.name)
        if (!JobClass) {
          throw new Error(
            `[BullMQ] Unknown job "${bullJob.name}". ` +
            `Add it to the jobs[] array in config/queue.ts.`,
          )
        }
        const instance = Object.assign(new (JobClass as new () => Job)(), bullJob.data)
        await instance.handle()
      },
      { connection: this.connection as never, prefix: this.prefix },
    )

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

    console.log(`[BullMQ] Worker ready — queue: "${queueName}", prefix: "${this.prefix}"`)

    await new Promise<void>((resolve) => {
      const shutdown = () => {
        console.log('[BullMQ] Shutting down worker...')
        void worker.close().then(resolve)
      }
      process.once('SIGTERM', shutdown)
      process.once('SIGINT',  shutdown)
    })
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
