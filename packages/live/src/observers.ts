/**
 * Live event observers — process-wide pub/sub for the Yjs document
 * lifecycle. Used today by `@rudderjs/telescope`'s LiveCollector to
 * record CRDT activity into the dashboard. Any package can subscribe.
 *
 * This is the abstraction contract for Live observability — the WS
 * handler in `index.ts` is one producer feeding into it. If a future
 * non-WebSocket Live transport ever ships (HTTP long-poll, server-sent
 * events for one-way sync), it would feed into the same registry.
 *
 * Awareness throttling lives in the CONSUMER (e.g. LiveCollector),
 * not here. Producers emit every event; consumers decide their own
 * sampling strategy. Yjs awareness fires on every cursor move which
 * could be high-rate, so consumers should expect to throttle.
 */

/** Discriminated union of every event the Live layer can emit. */
export type LiveEvent =
  | {
      kind:        'doc.opened'
      docName:     string
      clientId:    string
      /** Total clients now connected to this doc */
      clientCount: number
    }
  | {
      kind:        'doc.closed'
      docName:     string
      clientId:    string
      clientCount: number
    }
  | {
      kind:           'update.applied'
      docName:        string
      /** Originating client (the one that sent the update) */
      clientId:       string
      /** Update byte size */
      byteSize:       number
      /** Number of other clients the update was forwarded to */
      recipientCount: number
    }
  | {
      kind:     'awareness.changed'
      docName:  string
      clientId: string
      byteSize: number
    }
  | {
      kind:       'persistence.load'
      docName:    string
      durationMs: number
      byteSize:   number
    }
  | {
      kind:     'persistence.save'
      docName:  string
      byteSize: number
    }
  | {
      kind:      'sync.error'
      docName:   string
      clientId?: string
      error:     string
    }

export type LiveObserver = (event: LiveEvent) => void

export class LiveObserverRegistry {
  private observers: LiveObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: LiveObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /**
   * Called by producers (today: the WS handler in `index.ts`) at each
   * lifecycle event. Errors thrown by observers are swallowed —
   * observability must never break the sync layer.
   */
  emit(event: LiveEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break sync */ }
    }
  }

  /** @internal — used in tests */
  reset(): void { this.observers = [] }
}

// Process-wide singleton, like commandObservers in @rudderjs/rudder
// and broadcastObservers in @rudderjs/broadcast.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_live_observers__']) {
  _g['__rudderjs_live_observers__'] = new LiveObserverRegistry()
}

export const liveObservers = _g['__rudderjs_live_observers__'] as LiveObserverRegistry
