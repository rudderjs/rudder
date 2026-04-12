/**
 * Broadcast event observers — process-wide pub/sub for the WebSocket
 * lifecycle. Any package can subscribe to be notified about connections,
 * subscriptions, presence changes, broadcast emits, and auth failures.
 *
 * Used today by `@rudderjs/telescope`'s BroadcastCollector to record
 * the full WebSocket lifecycle into the dashboard. The contract is
 * defined here (not inside `ws-server.ts`) so that when the abstraction
 * is eventually extracted into its own driver-agnostic package (see
 * memory `feedback_broadcast_split_future.md`), the registry stays with
 * the abstraction and any new driver — Pusher, Ably, SSE fallback — can
 * feed into the same observer contract without changing consumers.
 *
 * The current `ws-server.ts` is one producer feeding events into this
 * registry; the registry itself is driver-agnostic.
 */

/** Discriminated union of every event the broadcast layer can emit. */
export type BroadcastEvent =
  | {
      kind:         'connection.opened'
      connectionId: string
      ip?:          string
      userAgent?:   string
      url:          string
    }
  | {
      kind:         'connection.closed'
      connectionId: string
      reason?:      string
    }
  | {
      kind:         'subscribe'
      connectionId: string
      channel:      string
      channelType:  'public' | 'private' | 'presence'
      allowed:      boolean
      /** Auth check duration in ms (only for private/presence channels) */
      authMs?:      number
      /** Reason if `allowed === false` */
      reason?:      string
    }
  | {
      kind:         'unsubscribe'
      connectionId: string
      channel:      string
    }
  | {
      kind:           'broadcast'
      channel:        string
      event:          string
      /** Number of subscribers the message was sent to */
      recipientCount: number
      /** Approximate JSON byte size of the payload */
      payloadSize:    number
      /** Was this a server-initiated broadcast (`broadcast()` fn) or a client-event from a connected client? */
      source:         'server' | 'client'
      /** Originating connection id when `source === 'client'` */
      sourceConnectionId?: string
    }
  | {
      kind:         'presence.join'
      connectionId: string
      channel:      string
      member:       Record<string, unknown>
    }
  | {
      kind:         'presence.leave'
      connectionId: string
      channel:      string
      member:       Record<string, unknown>
    }

export type BroadcastObserver = (event: BroadcastEvent) => void

export class BroadcastObserverRegistry {
  private observers: BroadcastObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: BroadcastObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /**
   * Called by producers (today: `ws-server.ts`) at each lifecycle event.
   * Errors thrown by observers are swallowed — observability must never
   * break the broadcast layer itself.
   */
  emit(event: BroadcastEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break broadcasts */ }
    }
  }

  /** @internal — used in tests */
  reset(): void { this.observers = [] }
}

// Process-wide singleton, like `commandObservers` in `@rudderjs/rudder`.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_broadcast_observers__']) {
  _g['__rudderjs_broadcast_observers__'] = new BroadcastObserverRegistry()
}

export const broadcastObservers = _g['__rudderjs_broadcast_observers__'] as BroadcastObserverRegistry
