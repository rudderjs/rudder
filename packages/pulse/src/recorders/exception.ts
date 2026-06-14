import type { Recorder, PulseStorage } from '../types.js'

/**
 * Tracks exception count over time by hooking into the exception reporter.
 */
export class ExceptionRecorder implements Recorder {
  readonly name = 'Exception Recorder'

  constructor(private readonly storage: PulseStorage) {}

  async register(): Promise<void> {
    try {
      const { setExceptionReporter } = await import('@rudderjs/core') as {
        setExceptionReporter: (fn: (err: unknown) => void) => (err: unknown) => void
      }

      const storage = this.storage

      // Capture the reporter installed *before* us and chain to it. Capturing
      // `report` instead would call whatever the current reporter is — i.e.
      // this very wrapper — and recurse until the stack overflows.
      const previousReport = setExceptionReporter((err: unknown) => {
        try {
          storage.record('exceptions', 1)
          const isError = err instanceof Error
          storage.storeEntry('exception', {
            class:   isError ? err.constructor.name : 'Unknown',
            message: isError ? err.message : String(err),
          })
        } catch {
          // Recording must never break the reporter chain.
        }
        previousReport(err)
      })
    } catch {
      // Should not fail
    }
  }
}
