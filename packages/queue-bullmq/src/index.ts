import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import type {
  Job,
  QueueAdapter,
  QueueAdapterProvider,
  DispatchOptions,
} from '@forge/queue'

// ─── BullMQ Adapter ────────────────────────────────────────

class BullMQAdapter implements QueueAdapter {
  private queues = new Map<string, Queue>()
  private readonly connection: ConnectionOptions

  constructor(config: BullMQConfig) {
    this.connection = config.connection ?? { host: '127.0.0.1', port: 6379 }
  }

  private getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      this.queues.set(name, new Queue(name, { connection: this.connection }))
    }
    return this.queues.get(name)!
  }

  async dispatch(job: Job, options: DispatchOptions = {}): Promise<void> {
    const name  = job.constructor.name
    const queue = this.getQueue(options.queue ?? 'default')

    await queue.add(name, JSON.parse(JSON.stringify(job)), {
      ...(options.delay !== undefined ? { delay: options.delay } : {}),
      attempts: (job.constructor as typeof Job).retries,
    })
  }

  async work(queue = 'default'): Promise<void> {
    new Worker(queue, async () => {
      // Users must register job handlers via the BullMQ Worker API directly
    }, { connection: this.connection })
  }
}

// ─── Config ────────────────────────────────────────────────

export interface BullMQConfig {
  /** Redis connection options — defaults to localhost:6379 */
  connection?: ConnectionOptions
}

// ─── Factory ───────────────────────────────────────────────

export function bullmq(config: BullMQConfig = {}): QueueAdapterProvider {
  return {
    create(): QueueAdapter {
      return new BullMQAdapter(config)
    },
  }
}