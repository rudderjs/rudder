import { queueObservers } from '@rudderjs/queue/observers'
import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

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

  register(): void {
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
