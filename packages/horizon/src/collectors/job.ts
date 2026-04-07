import { randomUUID } from 'node:crypto'
import { QueueRegistry, type Job, type DispatchOptions } from '@rudderjs/queue'
import type { HorizonStorage, HorizonJob } from '../types.js'

/**
 * Intercepts job dispatch and execution to record full job lifecycle.
 * Wraps the QueueAdapter to capture dispatch, start, completion, and failure events.
 */
export class JobCollector {
  readonly name = 'Job Collector'

  constructor(private readonly storage: HorizonStorage) {}

  register(): void {
    const adapter = QueueRegistry.get()
    if (!adapter) return

    const storage          = this.storage
    const originalDispatch = adapter.dispatch.bind(adapter)

    ;(adapter as unknown as Record<string, unknown>)['dispatch'] = async (
      job: Job,
      options?: DispatchOptions,
    ): Promise<void> => {
      const id    = randomUUID()
      const name  = job.constructor.name
      const queue = options?.queue ?? (job.constructor as unknown as Record<string, unknown>)['queue'] as string ?? 'default'
      const now   = new Date()

      // Record dispatch
      const record: HorizonJob = {
        id,
        name,
        queue,
        status:       'pending',
        payload:      safeSerialize(job),
        attempts:     0,
        exception:    null,
        dispatchedAt: now,
        startedAt:    null,
        completedAt:  null,
        duration:     null,
        tags:         [`job:${name}`, `queue:${queue}`],
      }
      storage.recordJob(record)

      // Track start/complete/fail via wrapping the job's handle method
      const originalHandle = job.handle.bind(job)
      const originalFailed = job.failed?.bind(job)

      job.handle = async () => {
        const startedAt = new Date()
        storage.updateJob(id, { status: 'processing', startedAt, attempts: record.attempts + 1 })

        try {
          await originalHandle()
          const completedAt = new Date()
          const duration    = completedAt.getTime() - startedAt.getTime()
          storage.updateJob(id, { status: 'completed', completedAt, duration })
        } catch (err) {
          const completedAt = new Date()
          const duration    = completedAt.getTime() - startedAt.getTime()
          storage.updateJob(id, {
            status:    'failed',
            completedAt,
            duration,
            exception: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
      }

      if (originalFailed) {
        job.failed = async (error: unknown) => {
          storage.updateJob(id, {
            status:    'failed',
            exception: error instanceof Error ? error.message : String(error),
          })
          await originalFailed(error)
        }
      }

      await (originalDispatch as (job: Job, options?: DispatchOptions) => Promise<void>)(job, options)
    }
  }
}

function safeSerialize(obj: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>
  } catch {
    return {}
  }
}
