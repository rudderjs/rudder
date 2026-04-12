import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records the full WebSocket lifecycle by subscribing to the
 * `broadcastObservers` registry exported from `@rudderjs/broadcast`:
 * connection open/close, channel subscribe/unsubscribe, presence
 * join/leave, server-and-client-initiated broadcasts, and auth failures.
 *
 * Each lifecycle event becomes a `broadcast` entry in telescope. The
 * UI groups entries by `connectionId` (similar to how request entries
 * group by `batchId`) so you can replay the full life of one socket.
 *
 * Hooks the abstraction layer (`broadcastObservers`), NOT the underlying
 * WebSocket server impl (`ws-server.ts`). When `@rudderjs/reverb` is
 * eventually extracted as a separate driver package, the registry moves
 * with it and this collector keeps working unchanged. See memory
 * `feedback_broadcast_split_future.md` for the abstraction-vs-driver
 * design rationale.
 */

interface BroadcastEvent {
  kind: string
  [key: string]: unknown
}

export class BroadcastCollector implements Collector {
  readonly name = 'Broadcast Collector'
  readonly type = 'broadcast' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { broadcastObservers } = await import('@rudderjs/broadcast') as {
        broadcastObservers: { subscribe: (fn: (e: BroadcastEvent) => void) => void }
      }
      broadcastObservers.subscribe((event) => this.record(event))
    } catch {
      // @rudderjs/broadcast not installed — skip
    }
  }

  private record(event: BroadcastEvent): void {
    const tags: string[] = [`kind:${event.kind}`]

    // Subscribe events get extra status tags so the dashboard can
    // distinguish allowed/denied at a glance.
    if (event.kind === 'subscribe') {
      tags.push(event['allowed'] ? 'allowed' : 'denied')
      if (event['channelType']) tags.push(`channel:${event['channelType']}`)
    }
    if (event.kind === 'broadcast' && event['source']) {
      tags.push(`source:${event['source']}`)
    }
    if (event.kind === 'connection.opened' || event.kind === 'connection.closed') {
      tags.push(event.kind === 'connection.opened' ? 'opened' : 'closed')
    }

    // Use connectionId as the batchId so the existing batch grouping UI
    // (Phase 2b) works for WebSocket connections too — clicking through
    // a connection.opened entry shows every event from that socket.
    const opts: { tags: string[]; batchId?: string } = { tags }
    const connectionId = event['connectionId'] as string | undefined
    if (connectionId) opts.batchId = connectionId

    // Strip the kind from content (it's already in the entry-type metadata)
    // but keep everything else verbatim.
    const { kind: _kind, ...content } = event
    this.storage.store(createEntry('broadcast', { kind: event.kind, ...content }, opts))
  }
}
