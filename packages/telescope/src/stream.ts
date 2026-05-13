import type { TelescopeEntry, EntryType } from './types.js'

/**
 * Real-time push channel for the telescope dashboard.
 *
 * Each connected dashboard tab opens an `EventSource` against `<path>/api/stream`
 * and the server pushes entries as they're recorded — no polling, no peer deps.
 *
 * Wire protocol: standard SSE (`text/event-stream`). One `event: entry` frame
 * per recorded entry, with the full `TelescopeEntry` as `data` JSON. A
 * `: keepalive` comment frame fires every 30s to keep proxies (nginx,
 * Cloudflare) from idle-closing the connection.
 *
 * The subscriber registry lives on `globalThis` so it survives Vite SSR's
 * module re-evaluation (same pattern as the recording toggle). Without
 * that, every HMR reload would leak the previous subscriber Set and the
 * new one would start empty.
 */

type Subscriber = {
  write: (entry: TelescopeEntry) => void
  type:  EntryType | null
}

const _g = globalThis as Record<string, unknown>
const _subKey = '__rudderjs_telescope_subscribers__'

function subscribers(): Set<Subscriber> {
  let s = _g[_subKey] as Set<Subscriber> | undefined
  if (!s) {
    s = new Set()
    _g[_subKey] = s
  }
  return s
}

/**
 * Fan-out a recorded entry to every connected dashboard. Called from
 * `Telescope.record()` after the recording-toggle check and before the
 * storage write — dashboard latency tracks the in-process emit, not
 * however long persistence takes.
 *
 * Slow or broken subscribers are silently dropped (the SSE response's
 * `cancel()` handler also unregisters them when the client disconnects).
 */
export function notifySubscribers(entry: TelescopeEntry): void {
  const subs = subscribers()
  for (const sub of subs) {
    if (sub.type && sub.type !== entry.type) continue
    try {
      sub.write(entry)
    } catch {
      subs.delete(sub)
    }
  }
}

/** @internal — used by tests to inspect subscriber count. */
export function subscriberCount(): number {
  return subscribers().size
}

/** @internal — used by tests to reset between cases. */
export function _resetSubscribers(): void {
  subscribers().clear()
}

/**
 * Build the SSE streaming `Response` for `GET <path>/api/stream`. Optionally
 * filter the firehose to a single `EntryType` via `?type=request` — matches
 * the per-page dashboard URL so each list view subscribes only to what it
 * renders.
 */
export function createStreamResponse(typeFilter: EntryType | null): Response {
  const encoder = new TextEncoder()
  let sub:       Subscriber | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sub = {
        type: typeFilter,
        write(entry) {
          // Throws if the controller is closed — caught by notifySubscribers
          // which removes us from the registry.
          controller.enqueue(encoder.encode(`event: entry\ndata: ${JSON.stringify(entry)}\n\n`))
        },
      }
      subscribers().add(sub)

      // Immediate open frame so the client's `onopen` fires without waiting
      // for the first real entry.
      controller.enqueue(encoder.encode(': open\n\n'))

      // Keepalive every 30s — below the common 60s proxy idle timeout, above
      // a wasteful sub-10s cadence. SSE clients silently ignore `:` comments.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          if (heartbeat) clearInterval(heartbeat)
        }
      }, 30_000)
      heartbeat.unref?.()
    },

    cancel() {
      if (sub) subscribers().delete(sub)
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      // Disable nginx proxy buffering — without this, entries pile up
      // server-side until the buffer fills and dashboards look frozen.
      'X-Accel-Buffering': 'no',
    },
  })
}
