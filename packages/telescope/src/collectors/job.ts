import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

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
        const j     = job as Record<string, unknown> & { constructor: { name: string } }
        const ctor  = j.constructor as unknown as Record<string, unknown>
        const opts  = (options ?? {}) as { queue?: string; delay?: number }
        const queue = opts.queue ?? (ctor['queue'] as string | undefined) ?? 'default'
        const delay = opts.delay ?? (ctor['delay'] as number | undefined) ?? 0
        const start = Date.now()
        try {
          await (originalDispatch as (job: unknown, options?: unknown) => Promise<void>)(job, options)
          const duration = Date.now() - start
          storage.store(createEntry('job', {
            class:    j.constructor.name,
            queue,
            status:   'dispatched',
            duration,
            ...(delay > 0 ? { delay } : undefined),
            payload:  JSON.parse(JSON.stringify(job)),
          }, { tags: [`job:${j.constructor.name}`, `queue:${queue}`, 'status:dispatched'], ...batchOpts() }))
        } catch (err) {
          const duration = Date.now() - start
          storage.store(createEntry('job', {
            class:     j.constructor.name,
            queue,
            status:    'failed',
            duration,
            exception: err instanceof Error ? err.message : String(err),
          }, { tags: [`job:${j.constructor.name}`, `queue:${queue}`, 'status:failed'], ...batchOpts() }))
          throw err
        }
      }
    } catch {
      // @rudderjs/queue not installed — skip
    }
  }
}
