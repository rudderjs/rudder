import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

/**
 * Records exceptions by wrapping the global exception reporter.
 */
export class ExceptionCollector implements Collector {
  readonly name = 'Exception Collector'
  readonly type = 'exception' as const
  private _recording = false

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { setExceptionReporter, report } = await import('@rudderjs/core') as {
        setExceptionReporter: (fn: (err: unknown) => void) => void
        report: (err: unknown) => void
      }

      // Chain: record the exception, then forward to the previous reporter.
      // The _recording guard stays ON through both record() and previousReport()
      // to prevent re-entry — the framework's error handler may call report()
      // again which re-enters this wrapper.
      const previousReport = report
      setExceptionReporter((err: unknown) => {
        if (this._recording) return
        this._recording = true
        try {
          this.record(err)
        } catch {
          // Recording failed — swallow to prevent cascading
        }
        try {
          previousReport(err)
        } catch {
          // Previous reporter failed — swallow
        }
        this._recording = false
      })
    } catch {
      // Should never fail since @rudderjs/core is a direct dep
    }
  }

  private record(err: unknown): void {
    const isError = err instanceof Error
    const tags: string[] = ['error']
    if (isError) tags.push(`class:${err.constructor.name}`)

    this.storage.store(createEntry('exception', {
      class:   isError ? err.constructor.name : 'Unknown',
      message: isError ? err.message : String(err),
      stack:   isError && err.stack ? err.stack.split('\n').map(l => l.trim()) : [],
    }, { tags, ...batchOpts(), ...(isError ? { familyHash: err.constructor.name } : {}) }))
  }
}
