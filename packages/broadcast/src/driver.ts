/**
 * Per-message metadata that flows alongside `publish` → `subscribe`.
 *
 * Drivers that span multiple instances (Redis, etc.) MUST scope
 * `excludeConnectionId` to the originating instance: a connection id
 * is only meaningful on the instance that minted it, so messages
 * delivered to OTHER instances must drop the exclude hint before
 * surfacing to subscribers.
 */
export interface BroadcastMeta {
  /**
   * Local connection id to exclude from fan-out — used to prevent the
   * `client-event` echo where a sending socket receives its own message
   * back from the local subscriber loop.
   */
  excludeConnectionId?: string
}

/**
 * Cross-instance pub/sub abstraction for broadcast messages.
 *
 * The local WebSocket server is one *consumer* of driver events: it
 * subscribes via `subscribe()` at boot and fans events out to its local
 * sockets. Server code calling `broadcast(channel, event, data)` publishes
 * via `driver.publish(...)`; a multi-instance driver (e.g. Redis pub/sub)
 * fans the message to every instance, each of which receives it via its
 * own `subscribe()` handler and broadcasts to its local sockets.
 *
 * Single-instance deployments use the default {@link LocalDriver} which
 * routes straight through an in-process array — zero hop, identical to
 * the legacy single-process broadcast path.
 */
export interface BroadcastDriver {
  /**
   * Publish a message. Resolves once the message has been accepted by
   * the underlying transport. Implementations MUST NOT throw on transport
   * failure — log via the observer registry and resolve — so callers of
   * `broadcast()` don't have to wrap every call in try/catch.
   */
  publish(
    channel: string,
    event:   string,
    data:    unknown,
    meta?:   BroadcastMeta,
  ): Promise<void>

  /**
   * Subscribe to every published message across the cluster. The handler
   * is invoked for messages published by ANY instance — including this
   * one — so that local fan-out reads from a single stream regardless of
   * origin. Returns an unsubscribe function.
   *
   * The `meta.excludeConnectionId` hint is honoured only when the message
   * originated on this instance; multi-instance drivers MUST drop it on
   * incoming foreign-origin deliveries.
   */
  subscribe(
    handler: (channel: string, event: string, data: unknown, meta?: BroadcastMeta) => void,
  ): () => void

  /** Tear down the driver (close connections, etc.). Optional. */
  close?(): Promise<void> | void
}

/**
 * In-process broadcast driver — current single-instance behaviour.
 * Synchronous fan-out on the same tick as `publish()`; handler errors
 * are swallowed so a buggy subscriber cannot break the broadcast layer.
 */
export class LocalDriver implements BroadcastDriver {
  private handlers: Array<
    (c: string, e: string, d: unknown, m?: BroadcastMeta) => void
  > = []

  publish(channel: string, event: string, data: unknown, meta?: BroadcastMeta): Promise<void> {
    for (const h of this.handlers) {
      try { h(channel, event, data, meta) } catch { /* observer errors must not break broadcasts */ }
    }
    return Promise.resolve()
  }

  subscribe(
    handler: (c: string, e: string, d: unknown, m?: BroadcastMeta) => void,
  ): () => void {
    this.handlers.push(handler)
    return () => { this.handlers = this.handlers.filter((h) => h !== handler) }
  }
}
