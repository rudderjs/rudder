/**
 * Queue lifecycle observers — process-wide pub/sub for jobs flowing through
 * any `@rudderjs/queue` adapter (sync, BullMQ, …). Subscribers receive an
 * event for every dispatch / active / completion / failure transition.
 *
 * Used by `@rudderjs/horizon` to populate the dashboard cross-process: the
 * worker process emits `job.active` / `job.completed` / `job.failed`, and
 * Horizon's RedisStorage driver picks them up regardless of which process
 * dispatched the job. The registry lives in `@rudderjs/queue` so the
 * adapter contract owns its own observability surface.
 */

/** Common fields on every queue event. */
interface BaseQueueEvent {
  /** Adapter-assigned id (BullMQ id, UUID for sync). */
  jobId:        string
  /** Job class name. */
  name:         string
  queue:        string
  /** Serialized job payload. */
  payload:      Record<string, unknown>
  attempts:     number
  dispatchedAt: Date
}

/** Discriminated union of every event the queue layer can emit. */
export type QueueEvent =
  | ({ kind: 'job.dispatched' } & BaseQueueEvent)
  | ({ kind: 'job.active'    ; startedAt:   Date }                    & BaseQueueEvent)
  | ({ kind: 'job.completed' ; startedAt:   Date; completedAt: Date; duration: number } & BaseQueueEvent)
  | ({ kind: 'job.failed'    ; startedAt?:  Date; completedAt: Date; duration?: number; error: string } & BaseQueueEvent)

export type QueueObserver = (event: QueueEvent) => void

export class QueueObserverRegistry {
  private observers: QueueObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: QueueObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /**
   * Called by adapters at every lifecycle transition.
   * Errors thrown by observers are swallowed — observability must never
   * break job dispatch or worker processing.
   */
  emit(event: QueueEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break the queue */ }
    }
  }

  /** @internal — used in tests */
  reset(): void { this.observers = [] }
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_queue_observers__']) {
  _g['__rudderjs_queue_observers__'] = new QueueObserverRegistry()
}

export const queueObservers = _g['__rudderjs_queue_observers__'] as QueueObserverRegistry
