import type { Aggregator, PulseStorage } from '../types.js'

/**
 * Tracks queue throughput, wait time, and failed jobs.
 * Wraps the QueueRegistry adapter's dispatch method.
 */
export class QueueAggregator implements Aggregator {
  readonly name = 'Queue Aggregator'

  constructor(private readonly storage: PulseStorage) {}

  async register(): Promise<void> {
    try {
      const { QueueRegistry } = await import('@rudderjs/queue')
      const adapter = QueueRegistry.get()
      if (!adapter) return

      const storage          = this.storage
      const originalDispatch = adapter.dispatch.bind(adapter)

      ;(adapter as unknown as Record<string, unknown>)['dispatch'] = async (
        job: unknown,
        options?: unknown,
      ): Promise<void> => {
        const dispatchedAt = Date.now()
        try {
          await (originalDispatch as (...args: unknown[]) => Promise<void>)(job, options)
          const duration = Date.now() - dispatchedAt
          storage.record('queue_throughput', 1)
          storage.record('queue_wait_time', duration)
        } catch (err) {
          storage.record('queue_throughput', 1)
          const j = job as { constructor: { name: string } }
          storage.storeEntry('failed_job', {
            class:     j.constructor.name,
            exception: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
      }
    } catch {
      // @rudderjs/queue not installed — skip
    }
  }
}
