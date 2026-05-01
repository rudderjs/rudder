import { queueObservers } from '@rudderjs/queue/observers'
import type { Recorder, PulseStorage } from '../types.js'

/**
 * Tracks queue throughput, wait time, and failed jobs by subscribing to
 * `@rudderjs/queue/observers`. Replaces the legacy `dispatch()`
 * monkey-patch which only fired in the dispatching process — under
 * BullMQ, worker-side completion and failure events were never recorded
 * and `queue_wait_time` was actually the enqueue duration, not the
 * queue-to-active wait.
 */
export class QueueRecorder implements Recorder {
  readonly name = 'Queue Recorder'
  private unsubscribe: (() => void) | null = null

  constructor(private readonly storage: PulseStorage) {}

  register(): void {
    this.unsubscribe = queueObservers.subscribe((event) => {
      try {
        switch (event.kind) {
          case 'job.active': {
            const wait = event.startedAt.getTime() - event.dispatchedAt.getTime()
            void this.storage.record('queue_wait_time', wait)
            break
          }
          case 'job.completed':
            void this.storage.record('queue_throughput', 1)
            break
          case 'job.failed':
            void this.storage.record('queue_throughput', 1)
            void this.storage.storeEntry('failed_job', {
              class:     event.name,
              queue:     event.queue,
              jobId:     event.jobId,
              attempts:  event.attempts,
              exception: event.error,
            })
            break
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
