import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records the Yjs document lifecycle by subscribing to the
 * `liveObservers` registry exported from `@rudderjs/live`: doc opened/
 * closed, update applied (with byte size + recipient count), awareness
 * changes (sampled), persistence load/save, sync errors.
 *
 * **Awareness throttling.** Yjs awareness fires on every cursor /
 * selection / presence change — high rate. The collector keeps a per-
 * `(docName, clientId)` last-seen-timestamp map and drops awareness
 * events that arrive within `awarenessSampleMs` of the previous one
 * for that key. Default window: 500ms. Set `telescope.liveAwarenessSampleMs`
 * in your config to tune. The map auto-prunes when a `doc.closed`
 * event fires for the same `clientId`.
 *
 * Hooks the abstraction layer (`liveObservers`), not the WebSocket
 * handler internals. Other transports (HTTP long-poll, SSE one-way
 * sync) feeding into the registry would be captured automatically.
 */

interface LiveEvent {
  kind: string
  [key: string]: unknown
}

export class LiveCollector implements Collector {
  readonly name = 'Live Collector'
  readonly type = 'live' as const

  /** `(docName + '\u0000' + clientId)` → last awareness sample timestamp (ms) */
  private awarenessLastSampleAt = new Map<string, number>()

  constructor(
    private readonly storage:           TelescopeStorage,
    private readonly awarenessSampleMs: number = 500,
  ) {}

  async register(): Promise<void> {
    try {
      const { liveObservers } = await import('@rudderjs/live') as {
        liveObservers: { subscribe: (fn: (e: LiveEvent) => void) => void }
      }
      liveObservers.subscribe((event) => this.record(event))
    } catch {
      // @rudderjs/live not installed — skip
    }
  }

  private record(event: LiveEvent): void {
    // Awareness throttling — drop events that arrive within the sample window.
    if (event.kind === 'awareness.changed' && this.awarenessSampleMs > 0) {
      const docName  = String(event['docName'] ?? '')
      const clientId = String(event['clientId'] ?? '')
      const key      = `${docName}\u0000${clientId}`
      const now      = Date.now()
      const last     = this.awarenessLastSampleAt.get(key) ?? 0
      if (now - last < this.awarenessSampleMs) return // dropped
      this.awarenessLastSampleAt.set(key, now)
    }

    // Auto-prune the throttle map when a client disconnects.
    if (event.kind === 'doc.closed') {
      const docName  = String(event['docName'] ?? '')
      const clientId = String(event['clientId'] ?? '')
      this.awarenessLastSampleAt.delete(`${docName}\u0000${clientId}`)
    }

    const tags: string[] = [`kind:${event.kind}`]
    if (event['docName'])  tags.push(`doc:${event['docName']}`)
    if (event.kind === 'sync.error') tags.push('error')

    // Use clientId as batchId for client-scoped events so the existing
    // batch view groups everything one client did during one connection.
    // Server-scoped events (persistence.*) get docName as batchId so all
    // events for one document group together for storage diagnostics.
    const opts: { tags: string[]; batchId?: string } = { tags }
    if (event['clientId']) {
      opts.batchId = String(event['clientId'])
    } else if (event['docName']) {
      opts.batchId = `doc:${event['docName']}`
    }

    const { kind: _kind, ...rest } = event
    this.storage.store(createEntry('live', { kind: event.kind, ...rest }, opts))
  }
}
