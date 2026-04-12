/**
 * Gate event observers — process-wide pub/sub for authorization
 * decisions made through `Gate.allows()`, `Gate.denies()`, and
 * `Gate.authorize()`.
 *
 * Used today by `@rudderjs/telescope`'s GateCollector to record
 * authorization checks into the dashboard.
 */

export interface GateEvent {
  ability:     string
  userId:      string | null
  allowed:     boolean
  /** What resolved the decision */
  resolvedVia: 'ability' | 'policy' | 'before' | 'default'
  /** Policy class name (if resolved via policy) */
  policy?:     string | undefined
  /** Model class name (if a model was passed) */
  model?:      string | undefined
  /** Duration of the check in ms */
  duration:    number
}

export type GateObserver = (event: GateEvent) => void

export class GateObserverRegistry {
  private observers: GateObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: GateObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /**
   * Called by `Gate.allows()` after each authorization check.
   * Errors thrown by observers are swallowed — observability must never
   * break authorization.
   */
  emit(event: GateEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break auth */ }
    }
  }

  /** @internal — used in tests */
  reset(): void { this.observers = [] }
}

// Process-wide singleton, like `broadcastObservers` in `@rudderjs/broadcast`.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_gate_observers__']) {
  _g['__rudderjs_gate_observers__'] = new GateObserverRegistry()
}

export const gateObservers = _g['__rudderjs_gate_observers__'] as GateObserverRegistry
