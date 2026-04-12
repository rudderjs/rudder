/**
 * Dump event observers — process-wide pub/sub for `dump()` and `dd()`
 * calls. Any package can subscribe to be notified when a dump occurs.
 *
 * Used today by `@rudderjs/telescope`'s DumpCollector to record
 * dump calls into the dashboard.
 */

export interface DumpEvent {
  args:    unknown[]
  /** 'dump' or 'dd' */
  method:  'dump' | 'dd'
  /** Caller file:line from Error().stack (best-effort) */
  caller?: string | undefined
}

export type DumpObserver = (event: DumpEvent) => void

export class DumpObserverRegistry {
  private observers: DumpObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: DumpObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /**
   * Called by `dump()` and `dd()` at each invocation.
   * Errors thrown by observers are swallowed — observability must never
   * break debug helpers.
   */
  emit(event: DumpEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break dump */ }
    }
  }

  /** @internal — used in tests */
  reset(): void { this.observers = [] }
}

// Process-wide singleton, like `broadcastObservers` in `@rudderjs/broadcast`.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_dump_observers__']) {
  _g['__rudderjs_dump_observers__'] = new DumpObserverRegistry()
}

export const dumpObservers = _g['__rudderjs_dump_observers__'] as DumpObserverRegistry
