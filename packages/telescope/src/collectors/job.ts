import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records queue job dispatches by wrapping the QueueRegistry adapter's dispatch method.
 */
export class JobCollector implements Collector {
  readonly name = 'Job Collector'
  readonly type = 'job' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { QueueRegistry } = await import('@rudderjs/queue')
      const original = QueueRegistry.get()
      if (!original) return

      const storage          = this.storage
      const originalDispatch = original.dispatch.bind(original)

      original.dispatch = async (job: unknown, options?: unknown): Promise<void> => {
        const j    = job as Record<string, unknown> & { constructor: { name: string } }
        const ctor = j.constructor as unknown as Record<string, unknown>
        const start = Date.now()
        try {
          await (originalDispatch as (job: unknown, options?: unknown) => Promise<void>)(job, options)
          const duration = Date.now() - start
          storage.store(createEntry('job', {
            class:    j.constructor.name,
            queue:    ctor['queue'] ?? 'default',
            status:   'dispatched',
            duration,
            payload:  JSON.parse(JSON.stringify(job)),
          }, { tags: [`job:${j.constructor.name}`, 'status:dispatched'] }))
        } catch (err) {
          const duration = Date.now() - start
          storage.store(createEntry('job', {
            class:     j.constructor.name,
            queue:     ctor['queue'] ?? 'default',
            status:    'failed',
            duration,
            exception: err instanceof Error ? err.message : String(err),
          }, { tags: [`job:${j.constructor.name}`, 'status:failed'] }))
          throw err
        }
      }
    } catch {
      // @rudderjs/queue not installed — skip
    }
  }
}
