import { queueObservers } from '@rudderjs/queue/observers'
import type { HorizonStorage, HorizonJob } from '../types.js'
import type { MetricsCollector } from './metrics.js'

/**
 * Subscribes to `@rudderjs/queue/observers` and forwards lifecycle events
 * into Horizon's storage. Replaces the legacy `dispatch()` monkey-patch
 * which couldn't see worker-process events under BullMQ.
 *
 * The previous monkey-patch wrapped `job.handle` on an in-memory instance
 * the worker process never received via Redis — so worker-side
 * completed/failed transitions were lost. The observer surface emits in
 * the worker process, RedisStorage propagates the writes back to the
 * dashboard process. See `docs/plans/2026-05-01-horizon-bullmq-fix.md`.
 */
export class JobCollector {
  readonly name = 'Job Collector'
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly storage:          HorizonStorage,
    private readonly metricsCollector: MetricsCollector | null = null,
  ) {}

  register(): void {
    this.unsubscribe = queueObservers.subscribe((event) => {
      // Storage writes can be async (Redis); fire-and-forget but trap rejects
      // so a transient Redis blip never escapes into the queue layer.
      void Promise.resolve().then(async () => {
        try {
          switch (event.kind) {
            case 'job.dispatched': {
              const record: HorizonJob = {
                id:           event.jobId,
                name:         event.name,
                queue:        event.queue,
                status:       'pending',
                payload:      event.payload,
                attempts:     0,
                exception:    null,
                dispatchedAt: event.dispatchedAt,
                startedAt:    null,
                completedAt:  null,
                duration:     null,
                tags:         [`job:${event.name}`, `queue:${event.queue}`],
              }
              await this.storage.recordJob(record)
              break
            }
            case 'job.active':
              await this.storage.updateJob(event.queue, event.jobId, {
                status:    'processing',
                startedAt: event.startedAt,
                attempts:  event.attempts,
              })
              break
            case 'job.completed':
              await this.storage.updateJob(event.queue, event.jobId, {
                status:      'completed',
                completedAt: event.completedAt,
                duration:    event.duration,
              })
              this.metricsCollector?.recordJobCompleted(
                event.queue,
                event.startedAt.getTime() - event.dispatchedAt.getTime(),
                event.duration,
              )
              break
            case 'job.failed':
              await this.storage.updateJob(event.queue, event.jobId, {
                status:      'failed',
                completedAt: event.completedAt,
                ...(event.duration !== undefined ? { duration: event.duration } : {}),
                exception:   event.error,
              })
              break
          }
        } catch (err) {
          console.warn('[Horizon] storage write failed:', err instanceof Error ? err.message : String(err))
        }
      })
    })
  }

  /** @internal — used in tests + provider shutdown. */
  unregister(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
