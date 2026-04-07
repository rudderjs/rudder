import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records exceptions by wrapping the global exception reporter.
 */
export class ExceptionCollector implements Collector {
  readonly name = 'Exception Collector'
  readonly type = 'exception' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { setExceptionReporter, report } = await import('@rudderjs/core') as {
        setExceptionReporter: (fn: (err: unknown) => void) => void
        report: (err: unknown) => void
      }

      // Chain: record the exception, then forward to the previous reporter
      const previousReport = report
      setExceptionReporter((err: unknown) => {
        this.record(err)
        previousReport(err)
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
    }, { tags, ...(isError ? { familyHash: err.constructor.name } : {}) }))
  }
}
