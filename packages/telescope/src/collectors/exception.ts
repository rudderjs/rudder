import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { batchOpts } from '../batch-context.js'

/**
 * Records exceptions by wrapping the global exception reporter.
 *
 * **Load-bearing: this collector must swallow its own errors.** The
 * exception reporter sits in the framework's error handling path. If
 * `record()` throws — say, because storage is unhealthy — the framework's
 * error handler calls `report()` on *that* failure, which re-enters this
 * wrapper, which fails again, which reports again, ad infinitum. The
 * `_recording` re-entry guard plus the try/catch around `record()` and
 * `previousReport()` collectively break the cycle.
 *
 * If you refactor this class, preserve all three: the re-entry guard, the
 * record-call try/catch, and the previous-reporter try/catch. None of
 * them are defensive coding for hypothetical bugs — each blocks a real
 * cascade path that has bitten us before.
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
