# Telescope real-time dashboard updates — SSE stream

> **Status:** drafting 2026-05-13
> **Date:** 2026-05-13
> **Scope:** add an opt-in real-time update channel to the telescope dashboard so the entry list updates the moment a new entry is recorded, replacing fetch-poll. New transport, new endpoint, new config key. No public API breaks; polling stays the default.
>
> **Companion:** sits alongside the cleanup arc (`docs/plans/2026-05-13-telescope-quality-audit.md`) but is independent — different files, different concerns. Cleanup PRs land first or in parallel; nothing in this plan blocks them.

---

## TL;DR

| Decision | Choice | Why |
|---|---|---|
| Transport | **Server-Sent Events (SSE)** | One-directional fits the use case; no peer dep; no upgrade dance; no auth-model collision with broadcast channels. |
| Dependency | **None added** (pure HTTP streaming Response) | Avoids coupling telescope to `@rudderjs/broadcast`'s in-progress abstraction/driver split. Telescope is far more widely installed than broadcast. |
| Default | **`updates: 'polling'`** | Backwards-compatible; no surprise behavior change. Opt-in via config. |
| Emitter location | **`TelescopeRegistry`** (process-global, on `globalThis` like the recording slot) | `TelescopeStorage` stays pure; the notification layer is orthogonal to persistence. |
| Filtering | **Server-side via query param** (`/telescope/api/stream?type=request`) | Less wire traffic than client-filter; dashboard URL already encodes the active type. |
| Estimated diff | ~180 LOC end-to-end, single PR | Backend ~80, frontend ~50, tests ~50. |

**Why not WebSocket / `@rudderjs/broadcast`?**
- Telescope's dashboard is a consumer-only surface. WS gives duplex; SSE gives the half we need.
- Broadcast adds a peer (or hard) dep, drags in an auth model that overlaps `config.telescope.auth`, and is mid-refactor (memory: `broadcast-split-future`). Coupling now creates a future break.
- If a *later* telescope feature needs duplex (e.g., dashboard-triggered job replay), revisit then — the SSE addition does not preclude WS being added beside it.

---

## Pre-flight

```bash
git checkout main && git pull --ff-only
pnpm install
pnpm --filter @rudderjs/telescope typecheck && pnpm --filter @rudderjs/telescope test
```

Baseline must be green. No conflict with the cleanup arc — different files.

---

## Design

### Config shape

`packages/telescope/src/types.ts` adds two keys to `TelescopeConfig`:

```ts
export interface TelescopeConfig {
  // ...existing keys
  /**
   * How the dashboard fetches new entries.
   * - 'polling' (default): client fetches the list endpoint every `pollInterval` ms.
   * - 'stream': client subscribes to a Server-Sent Events stream; the server pushes
   *   new entries as they're recorded. No additional dependency.
   */
  updates?: 'polling' | 'stream'

  /** Polling interval in ms when `updates: 'polling'`. Default 2000. Ignored in stream mode. */
  pollInterval?: number
}
```

`defaultConfig`:
```ts
updates:      'polling',
pollInterval: 2000,
```

No new env var. Apps opt in via `config/telescope.ts`.

### Server architecture

**New file:** `packages/telescope/src/stream.ts` (~80 LOC).

Three responsibilities:

1. **Subscriber registry** — `globalThis['__rudderjs_telescope_subscribers__']: Set<Subscriber>` so subscriptions survive Vite SSR module re-eval (same pattern as the recording toggle).
2. **Emit on store** — wrap `Telescope.record()` so every successful `storage.store()` also calls `notifySubscribers(entry)`. Respects the recording toggle (already checked upstream of `store()`).
3. **SSE endpoint handler** — exported function that returns a streaming `Response` and registers/unregisters a subscriber on the connection.

```ts
// stream.ts (sketch)
type Subscriber = {
  write: (entry: TelescopeEntry) => void
  type: EntryType | null
}

const _g = globalThis as Record<string, unknown>
const _subKey = '__rudderjs_telescope_subscribers__'

function subscribers(): Set<Subscriber> {
  let s = _g[_subKey] as Set<Subscriber> | undefined
  if (!s) { s = new Set(); _g[_subKey] = s }
  return s
}

export function notifySubscribers(entry: TelescopeEntry): void {
  for (const sub of subscribers()) {
    if (sub.type && sub.type !== entry.type) continue
    try { sub.write(entry) } catch { /* drop slow/broken subscriber */ }
  }
}

export function createStreamResponse(typeFilter: EntryType | null): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const sub: Subscriber = {
        type: typeFilter,
        write(entry) {
          const payload = `event: entry\ndata: ${JSON.stringify(entry)}\n\n`
          controller.enqueue(encoder.encode(payload))
        },
      }
      subscribers().add(sub)

      // Heartbeat every 30s to keep proxies/CDNs from idle-closing.
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')) }
        catch { clearInterval(heartbeat); subscribers().delete(sub) }
      }, 30_000)
      heartbeat.unref?.()

      // Initial comment so the connection is established immediately on client side.
      controller.enqueue(encoder.encode(': open\n\n'))

      // No teardown hook on ReadableStream — the cancel() callback below handles it.
      ;(sub as Subscriber & { _heartbeat: NodeJS.Timeout })._heartbeat = heartbeat
    },
    cancel() {
      // Client disconnected. Remove this subscriber.
      // Note: we can't recover the `sub` reference here without closure — store it on the controller stash.
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':    'text/event-stream',
      'Cache-Control':   'no-cache, no-transform',
      'Connection':      'keep-alive',
      'X-Accel-Buffering': 'no',  // disable nginx proxy buffering
    },
  })
}
```

> **Implementation note:** the `cancel()` callback needs access to the `sub` reference + heartbeat timer. Either close over them in the `start()` scope (declare `let sub; let heartbeat;` at the `ReadableStream` factory level) or use a small per-stream object. The sketch above is illustrative; the final shape goes in the PR.

### Wiring into the provider

`packages/telescope/src/index.ts:Telescope.record()` already has the recording gate:

```ts
static record(entry: TelescopeEntry): Promise<void> | void {
  if (!TelescopeRegistry.recording) return
  return this.store().store(entry)
}
```

Change to:
```ts
static record(entry: TelescopeEntry): Promise<void> | void {
  if (!TelescopeRegistry.recording) return
  notifySubscribers(entry)
  return this.store().store(entry)
}
```

Notify *before* store so the dashboard sees the entry even if storage write is slow/queued. The entry object already carries everything subscribers need; no need to await persistence.

### Route registration

`packages/telescope/src/routes.ts:registerTelescopeRoutes()` adds one route, only when `updates: 'stream'`:

```ts
if (resolved.updates === 'stream') {
  router.get(`${apiPrefix}/stream`, (req, res) => {
    const type = (req.query['type'] as EntryType | undefined) ?? null
    return createStreamResponse(type)
  })
}
```

Falls under the existing telescope auth gate (the dashboard route group already enforces `config.telescope.auth`). No additional auth wiring.

### Client architecture

`packages/telescope/src/views/vanilla/EntryList.ts` already does fetch-poll. Switch on the rendered config:

```ts
// Pseudocode for the inline Alpine.js script.
if (config.updates === 'stream') {
  const url = `${apiPrefix}/stream?type=${type}`
  const source = new EventSource(url)
  source.addEventListener('entry', (e) => {
    const entry = JSON.parse(e.data)
    this.entries.unshift(entry)
    if (this.entries.length > this.limit) this.entries.pop()
  })
  source.onerror = () => { /* EventSource auto-reconnects */ }
} else {
  // existing setInterval(fetchEntries, pollInterval) path
}
```

The config object is already serialized into the rendered HTML for the dashboard (it knows `pollInterval`). Add `updates` alongside it.

UI affordance: a tiny "live" / "polling" indicator in the dashboard chrome — green dot when SSE is connected, gray when polling. ~5 LOC of Tailwind. Out of scope as a separate item; just include it in the same diff.

---

## Phases (single PR, three logical commits)

### Phase 1 — Server side: emitter + endpoint + config

**Files touched:**
- `packages/telescope/src/types.ts` — add `updates`, `pollInterval` to `TelescopeConfig` + `defaultConfig`
- `packages/telescope/src/index.ts` — resolve new config keys; wire `notifySubscribers` into `Telescope.record()`
- `packages/telescope/src/stream.ts` — **new file**, subscriber registry + `createStreamResponse()` + `notifySubscribers()`
- `packages/telescope/src/routes.ts` — register `/api/stream` route when `updates === 'stream'`

**Commit:** `feat(telescope): add SSE stream transport for real-time dashboard updates`

**Verify:**
```bash
pnpm --filter @rudderjs/telescope typecheck
pnpm --filter @rudderjs/telescope build
# Manual smoke:
cd playground && pnpm dev
# Set config.telescope.updates = 'stream', hit /telescope/api/stream with curl,
# trigger /test/queries in another tab, see 'event: entry' lines flow.
curl -N http://localhost:3000/telescope/api/stream
```

### Phase 2 — Client side: EventSource + live indicator

**Files touched:**
- `packages/telescope/src/views/vanilla/EntryList.ts` — branch on `config.updates`; add EventSource path; add live indicator
- `packages/telescope/src/views/vanilla/Layout.ts` — pass `updates`/`pollInterval` through to the rendered config object (single line)

**Commit:** `feat(telescope): wire dashboard EntryList to SSE stream when enabled`

**Verify:** browser-side. Open `/telescope/requests`, trigger `/test/queries` in another tab → entry appears without polling delay. Disconnect network → live indicator turns gray; reconnect → indicator returns green automatically (EventSource handles reconnect).

### Phase 3 — Tests + docs

**Files added:**
- `packages/telescope/src/stream.test.ts` — unit tests for `notifySubscribers` (type filter, throwing subscriber doesn't kill others, registry survives module reload)
- `packages/telescope/src/stream.integration.test.ts` — end-to-end via fetch against the registered route: subscribe, emit, parse SSE chunk, assert payload

**Files touched:**
- `packages/telescope/CLAUDE.md` — document the subscriber registry's globalThis slot, heartbeat cadence, and the "notify before store" ordering decision
- `packages/telescope/README.md` — short section: "Real-time updates" with the two-line config example
- `docs/guide/telescope.md` (if it exists) — same config example
- `playground/config/telescope.ts` — flip to `updates: 'stream'` as the demo (or leave as a commented example so smoke tests don't depend on it)

**Commit:** `test(telescope): cover SSE stream emitter + endpoint; document realtime config`

**Verify:**
```bash
pnpm --filter @rudderjs/telescope test
pnpm --filter @rudderjs/telescope lint
pnpm typecheck
```

---

## Edge cases + decisions to lock in

| Case | Decision |
|---|---|
| Recording toggle off | `notifySubscribers` is called *after* the `recording` check in `Telescope.record()`. Off → no notify, matches store behavior. |
| Slow subscriber | `try/catch` per subscriber inside `notifySubscribers`. On throw, silently drop that subscriber (the SSE response will hit `cancel()` and clean itself up). No queueing. |
| Backpressure under load | `controller.enqueue()` can stall a slow consumer; the runtime applies its own backpressure. If this becomes a real problem, add a bounded ring buffer per subscriber in a follow-up. Skip for v1 — telescope is a dev tool, not high-fanout. |
| Type filter mismatch | Server-side filter by `type` query param. Unknown/missing param → unfiltered firehose (the dashboard root `/telescope` uses this; per-type pages append `?type=request` etc). |
| Multiple dashboards | Each `EventSource` connection is its own subscriber. Identical events fan out independently. No deduplication needed — dashboards don't coordinate. |
| Heartbeat | `: keepalive\n\n` every 30s. Standard SSE comment frame; clients ignore comments. Keeps proxies (nginx, Cloudflare) from idle-closing. |
| Auto-reconnect | Built into `EventSource`. No `Last-Event-ID` replay — telescope entries are ephemeral and the dashboard refetches the list on visibility change anyway. Reconnect = resume from "now". |
| HMR / SSR module reload | Subscribers live on `globalThis`. Same pattern as the recording slot. New module evaluations join the same Set. |
| Production deployment behind proxy | `X-Accel-Buffering: no` disables nginx buffering. `Cache-Control: no-cache, no-transform` covers most CDNs. Document these headers in CLAUDE.md so they're not "cleaned up" later. |

---

## What's NOT in this plan

| Item | Why deferred |
|---|---|
| WebSocket / `@rudderjs/broadcast` transport | See TL;DR rationale. Revisit only if a duplex use case appears. |
| `Last-Event-ID` / replay on reconnect | Telescope entries are ephemeral; the dashboard refetches on reconnect via its existing list endpoint. Replay would duplicate that behavior. |
| Bounded per-subscriber ring buffer | Skip for v1. Add only if slow-consumer stalls show up in real use. |
| Compression on the stream | SSE compresses badly because of small frames; the wire savings aren't worth the CPU. Leave uncompressed. |
| Multi-process broadcast (e.g., cluster mode telescope) | Out of scope. The current telescope storage (Memory or SQLite) is already single-process under most deployments. If/when a Redis-backed storage lands, the emitter pattern extends naturally (pub/sub). |
| Authorization at the stream level (per-user filters) | Telescope's existing dashboard auth already gates the endpoint. Per-user filtering is a UI concern, not a transport concern. |
| Adding a "stream" config to per-collector recording | The stream emits whatever gets recorded — config knobs for that are upstream of the transport. |

---

## Wrap-up

After this PR lands:

```bash
pnpm --filter @rudderjs/telescope typecheck
pnpm --filter @rudderjs/telescope test
pnpm --filter @rudderjs/telescope lint
pnpm build
cd playground && pnpm dev
# Flip updates: 'stream' in playground/config/telescope.ts; verify live updates in the dashboard.
```

**Expected line counts:**
- New file: `packages/telescope/src/stream.ts` (~80 LOC)
- New tests: `stream.test.ts` (~30 LOC) + `stream.integration.test.ts` (~30 LOC)
- Touched: `types.ts` (+12), `index.ts` (+4), `routes.ts` (+8), `EntryList.ts` (+25), `Layout.ts` (+2)
- README + CLAUDE.md: ~20 LOC docs

**Public API surface added:**
- `TelescopeConfig.updates`, `TelescopeConfig.pollInterval`
- Route: `GET /<telescope-path>/api/stream?type=<EntryType>`
- (Optional re-export) `notifySubscribers` from `@rudderjs/telescope` — keep internal unless an external use case appears.

**Risk notes:**
- The `cancel()` callback closure shape is the trickiest part — get the subscriber cleanup right or you'll leak references on every dashboard reload. The integration test in Phase 3 must include a "disconnect, then verify subscriber count is 0" assertion.
- Don't await `notifySubscribers` — it's synchronous fan-out; awaiting would couple storage latency to subscriber count.
- Heartbeat interval (30s) is below the common 60s proxy idle timeout. Don't drop it below 10s — wastes bandwidth — and don't raise it above 45s — risk of idle-close on aggressive proxies.

---

## Sequencing relative to the cleanup arc

Independent. Three options, pick based on appetite:

1. **Cleanup first, feature second.** Tidiest. PRs land against a more tested codebase (PR C adds collector tests that incidentally cover the `Telescope.record()` path the emitter hooks into).
2. **Feature first, cleanup second.** Faster user-visible win. The feature touches `index.ts:Telescope.record()` (one line), `types.ts`, `routes.ts`, and adds new files — minimal collision with the cleanup arc's targets.
3. **Parallel branches.** Feature touches `index.ts`, `types.ts`, `routes.ts`, `EntryList.ts`. Cleanup PR A touches `index.ts` (JSDoc), `routes.ts` (JSDoc), `EntryList.ts` (JSDoc), `storage.ts`, `collectors/request.ts`, `views.ts`. The overlapping files (`index.ts`, `routes.ts`, `EntryList.ts`) get JSDoc-only edits from cleanup — trivial merge.

Default recommendation: **#2** (feature first). The cleanup arc waits well, and shipping a real-time dashboard is the kind of demo-able win that sets the tone for the next round.
