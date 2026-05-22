# Framework eventing & realtime fixes

**Status:** OPEN 2026-05-22
**Scope:** `@rudderjs/queue` + `@rudderjs/queue-bullmq` + `@rudderjs/queue-inngest` + `@rudderjs/broadcast` + `@rudderjs/sync`
**Source:** Senior-engineer code review pass, 2026-05-22 (continuation of the 2026-05-21 batch — AI/Security/ORM/Pipeline all closed in 15 PRs #579/#582/#584-#597)
**Severity:** 34 findings — 9 P0, 15 P1, 10 P2. Phases 1-8 cover the P0/P1 set; P2 grab-bag at the bottom under **Notable**.

Eventing + realtime is the framework's biggest area of correctness exposure that hasn't been reviewed: queue drivers carry job execution across process boundaries; broadcast is a security surface (cookie-auth'd WS channels); sync persists CRDT state under multi-peer concurrency. The patterns from the 2026-05-21 batch — read-modify-write races, cross-adapter divergence, silent error swallows, lifecycle leaks under HMR — all recur here.

---

## Phase 1 — Queue: drivers must enforce middleware + uniqueness + `failed()`

**Severity:** P0 — `RateLimited`, `WithoutOverlapping`, `ThrottlesExceptions`, `Skip`, `ShouldBeUnique`, `ShouldBeUniqueUntilProcessing` are inert today on BullMQ + Inngest + Sync. Inngest never calls `instance.failed?.()`.
**Effort:** ~3h + tests
**Bumps:** `@rudderjs/queue` minor, `@rudderjs/queue-bullmq` minor, `@rudderjs/queue-inngest` minor

### The bug

`packages/queue/src/index.ts` exports `runJobMiddleware`, `acquireUniqueLock`, `releaseUniqueLock`. Neither shipped driver invokes them:

- `packages/queue-bullmq/src/index.ts:97-144` — processor calls `instance.handle()` directly
- `packages/queue-inngest/src/index.ts:57-67` — function calls `instance.handle()` directly; also never calls `instance.failed?.(error)`
- `packages/queue/src/index.ts:201-260` (SyncAdapter) — also bypasses both

Users who ship `middleware() { return [new RateLimited('stripe-api', 30)] }` get zero rate-limiting in prod; users with `implements ShouldBeUnique` dispatch duplicates on every concurrent call.

Separately, `acquireUniqueLock` itself races (next phase).

### Fix

Centralize job execution in `@rudderjs/queue` so every driver routes through the same path. Add:

```ts
// packages/queue/src/execute.ts (new)
export async function executeJob<T extends Job>(
  JobCls: typeof Job,
  payload: Record<string, unknown>,
  ctx: { __context?: Record<string, unknown> } = {},
): Promise<void> {
  const instance = Object.assign(new (JobCls as any)(), payload) as T

  const release = await runUniqueAcquire(instance)
  try {
    await runWithContext(ctx.__context ?? {}, async () => {
      await runJobMiddleware(instance, instance.middleware?.() ?? [], async () => {
        try {
          await instance.handle()
        } catch (err) {
          try { await instance.failed?.(err as Error) } catch (hookErr) {
            console.error('[RudderJS Queue] failed() hook threw', hookErr)
          }
          throw err
        }
      })
    })
  } finally {
    await release?.()
  }
}
```

Each driver collapses to:

```ts
// queue-bullmq/src/index.ts processor
await executeJob(JobCls, bullJob.data, { __context: bullJob.data.__context })

// queue-inngest/src/index.ts function body
await executeJob(JobCls, event.data, { __context: event.data.__context })

// queue/src/index.ts SyncAdapter
await executeJob(JobCls, safePayload(job), {})
```

Pull `runUniqueAcquire` from Phase 3 (atomic `cache.add`). Pull `__context` plumbing from Phase 4.

### Regression test

`packages/queue-bullmq/src/index.test.ts` (and mirror in `queue-inngest`):

```ts
it('executes job middleware on the driver path', async () => {
  let middlewareRan = false
  class M { handle(_j: Job, next: () => Promise<void>) { middlewareRan = true; return next() } }
  class Foo extends Job { middleware() { return [new M()] }  async handle() {} }
  Queue.register({ Foo })
  await Foo.dispatch()
  await waitForCompletion()
  assert.equal(middlewareRan, true)
})

it('calls failed() hook on terminal failure (inngest)', async () => {
  let failedWith: Error | undefined
  class Bar extends Job { async handle() { throw new Error('boom') }
                          async failed(e: Error) { failedWith = e } }
  // ... dispatch + drain
  assert.equal(failedWith?.message, 'boom')
})
```

---

## Phase 2 — Queue: closure / chain / batch must declare driver capability

**Severity:** P0 — `dispatch(fn)`, `Chain.of(...)`, and `Bus.batch()` default runner all silently no-op or dispatch empty payloads on async drivers; users see "it works locally" + "nothing runs in prod".
**Effort:** ~2h + tests
**Bumps:** `@rudderjs/queue` minor (clear runtime throws; capability flags additive)

### The bug

Three features assume the adapter runs jobs in-process:

- `packages/queue/src/closure.ts:20-32` — `dispatch(fn)` enqueues `{ handle: fn }` straight into `adapter.dispatch`; functions stringify to `undefined` under `JSON.stringify` (used by `safePayload` in every async driver). The worker receives empty `data` + `constructor.name === 'Object'` → no handler is found, no error, no log.
- `packages/queue/src/chain.ts:86-105` — chain runner closes over the `Job[]` array; same serialization failure mode.
- `packages/queue/src/batch.ts:100-187` (`_runBatchDefault`) — comment on line 178 admits the runner only tracks per-job success/failure at *dispatch* time, not execution time, on async drivers. Batch trackers (`.then`/`progress`) fire the instant all jobs are enqueued.

Plus a separate batch bug: `catchFn` is called inside each per-job wrapper's catch (line 166), so a 3-failure batch fires `catch` three times. Laravel semantics: once.

### Fix

Capability flags on the adapter contract:

```ts
// packages/contracts/src/queue.ts
export interface QueueAdapter {
  // existing surface
  supportsClosures?: boolean    // dispatch(fn)
  supportsBatch?: boolean       // batch as a driver-native operation
  supportsChain?: boolean       // chain as a driver-native operation
  dispatchBatch?(jobs: Job[], opts: BatchOptions): Promise<BatchHandle>
  dispatchChain?(jobs: Job[], opts: ChainOptions): Promise<ChainHandle>
}
```

`SyncAdapter` sets all three to `true`. `BullMQAdapter` + `InngestAdapter` set `false` (each can opt in later when they implement native batch/chain).

In `dispatch(fn)` / `Chain.of(...)` / `Bus.batch()`, gate up front:

```ts
if (!adapter.supportsClosures) {
  throw new Error(
    `[RudderJS Queue] Closure dispatch is not supported by the "${adapter.name}" driver. ` +
    `Either switch to the sync driver for this code path or dispatch a concrete Job class.`
  )
}
```

Move the `catchFn` call out of the per-job wrapper into the post-`allSettled` block, gated by `if (batch.failedJobs > 0 && catchFn) await catchFn(firstError, batch)`.

### Regression test

`packages/queue/src/closure.test.ts`:

```ts
it('throws clearly on async drivers', async () => {
  Queue.use(new FakeAsyncAdapter()) // supportsClosures: false
  await assert.rejects(
    async () => dispatch(() => 1),
    /Closure dispatch is not supported.*sync/,
  )
})
```

`packages/queue/src/batch.test.ts`:

```ts
it('catch fires once even with multiple failures', async () => {
  const calls: Error[] = []
  await Bus.batch([failJob, failJob, failJob])
    .catch((err) => calls.push(err))
    .dispatch()
  assert.equal(calls.length, 1)
})
```

---

## Phase 3 — Queue: atomic unique-lock + typed payload serialization

**Severity:** P0 (unique lock) + P1 (serialization). Duplicate jobs under concurrent dispatch. Date/BigInt/Buffer/Map/Set/undefined silently mangled or dropped on every driver.
**Effort:** ~3h + tests
**Bumps:** `@rudderjs/queue` minor (`cache.add` requirement codified; serializer is opt-out via config), `@rudderjs/queue-bullmq` + `@rudderjs/queue-inngest` patch

### The bug

**3a — unique-lock race.** `packages/queue/src/unique.ts:63-82`:

```ts
const existing = await cache.get(key)
if (existing) return false
await cache.set(key, '1', ttl)
return true
```

Two concurrent dispatchers both read `null`, both write — both think they acquired. The exact failure mode `@rudderjs/cache`'s `add()` (SETNX semantics, atomic on Redis) was built to prevent — added in PR #585 for RateLimit per `feedback_atomic_claim_pattern`. Same pattern, not yet propagated here.

**3b — payload serialization.** Three call sites use `JSON.parse(JSON.stringify(job))`:
- `packages/queue/src/index.ts:201-207` (`safePayload`, Sync) — and on failure returns `{}`, hiding the bug from observers
- `packages/queue-bullmq/src/index.ts:152-160`
- `packages/queue-inngest/src/index.ts:83-91`

`Date` round-trips as ISO string (handler sees a `string`, not a `Date`); `BigInt` throws; `Map`/`Set` → `{}`; `undefined` keys dropped; circular refs throw → Sync silently returns `{}` (mask), drivers crash.

### Fix

**3a — `acquireUniqueLock` uses `cache.add()`:**

```ts
export async function acquireUniqueLock(/* ... */): Promise<boolean> {
  const cache = app().make('cache') as CacheAdapter
  return await cache.add(key, '1', ttl > 0 ? ttl : 86400)
}
```

`@rudderjs/cache` already exposes `add(key, value, ttl): Promise<boolean>` (Redis: `SET NX EX`, in-memory: synchronous check-and-set). No new contract surface needed.

**3b — centralized typed serializer:**

```ts
// packages/queue/src/serialize.ts (new)
export function encodePayload(value: unknown): unknown { /* tagged Date/BigInt/Buffer/Map/Set */ }
export function decodePayload(value: unknown): unknown { /* untag back */ }
```

Tag shape: `{ __rudderjs_tag: 'date', value: '...' }` / `'bigint'` / `'buffer'` / `'map'` / `'set'`. Drivers call `encodePayload(safePayload(job))` on dispatch and `decodePayload(...)` before `Object.assign`. `safePayload`'s `try/catch { return {} }` becomes `throw` — silent corruption is worse than the bug.

**3c — drop ESM `require()` in `Queue.fake()`** (`packages/queue/src/index.ts:384-388`): static import `FakeQueueAdapter` at top of file. The `eslint-disable` comment is masking a landmine in pure-ESM bundles per [[esm-only-peer-require-bug]].

### Regression test

```ts
it('two concurrent dispatchers see exactly one acquired lock', async () => {
  const [a, b] = await Promise.all([acquireUniqueLock('k', 60), acquireUniqueLock('k', 60)])
  assert.equal([a, b].filter(Boolean).length, 1)
})

it('round-trips Date / BigInt / Buffer through the queue serializer', async () => {
  const job = { d: new Date('2026-01-01'), n: 42n, b: Buffer.from('hi') }
  const encoded = encodePayload(job)
  const wire = JSON.parse(JSON.stringify(encoded))
  const decoded = decodePayload(wire) as typeof job
  assert.ok(decoded.d instanceof Date)
  assert.equal(decoded.n, 42n)
  assert.ok(Buffer.isBuffer(decoded.b))
})
```

---

## Phase 4 — Queue: Inngest context propagation + BullMQ lifecycle hygiene

**Severity:** P0 (Inngest drops `__context` → wrong-tenant DB writes) + P1 (BullMQ worker shutdown leaks + unhandled rejections in `failed` event handler + per-boot CLI command leak)
**Effort:** ~3h + tests
**Bumps:** `@rudderjs/queue-inngest` minor, `@rudderjs/queue-bullmq` patch, `@rudderjs/queue` patch

### The bug

**4a — Inngest drops `__context`.** `packages/queue-inngest/src/index.ts:80-102` builds `event.data` without `__context`. BullMQ embeds it correctly and rehydrates via `runWithContext`. Apps using `@rudderjs/context` (tenant/user/locale ALS) that switch driver from BullMQ → Inngest silently lose context on every job → wrong-tenant DB writes. No type-system signal.

**4b — Inngest `retries` clamp.** `packages/queue-inngest/src/index.ts:54` casts `as 0|1|...|20`. Any value outside the literal range is accepted by TS, rejected at runtime by Inngest's validator with a confusing error. `Cls.retries = 25` boots fine, crashes at first dispatch.

**4c — Inngest never calls `instance.failed?.(error)`.** No `onFailure` config; the hook is silently inert.

**4d — BullMQ shutdown.** `packages/queue-bullmq/src/index.ts:269-276, 314-318`:
- `process.once('SIGTERM' / 'SIGINT')` registered every `work()` call — never removed; multi-tenant boot or test re-runs accumulate handlers.
- Shutdown awaits queues but not workers — workers keep polling BRPOP through the SIGTERM grace period; k8s rolling restart pods outlive their window.
- `void Promise.all(...).then(resolve)` swallows worker-close rejections; resolve still runs; Node logs unhandled rejection.

**4e — BullMQ `failed` event handler** (`packages/queue-bullmq/src/index.ts:237-264`): the event listener is `async (...) => { ... await instance.failed?.(error) ... }` returning an unawaited promise to EventEmitter. If `failed()` throws (Slack 5xx, DB outage), unhandled rejection crashes the worker under Node 20+ default flags.

**4f — Provider boot CLI registration.** `packages/queue/src/index.ts:285-377` calls `rudder.command(...)` five times per `boot()`. Under Vite SSR re-eval (documented `bootstrap/` / `app/` reload path), each boot re-registers commands against the global `rudder` singleton; closures capture stale `adapter` references. Per [[feedback_rudder_globals]] and [[reference_observer_registry_pattern]] the commands should look up the current adapter at invocation time via `QueueRegistry.get()`, not close over `adapter` at boot.

### Fix

**4a + 4c:** Inngest payload includes `__context`; function body calls `executeJob(JobCls, event.data, { __context: event.data.__context })` (from Phase 1) which wires both context hydration and `failed()` via the shared helper. No driver-specific glue.

**4b:** Validate + clamp at registration:

```ts
const r = Number((Cls as any).retries ?? 3)
if (!Number.isInteger(r) || r < 0 || r > 20) {
  console.warn(`[RudderJS Queue/Inngest] retries=${r} clamped to [0,20] for ${Cls.name}`)
}
const retries = Math.max(0, Math.min(20, Math.floor(r))) as 0|1|/*…*/|20
```

**4d:** Track workers on the adapter instance. `disconnect()` becomes:

```ts
async disconnect() {
  for (const sig of ['SIGTERM','SIGINT']) process.off(sig, this._shutdown)
  const workerResults = await Promise.allSettled(this._workers.map(w => w.close()))
  workerResults.filter(r => r.status === 'rejected')
    .forEach(r => console.error('[RudderJS Queue/BullMQ] worker close failed', (r as any).reason))
  await Promise.allSettled([...this._queues.values()].map(q => q.close()))
  this._workers.length = 0
  this._queues.clear()
}
```

**4e:** Wrap the listener body in try/catch identical to SyncAdapter's pattern (`packages/queue/src/index.ts:241-248`).

**4f:** Commands close over `() => QueueRegistry.get(name)` (lazy) instead of `const adapter = ...` (eager).

### Regression test

```ts
it('inngest payload round-trips __context through executeJob', async () => {
  await runWithContext({ tenantId: 't-1' }, () => InvoiceJob.dispatch())
  const events = fakeInngest.captured
  assert.equal(events[0].data.__context.tenantId, 't-1')
  // and on receive:
  const sawTenant = await runHandler(events[0])
  assert.equal(sawTenant, 't-1')
})

it('bullmq disconnect awaits worker close before resolving', async () => {
  const adapter = new BullMQAdapter({ url: redisUrl })
  adapter.work({ /* a slow processor */ })
  const closed = adapter.disconnect()
  assert.equal(adapter._workers[0]?.isRunning(), true) // before disconnect resolves
  await closed
  assert.equal(adapter._workers.length, 0)
})
```

---

## Phase 5 — Broadcast: WS auth, origin allowlist, per-socket serialization

**Severity:** P0 — `evil.com` can open a WS to `wss://app.com/ws`, ride the user's cookie, subscribe to private channels, and receive every server `broadcast()` for that user. Per-message handler parallelism leaves a defensible-but-fragile auth race.
**Effort:** ~3h + tests
**Bumps:** `@rudderjs/broadcast` minor

### The bug

**5a — No Origin check on upgrade.** `packages/broadcast/src/ws-server.ts:369-383` accepts every upgrade for `wsPath`. Cookie-auth'd channels (`Broadcast.channel('private-user.*', async (req) => req.user?.id === ...)`) trust the session cookie that the browser sends regardless of which origin opened the socket. Textbook CSRF-style cross-origin attack.

**5b — Unauthorized upgrades aren't rejected at all.** `onConnection` (`packages/broadcast/src/ws-server.ts:140-173`) accepts every connection unconditionally. App can't reject by IP, ban-list, missing session, etc. 10k WS connects with no subscribe → FD exhaustion. No heartbeat → dead TCP connections linger.

**5c — Per-message handler parallelism.** `ws.on('message', ...)` schedules `void onMessage(...)` (`ws-server.ts:159-170`) — frames run concurrently. While a `subscribe` auth callback is pending, other code paths can deliver messages to a socket not yet authorized. The post-auth `state.channels.get(channel)?.add(id)` saves most cases, but the surface is one careless refactor from leaking. Also: `client-event` runs concurrently with the same socket's `subscribe`, and `authFn` throwing is logged via `console.error` but not emitted as an observer `allowed:false` event — telescope sees a silent gap.

### Fix

**5a — Origin allowlist:**

```ts
// config/broadcast.ts
export default {
  allowedOrigins: env('BROADCAST_ALLOWED_ORIGINS', '').split(',').filter(Boolean),
  trustProxy: env.boolean('TRUST_PROXY', false),
}
```

```ts
// ws-server.ts upgrade handler
if (config.allowedOrigins?.length) {
  const origin = req.headers.origin
  if (!origin || !config.allowedOrigins.includes(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return
  }
}
```

Default behaviour when `allowedOrigins` is empty: log a one-time `console.warn('[RudderJS Broadcast] No allowedOrigins configured — cross-origin WS connections will be accepted.')` so deployments aren't silently insecure.

**5b — Connection auth hook + heartbeat:**

```ts
Broadcast.authConnection(async (req) => {
  return !!req.cookies?.sessionId   // or whatever the app wants
})
```

Invoked in upgrade handler before `wss.handleUpgrade`; returning `false` writes a 401 and destroys. Heartbeat: on `connection`, schedule `setInterval(ping, 30_000)` + a 60s `pong` deadline; close on miss. Optional `broadcast.maxConnectionsPerIp` config.

**5c — Per-socket message serialization:**

```ts
const socketQueues = new WeakMap<WebSocket, Promise<void>>()
ws.on('message', (raw) => {
  const prev = socketQueues.get(ws) ?? Promise.resolve()
  const next = prev.then(() => onMessage(ws, raw))
                   .catch(err => { broadcastObservers.emit({ kind: 'error', error: err, socketId: id }) })
  socketQueues.set(ws, next)
})
```

Closes the auth race window. `client-event` can no longer interleave with the same socket's `subscribe`.

Plus in the `authFn` catch, emit `{ kind: 'subscribe', allowed: false, reason: 'Auth callback threw', error: err }` so telescope sees the failure.

### Regression test

```ts
it('rejects upgrade from disallowed origin', async () => {
  config.allowedOrigins = ['https://app.com']
  const res = await fetch('ws://localhost:3000/ws', {
    headers: { upgrade: 'websocket', origin: 'https://evil.com', /* … */ },
  })
  assert.equal(res.status, 403)
})

it('client-event from socket A cannot interleave with A subscribe auth', async () => {
  // slow auth callback
  Broadcast.channel('private-x', async () => { await sleep(50); return true })
  const ws = openSocket()
  ws.send({ type: 'subscribe', channel: 'private-x' })
  ws.send({ type: 'client-event', channel: 'private-x', event: 'evil' })
  const seen = await waitForBroadcasts()
  assert.equal(seen.filter(s => s.event === 'evil').length, 0)
})
```

---

## Phase 6 — Broadcast: multi-instance driver interface

**Severity:** P1 — any 2+ process deployment silently drops half its broadcast messages (single-process Map walk only). Laravel ships Redis/Pusher drivers; we ship one.
**Effort:** ~4h + tests + a separate `@rudderjs/broadcast-redis` package scaffold
**Bumps:** `@rudderjs/broadcast` minor (driver interface additive; LocalDriver default preserves current behavior); new `@rudderjs/broadcast-redis@1.0.0`

### The bug

`packages/broadcast/src/ws-server.ts:344-354` — `broadcast()` walks `state.channels.get(channel)` (local sockets only). README/scaffolder advertise "Laravel-Broadcast parity" but there is no driver abstraction. App scales to 2 instances → user A on instance 1 subscribes, user B publishes via HTTP that hits instance 2, `broadcast()` runs on instance 2 with zero local subscribers, message dropped. Looks like the framework lost the event.

Plus a separate HMR bug: `provider.ts` stores the upgrade handler under `globalThis[UPGRADE_KEY]` but `@rudderjs/vite`/`server-hono` cache the function reference at attach time. After HMR, stale handler still attached to `http.Server`; first one wins, sockets may land on disposed `wss` state.

### Fix

**6a — Driver interface:**

```ts
// packages/broadcast/src/driver.ts (new)
export interface BroadcastDriver {
  publish(channel: string, payload: unknown): Promise<void>
  subscribe(handler: (channel: string, payload: unknown) => void): () => void
}

export class LocalDriver implements BroadcastDriver { /* current behaviour */ }
```

`broadcast()` becomes `driver.publish(...)`; the wss subscribes to `driver` events and fans out locally. Config:

```ts
// config/broadcast.ts
import { LocalDriver } from '@rudderjs/broadcast'

export default {
  driver: () => new LocalDriver(),  // or `new RedisDriver({ url: env('REDIS_URL') })`
}
```

`@rudderjs/broadcast-redis` (new package, 1.0.0 per [[feedback_new_packages_at_1_0]]): wraps `ioredis` pub/sub. Optional peer.

**6b — Lazy upgrade-handler accessor.** The upgrade handler attached to `http.Server` becomes a thin trampoline that reads `globalThis[UPGRADE_KEY]` per upgrade event:

```ts
// at attach time (once)
server.on('upgrade', (req, socket, head) => {
  const current = (globalThis as any)[UPGRADE_KEY]
  if (typeof current === 'function') current(req, socket, head)
})
```

Provider boot writes the current closure to `globalThis[UPGRADE_KEY]` on every boot; HMR re-eval safely replaces the closure without re-attaching.

### Regression test

```ts
it('broadcast() reaches subscribers on a different driver instance', async () => {
  const drv = new TestDriver() // shared in-memory pub/sub
  const a = setupBroadcast({ driver: () => drv })
  const b = setupBroadcast({ driver: () => drv })
  const seen: unknown[] = []
  a.subscribe('public-test', payload => seen.push(payload))
  await b.broadcast('public-test', 'hi', { foo: 1 })
  await tick()
  assert.equal(seen.length, 1)
})

it('HMR re-boot replaces upgrade handler without re-attaching to http.Server', async () => {
  const initialListeners = server.listeners('upgrade').length
  await rebootBroadcastProvider()
  assert.equal(server.listeners('upgrade').length, initialListeners)
})
```

---

## Phase 7 — Sync: persistence error paths + seed atomicity + AI clock global

**Severity:** P0 (Sync.seed race, AI awareness clock reset) + P1 (persistence error swallow, stale room cache)
**Effort:** ~3h + tests
**Bumps:** `@rudderjs/sync` patch

### The bug

**7a — `Sync.seed()` empty-doc gate.** `packages/sync/src/index.ts:849-863` gates on `Y.encodeStateVector(room.doc).length > 1`. State vector becomes `> 1 byte` as soon as any client ever connected — so a doc that was joined but never edited treats subsequent `seed()` as "already seeded" and silently no-ops. Conversely, two concurrent `seed()` callers both pass the gate (no transaction-time recheck) and double-write.

**7b — AI awareness clock.** `packages/sync/src/lexical/awareness.ts:127-130` increments a module-level `aiAwarenessClock`. Vite SSR re-eval / HMR / process restart resets it to 0; y-protocols filters older clocks → peers stop seeing AI cursors silently.

**7c — `persistence.storeUpdate` and `onChange` swallow errors.** `packages/sync/src/index.ts:551-578` (WS message handler) applies the Yjs update first, then broadcasts to peers, then `await persistence.storeUpdate(...)`. If `storeUpdate` rejects (DB blip), the update is already in-memory + propagated to peers, but the rejection is swallowed in the `await` with no log, no `sync.error` event. `onChange?.()` is called with optional-chain, returned promise dropped → unhandled rejection in dev, silent in prod.

**7d — Stale cached room on persistence failure.** `packages/sync/src/index.ts:376-418` — when `persistence.getYDoc()` rejects, `ready` is fulfilled via `.catch` but the room is still cached. Every subsequent `await room.ready` resolves instantly with an *empty* doc; updates routed through `persistence.storeUpdate` may also be silently failing. Data divergence between in-memory state and persisted state, forever.

### Fix

**7a:** Gate inside `transact`, on the actual map size, not state-vector length:

```ts
await Sync.seed(docName, async (room) => {
  await room.ready
  return room.doc.transact(() => {
    const map = room.doc.getMap('fields')
    if (map.size > 0) return false   // genuinely already seeded
    for (const [k, v] of entries) map.set(k, v)
    return true
  })
})
```

For concurrent callers, gate on a globalThis-stored `Set<string>` of "seeding-in-progress" doc names like `firstConnectFired`.

**7b:** Move to globalThis with the same pattern as the existing keys:

```ts
// packages/sync/src/globals.ts (Phase 8 introduces this file)
const AI_CLOCK = '__rudderjs_sync_ai_clock__'
export function nextAiClock(): number {
  const g = globalThis as any
  g[AI_CLOCK] = (g[AI_CLOCK] ?? 0) + 1
  return g[AI_CLOCK]
}
```

**7c:** Wrap each interaction:

```ts
try {
  await persistence.storeUpdate(docName, update)
} catch (err) {
  syncObservers.emit({ kind: 'sync.error', op: 'storeUpdate', docName, error: err })
  console.error(`[RudderJS Sync] persistence.storeUpdate failed for ${docName}`, err)
}
try { await onChange?.(docName, data) }
catch (err) { syncObservers.emit({ kind: 'sync.error', op: 'onChange', docName, error: err }) }
```

**7d:** On `getYDoc()` rejection, evict the room:

```ts
try {
  const persisted = await persistence.getYDoc(docName)
  Y.applyUpdate(room.doc, persisted)
  resolve()
} catch (err) {
  rooms.delete(docName)            // <-- new: don't cache the broken room
  syncObservers.emit({ kind: 'sync.error', op: 'getYDoc', docName, error: err })
  reject(err)                       // not catch-to-resolve
}
```

Caller of `getOrCreateRoom` already handles the rejection via the `ready` promise per [[project_sync_multipeer_diagnostic]] — propagating is safer than silently degrading.

### Regression test

```ts
it('Sync.seed only writes when the field map is empty, atomically', async () => {
  const [a, b] = await Promise.all([
    Sync.seed('doc-1', { title: 'A' }),
    Sync.seed('doc-1', { title: 'B' }),
  ])
  assert.equal([a, b].filter(x => x).length, 1) // only one wrote
})

it('evicts the room from cache when persistence.getYDoc rejects', async () => {
  fakePersistence.failNext()
  await assert.rejects(Sync.snapshotAsync('doc-2'))
  fakePersistence.recover()
  const snap = await Sync.snapshotAsync('doc-2')   // fresh attempt, succeeds
  assert.ok(snap)
})
```

---

## Phase 8 — Sync: awareness lifecycle + globals hygiene

**Severity:** P1 — stale ghost cursors for dropped users; AI awareness drifts across module re-eval; lexical/awareness.ts hardcodes the rooms-globalThis key (drift risk).
**Effort:** ~2h + tests
**Bumps:** `@rudderjs/sync` patch

### The bug

**8a — `awarenessMap` leaks on abnormal close.** `packages/sync/src/index.ts:582-583, 602-604` keys awareness by the `ws` socket and clears on `close` event only. Force-killed sockets (proxy timeout, tab kill) never fire `close` — entry stays in map. Late joiners get ghost-cursor messages for every dropped user.

**8b — Hardcoded globalThis keys.** `packages/sync/src/index.ts` uses `KEY = '__rudderjs_live__'`; `packages/sync/src/lexical/awareness.ts:71` redeclares `ROOMS_KEY = '__rudderjs_live__'` independently. Rename either side and AI cursors silently break. Package was renamed from `live` → `sync` but the globalThis key still says `live` — a future cleanup PR is the typical trigger.

**8c — `CollabRoomManager.start()` second-call dead promise.** `packages/sync/src/react/CollabRoomManager.ts:80-83` — if a manager is re-used and `start()` called twice, the second call returns `undefined` silently; if the first was cancelled mid-`loadYjs`, `synced` rejects forever. Consumers (`useCollabSeed`) read the rejection as "not available" and never re-seed.

**8d — Stale `aiAwarenessMsg` replay.** `packages/sync/src/index.ts:528-531` stores `aiAwarenessMsg` and replays to every new joiner. If an AI agent crashes mid-edit without calling `clearAiAwareness`, the stale cursor is replayed forever — no TTL, no invalidation.

### Fix

**8a:** Prune dead sockets on replay; long-term key awareness by Yjs `clientID`, not socket:

```ts
for (const [client, buf] of room.awarenessMap) {
  if (client.readyState !== 1) { room.awarenessMap.delete(client); continue }
  if (client !== ws) ws.send(buf)
}
```

**8b:** Centralize globals into `packages/sync/src/globals.ts`:

```ts
export const SYNC_KEYS = {
  rooms:           '__rudderjs_sync_rooms__',
  persistence:     '__rudderjs_sync_persistence__',
  firstConnect:    '__rudderjs_sync_first_connect__',
  observers:       '__rudderjs_sync_observers__',
  aiAwarenessClock:'__rudderjs_sync_ai_clock__',
} as const

export function syncGlobal<T>(key: keyof typeof SYNC_KEYS, init: () => T): T { /* ... */ }
```

All call sites import from this file. Old `__rudderjs_live_*` keys read-through for one minor version, then dropped (mark in Notable below; defer to a follow-up to keep this phase scoped).

**8c:** Clear `started` in `stop()` so the manager can be re-`start()`-ed; otherwise throw on second call instead of silently returning. The latter is safer.

**8d:** Stamp `aiAwarenessAt: number` on the room when storing. New-client handshake skips replay if older than ~60s. Also expose `Sync.clearAiAwareness(docName)` server helper for explicit recovery.

### Regression test

```ts
it('prunes dead sockets from awarenessMap on replay', async () => {
  const a = await openSocket(), b = await openSocket()
  await a.subscribe('doc-1'); await b.subscribe('doc-1')
  a.terminate() // force-kill, no close frame
  const c = await openSocket()
  await c.subscribe('doc-1')
  // c should NOT receive awareness from a (already dead)
  assert.equal(c.received('awareness').filter(m => m.from === a.id).length, 0)
})

it('skips stale AI awareness replay older than the TTL', async () => {
  setAiAwareness('doc-2', /* cursor */)
  clock.tick(120_000)
  const newJoiner = await openSocket(); await newJoiner.subscribe('doc-2')
  assert.equal(newJoiner.received('ai-awareness').length, 0)
})
```

---

## Notable (P2 — track and decide, not in this sweep)

### Queue

- **`Job.retries` is dead state** — `DispatchBuilder` reads `delay` but never `retries`; `DispatchOptions` has no `retries` field. Users set `static retries = 5` expecting drivers to honor it; nothing wires through. Add `retries?: number` to `DispatchOptions`; builder reads `(JobCls as typeof Job).retries`; drivers pass to BullMQ `attempts` / Inngest `retries`.
- **Chain WeakMap state keyed by `Job` instance** — reusing a `Job` instance across two `Chain.of(...)` calls overwrites the first chain's state mid-execution. Key by `(chainId, jobIndex)`.

### BullMQ

- **`retryFailed` truncates to 1000 + `Promise.all` swallows partial failures** (`packages/queue-bullmq/src/index.ts:308-312`). Page in 500s; use `Promise.allSettled`; return `{ retried, failed }`.
- **`rediss://` URL silently downgraded to plaintext** (lines 37-61). Detect scheme, set `tls: {}`; reject `NaN` db values; don't fall back to `127.0.0.1` on malformed URLs.
- **Doctor uses `createRequire` for `ioredis`** (`packages/queue-bullmq/src/doctor.ts:45-57`). Use `resolveOptionalPeer('ioredis')` per [[esm-only-peer-resolution]]. Raise `connectTimeout` from 2s → 5s; surface the value in the message.

### Broadcast

- **`x-forwarded-for` trusted unconditionally** for observability (`ws-server.ts:175-180`). Add `broadcast.trustProxy?: boolean | string[]` mirroring server-hono's convention.
- **`nextId()` collision risk** (5 base36 chars + counter, `ws-server.ts:117-119`). Use `crypto.randomUUID()` with lazy `await import('node:crypto')`.
- **Silent error swallowing** in `send()`, `jsonByteSize`, `broadcastObservers.emit` — at minimum `console.warn` once per socket-or-channel on serialization failure via a `WeakSet` guard.
- **Presence join atomicity** — `state.channels.add` and `state.presence.set` happen on different lines; concurrent joins drift the members snapshot. Atomicize, then read `members` (excluding self).

### Sync

- **Tiptap stubs throw with no compile-time signal** (`packages/sync/src/tiptap/index.ts:48-66`). `as never` casts hide the runtime throw. Either remove the subpath from `package.json` `exports` or add `@deprecated` JSDoc + change return types to `never`.
- **Empty-doc detection inconsistent** across `Sync.seed`, `useCollabSeed`, `insertBlock` (state-vector, fragment.length, root.length). Single canonical helper.

---

## Suggested PR order

Independent where possible, but Phase 1 unblocks Phase 4 (shared `executeJob`), Phase 3 unblocks Phase 1 (atomic lock + serializer), Phase 6 depends on Phase 5 (driver landed before HMR cleanup matters).

1. **Phase 3** — atomic unique-lock + payload serializer (foundations for Phase 1)
2. **Phase 1** — driver contract execution via `executeJob` (cleans up middleware/uniqueness/`failed()` in one shot)
3. **Phase 2** — closure/chain/batch capability flags + clear throws
4. **Phase 4** — Inngest `__context` + BullMQ shutdown + CLI lazy registry
5. **Phase 5** — broadcast WS auth + origin (security; can ship in parallel with queue phases)
6. **Phase 6** — broadcast multi-instance driver (depends on Phase 5's HMR cleanup)
7. **Phase 7** — sync persistence error paths + seed atomicity + AI clock global
8. **Phase 8** — sync awareness + globals hygiene
9. **Notable** — bundle into one P2 grab-bag PR per package when time permits

Phases 5 + 7 are independent of the queue track and can ship first if the security/data-integrity findings need to land sooner.

---

## Strengths noted (context)

- **Sync's `globalThis` HMR pattern** for room state (`__rudderjs_live_*`) is one of the cleanest examples in the codebase — Phase 8 just extends the discipline to keys that were missed (AI clock, lexical/awareness).
- **BullMQ's context plumbing** (embed `__context` + hydrate via `runWithContext`) is the right pattern — Phase 4 propagates it to Inngest rather than reinventing.
- **`broadcastObservers` deliberately swallows handler throws** so observability doesn't take down the runtime — correct posture, just needs a debug-grade `console.warn` so silent telescope failures aren't completely invisible.
- **`syncObservers` + `broadcastObservers` + `queueObservers`** all follow [[reference_observer_registry_pattern]] consistently — the registry-via-globalThis pattern from the static-state singleton audit holds up across these three packages.
- **`firstConnectFired()` in sync** is already the per-doc atomic guard pattern; Phase 7's `Sync.seed` race fix just reuses the same shape.
