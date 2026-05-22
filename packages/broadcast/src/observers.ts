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
      /** Error thrown by the auth callback (when reason === 'Auth callback threw') */
      error?:       unknown
    }
  | {
      /**
       * Emitted when an HTTP upgrade is rejected before the WebSocket
       * handshake completes — origin allowlist mismatch, per-IP cap hit,
       * per-connection auth callback returning false, or the underlying
       * socket being torn down externally (proxy timeout, tab close)
       * during the auth promise's await.
       */
      kind:   'upgrade.rejected'
      url:    string
      reason: 'origin' | 'ip-cap' | 'connection-auth' | 'socket-closed-during-auth'
      origin?: string
      ip?:    string
    }
  | {
      /**
       * Emitted when the per-socket message-handling queue catches an
       * unhandled error from a frame handler. Safety net — not part of
       * the normal auth/subscribe lifecycle which has its own events.
       */
      kind:         'message.error'
      connectionId: string
      error:        unknown
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

  /**
   * Subscribe to broadcast lifecycle events. Returns an unsubscribe function.
   *
   * **Error contract.** Exceptions thrown from `fn` are swallowed by
   * `emit()` (see below). Subscribers MUST NOT rely on exceptions
   * propagating — if your observer needs to signal failure, route it
   * through your own error channel (logger, telemetry, etc.). The swallow
   * is intentional: a buggy observer cannot break the WebSocket layer.
   */
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

// Process-wide singleton, like `commandObservers` in `@rudderjs/console`.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_broadcast_observers__']) {
  _g['__rudderjs_broadcast_observers__'] = new BroadcastObserverRegistry()
}

export const broadcastObservers = _g['__rudderjs_broadcast_observers__'] as BroadcastObserverRegistry
