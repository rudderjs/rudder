import type { Recorder, PulseStorage } from '../types.js'

/**
 * Tracks exception count over time by hooking into the exception reporter.
 */
export class ExceptionRecorder implements Recorder {
  readonly name = 'Exception Recorder'

  constructor(private readonly storage: PulseStorage) {}

  async register(): Promise<void> {
    try {
      const { setExceptionReporter, report } = await import('@rudderjs/core') as {
        setExceptionReporter: (fn: (err: unknown) => void) => void
        report: (err: unknown) => void
      }

      const storage        = this.storage
      const previousReport = report

      setExceptionReporter((err: unknown) => {
        storage.record('exceptions', 1)
        const isError = err instanceof Error
        storage.storeEntry('exception', {
          class:   isError ? err.constructor.name : 'Unknown',
          message: isError ? err.message : String(err),
        })
        previousReport(err)
      })
    } catch {
      // Should not fail
    }
  }
}
