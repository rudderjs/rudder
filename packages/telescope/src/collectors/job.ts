import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

/**
 * Minimal local shape of `@rudderjs/queue`'s `QueueEvent`. Defined inline (the
 * load-bearing peer-bridge pattern) so telescope stays downstream of queue —
 * importing the peer's full types would invert the dependency graph.
 */
interface QueueObserverEvent {
  kind:      'job.dispatched' | 'job.active' | 'job.completed' | 'job.failed'
  jobId:     string
  name:      string
  queue:     string
  payload:   Record<string, unknown>
  attempts:  number
  duration?: number
  error?:    string
}

/**
 * Subscribes to `@rudderjs/queue/observers` and records one entry per
 * lifecycle transition. Replaces the legacy `dispatch()` monkey-patch
 * which only fired in the dispatching process — under BullMQ, worker-side
 * completion and failure events were never recorded.
 */
export class JobCollector implements Collector {
  readonly name = 'Job Collector'
  readonly type = 'job' as const
  private unsubscribe: (() => void) | null = null

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    // `@rudderjs/queue` is an optional peer — lazy-import it inside register()
    // (like every other collector) so importing telescope in an app that
    // doesn't install the queue package doesn't crash at module load. A static
    // top-level import would throw ERR_MODULE_NOT_FOUND before any config check.
    let queueObservers: { subscribe(cb: (event: QueueObserverEvent) => void): () => void }
    try {
      ({ queueObservers } = await import('@rudderjs/queue/observers') as {
        queueObservers: { subscribe(cb: (event: QueueObserverEvent) => void): () => void }
      })
    } catch {
      return // queue package not installed — graceful degradation
    }

    this.unsubscribe = queueObservers.subscribe((event) => {
      try {
        switch (event.kind) {
          case 'job.dispatched':
            this.storage.store(createEntry('job', {
              class:    event.name,
              queue:    event.queue,
              jobId:    event.jobId,
              status:   'dispatched',
              payload:  event.payload,
            }, { tags: [`job:${event.name}`, `queue:${event.queue}`, 'status:dispatched'], ...batchOpts() }))
            break
          case 'job.completed':
            this.storage.store(createEntry('job', {
              class:    event.name,
              queue:    event.queue,
              jobId:    event.jobId,
              status:   'completed',
              duration: event.duration,
              attempts: event.attempts,
            }, { tags: [`job:${event.name}`, `queue:${event.queue}`, 'status:completed'], ...batchOpts() }))
            break
          case 'job.failed':
            this.storage.store(createEntry('job', {
              class:     event.name,
              queue:     event.queue,
              jobId:     event.jobId,
              status:    'failed',
              attempts:  event.attempts,
              exception: event.error,
              ...(event.duration !== undefined ? { duration: event.duration } : {}),
            }, { tags: [`job:${event.name}`, `queue:${event.queue}`, 'status:failed'], ...batchOpts() }))
            break
          // job.active is intentionally not recorded — it'd double the row count
          // for every job and the same data lives on the completed/failed entry.
        }
      } catch {
        // observer errors must not break the queue layer
      }
    })
  }

  /** @internal — used in tests + provider shutdown. */
  unregister(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
