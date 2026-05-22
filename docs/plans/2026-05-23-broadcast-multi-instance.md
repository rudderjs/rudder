# Broadcast: multi-instance driver interface + `@rudderjs/broadcast-redis`

**Date:** 2026-05-23
**Phase:** 6 of the 2026-05-22 eventing/realtime batch (predecessor plan: `docs/plans/2026-05-22-framework-eventing-realtime.md`, Phase 6 section). Sibling phases 1-5, 7, 8 already shipped via PRs #602/#604/#605/#606/#607/#608/#609. Phase 6 is the last outstanding item.
**Author:** Suleiman Shahbari

## Summary

Add a driver interface to `@rudderjs/broadcast` so multi-instance deployments fan messages out across processes, and spawn `@rudderjs/broadcast-redis@1.0.0` as the first non-Local driver. Bundle the 6b HMR fix for the upgrade-handler chain in the same PR.

The current `broadcast()` walks the in-process subscriber map only (`ws-server.ts:475-485`). A 2-instance deployment silently drops half its messages: publisher on instance B has zero local subscribers for a channel that user A subscribed to on instance A, and nothing fans the event across. README + scaffolder advertise "Laravel-Broadcast parity"; we currently ship only Local.

## Architecture decision (locked)

**Keep `@rudderjs/broadcast` single-package; spawn ONLY `-redis` as the new driver package.** Discussed 2026-05-22 with Suleiman; recorded in memory `eventing-realtime-plan`. Reasoning against splitting into `broadcast-contracts` / `broadcast-ws` / etc.:

| Merge-policy criterion | Outcome |
|---|---|
| Always co-deployed | ✓ ws-server + provider + LocalDriver always ship together |
| Shared lifecycle | ✓ provider boots the WS server, owns LocalDriver by default |
| No portability boundary | ✓ all runs on the Node http.Server upgrade path |
| Low blast radius if merged | ✓ today's `@rudderjs/broadcast` import surface stays unchanged |

The `BroadcastDriver` interface lives in `@rudderjs/broadcast/src/driver.ts`. `@rudderjs/broadcast-redis` type-only imports `BroadcastDriver` via a `peerDependency` on `@rudderjs/broadcast`. Per [[feedback_new_packages_at_1_0]] the new package ships at 1.0.0.

## File-level changes in `@rudderjs/broadcast`

### New: `packages/broadcast/src/driver.ts`

```ts
/**
 * Cross-instance pub/sub abstraction for broadcast messages.
 *
 * The local WebSocket server is one *consumer* of driver events: it
 * subscribes via `subscribe()` at boot and fans events out to its local
 * sockets. Server code calling `broadcast(channel, event, data)` publishes
 * via `driver.publish(...)`; a Redis-backed driver fans the message to
 * every instance, each of which receives it via its own `subscribe()`
 * handler and broadcasts to its local sockets.
 *
 * Single-instance deployments use the default `LocalDriver` which routes
 * straight through an EventEmitter — zero hop, current behaviour preserved.
 */
export interface BroadcastDriver {
  /**
   * Publish a message. Returns when the message has been handed to the
   * underlying transport (resolved fast for local; await round-trip to
   * Redis for remote). Should never throw on transport failure — log
   * via the observer registry and resolve.
   */
  publish(channel: string, event: string, data: unknown): Promise<void>

  /**
   * Subscribe to every published message across the cluster. The handler
   * receives `(channel, event, data)` and is invoked for messages
   * published by ANY instance, including the one that subscribed. Local
   * fan-out (broadcast() → local sockets) reads from this stream.
   *
   * Returns an unsubscribe function.
   */
  subscribe(
    handler: (channel: string, event: string, data: unknown) => void,
  ): () => void

  /** Tear down the driver (close redis connections, etc.). */
  close?(): Promise<void> | void
}

export class LocalDriver implements BroadcastDriver {
  private handlers: Array<(c: string, e: string, d: unknown) => void> = []

  async publish(channel: string, event: string, data: unknown): Promise<void> {
    // Same-tick synchronous fan-out — current Local semantics.
    for (const h of this.handlers) {
      try { h(channel, event, data) } catch { /* swallow — handler errors must not break broadcasts */ }
    }
  }

  subscribe(handler: (c: string, e: string, d: unknown) => void): () => void {
    this.handlers.push(handler)
    return () => { this.handlers = this.handlers.filter((h) => h !== handler) }
  }
}
```

### Modified: `packages/broadcast/src/ws-server.ts`

- Add a `driver: BroadcastDriver` slot on `WsState`.
- `initWsServer()` accepts an optional `driver` option (defaults to `new LocalDriver()`).
- At init, the wss subscribes to the driver and fans every event into the local sockets via the existing `broadcastTo(state, channel, ...)` path.
- `broadcast(channel, event, data)` becomes:
  ```ts
  export async function broadcast(channel: string, event: string, data: unknown): Promise<void> {
    const state = g[KEY] as WsState | undefined
    if (!state) return
    await state.driver.publish(channel, event, data)
    broadcastObservers.emit({
      kind: 'broadcast', channel, event,
      recipientCount: state.channels.get(channel)?.size ?? 0,
      payloadSize: jsonByteSize(data),
      source: 'server',
    })
  }
  ```
- `client-event` frames also route via `driver.publish()` (so client-sent events propagate cross-instance the same way).
- `resetBroadcast()` calls `await state.driver.close?.()` and clears state.

### Modified: `packages/broadcast/src/provider.ts`

- `BroadcastConfig` gains `driver?: () => BroadcastDriver | Promise<BroadcastDriver>`.
- `boot()` resolves the factory (handles sync + async), passes the instance to `initWsServer()`.
- Defaults to `new LocalDriver()` when unset — single-instance behaviour preserved.

### Modified: `packages/broadcast/src/index.ts`

Re-export the new symbols:

```ts
export { LocalDriver }                 from './driver.js'
export type { BroadcastDriver }        from './driver.js'
```

### Modified: `packages/broadcast/README.md`

New section after "Channel auth": **Multi-instance fan-out** — drop-in `RedisDriver` snippet from `@rudderjs/broadcast-redis` for 2+ instance deployments.

## 6b — Lazy upgrade-handler trampoline (same PR)

**The HMR bug.** `provider.ts:108-110` stores `handler = getUpgradeHandler(path)` under `globalThis[UPGRADE_KEY]`, but `@rudderjs/vite` (`packages/vite/src/index.ts:135`) and `@rudderjs/server-hono` (`packages/server-hono/src/index.ts:23`) cache the function reference at attach time. After HMR / provider re-boot, the new closure overwrites the global, but the http.Server still has the stale reference attached as an `upgrade` listener. First listener wins, sockets land on disposed `wss` state.

**Fix.** Both attachers thin out to a trampoline:

```ts
// At attach time (once per process):
server.on('upgrade', (req, socket, head) => {
  const current = (globalThis as Record<string, unknown>)['__rudderjs_ws_upgrade__']
  if (typeof current === 'function') {
    (current as (r: typeof req, s: typeof socket, h: typeof head) => void)(req, socket, head)
  }
})
```

Provider boot continues to write the current closure to `globalThis[UPGRADE_KEY]`. HMR re-eval safely swaps the closure without re-attaching to `http.Server`.

**Touch points:**

- `packages/vite/src/index.ts:135-167` — flush/interval block becomes a single trampoline attach. The 'wait until handler is present' polling can stay if we want to defer attachment until the first handler appears, but switching to attach-once-trampoline-always is simpler.
- `packages/server-hono/src/index.ts:23-30` — same pattern.
- `packages/sync/src/index.ts:740-770` — the sync upgrade chain reads `__rudderjs_ws_broadcast_upgrade__` then writes back `__rudderjs_ws_upgrade__`. Verify this still composes correctly with the trampoline (sync writes the combined handler into the slot the trampoline reads — should be a no-op refactor from sync's side, just a verification).

The 6b changeset entry is a separate bullet but bundled in the same PR per [[feedback_bundle_load_bearing_fix.md]].

## New package: `@rudderjs/broadcast-redis@1.0.0`

### Directory layout

```
packages/broadcast-redis/
├── README.md
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.test.json
└── src/
    ├── index.ts          # exports RedisDriver
    ├── redis-driver.ts   # ioredis pub/sub wrapper
    ├── redis-driver.test.ts
    └── doctor.ts         # rudder doctor: REDIS_URL + connectivity probe
```

### `packages/broadcast-redis/package.json`

```jsonc
{
  "name": "@rudderjs/broadcast-redis",
  "version": "1.0.0",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/rudderjs/rudder", "directory": "packages/broadcast-redis" },
  "type": "module",
  "engines": { "node": "^20.19.0 || >=22.12.0" },
  "files": ["dist"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":         { "import": "./dist/index.js",         "types": "./dist/index.d.ts" },
    "./doctor":  { "import": "./dist/doctor.js",        "types": "./dist/doctor.d.ts" }
  },
  "scripts": {
    "build":     "tsc -p tsconfig.build.json",
    "dev":       "tsc -p tsconfig.build.json --watch",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src",
    "clean":     "rm -rf dist",
    "test":      "tsc -p tsconfig.test.json && cd dist-test && node --test"
  },
  "peerDependencies": {
    "@rudderjs/broadcast": "workspace:^",
    "ioredis":             "^5.0.0"
  },
  "devDependencies": {
    "@rudderjs/broadcast": "workspace:^",
    "@rudderjs/console":   "workspace:^",
    "@types/node":         "^20.0.0",
    "ioredis":             "^5.0.0",
    "typescript":          "^5.4.0"
  }
}
```

Notes:
- **No `rudderjs.provider` field.** This package is a driver factory, not a service provider — the user imports `RedisDriver` and passes it via `config/broadcast.ts`. No auto-discovery.
- **`peerDependency` on `ioredis`** (not `dependency`). Consistent with `@rudderjs/cache-redis`. App installs `ioredis` themselves.
- **`peerDependency` on `@rudderjs/broadcast`** for the type-only `BroadcastDriver` import. The runtime never touches broadcast — just satisfies `implements BroadcastDriver`.

### `packages/broadcast-redis/src/redis-driver.ts`

```ts
import type { Redis as RedisType } from 'ioredis'
import type { BroadcastDriver }    from '@rudderjs/broadcast'

export interface RedisDriverOptions {
  /**
   * ioredis instance OR a connection URL. Factory accepts either.
   * If a URL is given, the driver creates two connections (one for
   * `publish`, one for `subscribe`) since ioredis subscriber clients
   * cannot also publish.
   */
  redis: RedisType | string

  /**
   * Channel-name prefix in Redis. Default: `'rudderjs:broadcast:'`.
   * Useful when multiple apps share a Redis instance.
   */
  prefix?: string
}

interface RedisChannelMessage {
  channel: string
  event:   string
  data:    unknown
}

export class RedisDriver implements BroadcastDriver {
  private readonly pub:    RedisType
  private readonly sub:    RedisType
  private readonly prefix: string
  private readonly key:    string
  private readonly handlers: Array<(c: string, e: string, d: unknown) => void> = []
  private subscribed = false

  constructor(opts: RedisDriverOptions) {
    // Resolve to a pair of ioredis instances (lazy-require ioredis so
    // the import only fails when actually constructing the driver).
    const ioredis = requireIoredis()
    if (typeof opts.redis === 'string') {
      this.pub = new ioredis(opts.redis)
      this.sub = new ioredis(opts.redis)
    } else {
      this.pub = opts.redis
      this.sub = opts.redis.duplicate()
    }
    this.prefix = opts.prefix ?? 'rudderjs:broadcast:'
    this.key    = this.prefix + 'fanout'   // single pub/sub channel; payload carries channel+event

    this.sub.on('message', (_redisChannel, raw) => {
      try {
        const msg = JSON.parse(raw) as RedisChannelMessage
        for (const h of this.handlers) {
          try { h(msg.channel, msg.event, msg.data) } catch { /* swallow */ }
        }
      } catch {
        // bad payload — swallow; observer event would be too verbose here
      }
    })
  }

  async publish(channel: string, event: string, data: unknown): Promise<void> {
    try {
      await this.pub.publish(this.key, JSON.stringify({ channel, event, data }))
    } catch (err) {
      console.error('[RudderJS Broadcast/Redis] publish failed', err)
      // intentionally do not rethrow — broadcast must never block the caller
    }
  }

  subscribe(handler: (c: string, e: string, d: unknown) => void): () => void {
    this.handlers.push(handler)
    if (!this.subscribed) {
      this.subscribed = true
      void this.sub.subscribe(this.key).catch((err) => {
        console.error('[RudderJS Broadcast/Redis] subscribe failed', err)
      })
    }
    return () => { this.handlers.splice(this.handlers.indexOf(handler), 1) }
  }

  async close(): Promise<void> {
    try { await this.sub.unsubscribe(this.key) } catch { /* ignore */ }
    try { this.sub.disconnect() }                 catch { /* ignore */ }
    try { this.pub.disconnect() }                 catch { /* ignore */ }
  }
}

function requireIoredis(): typeof import('ioredis').default {
  // Lazy-load — fails fast with a clear message when ioredis is missing.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('ioredis') as { default: typeof import('ioredis').default }).default
  } catch {
    throw new Error(
      '[RudderJS Broadcast/Redis] `ioredis` not installed. Run `pnpm add ioredis` ' +
      '(or your package manager equivalent) and retry.',
    )
  }
}
```

Open question: prefer `await import('ioredis')` over `require()` to match ESM-only-peer pattern (see [[feedback_esm_only_peer_require_bug]]). Defer to verification — if `ioredis` ships a `require` condition we use `require`; otherwise dynamic import via factory. Decide during impl, document in changeset.

### Wire-format design notes

- **Single Redis channel + payload contains channel+event** beats one Redis channel per app-channel because: (a) we don't know app channels ahead of time, (b) Redis pub/sub has no per-channel teardown cost we'd save by partitioning, (c) all subscribers always want all events fanned in (the local wss re-filters by app-channel).
- **JSON encoding** — same as the local LocalDriver's in-process pass-through. Future encoders (msgpack, etc.) can plug in via a `serializer` option — out of scope for v1.

### `packages/broadcast-redis/src/doctor.ts`

```ts
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

registerDoctorCheck({
  id:       'broadcast-redis:url',
  category: 'broadcast',
  title:    'REDIS_URL (broadcast-redis)',
  run(): DoctorResult {
    const v = process.env['REDIS_URL'] ?? process.env['BROADCAST_REDIS_URL']
    if (!v) {
      return {
        status:  'warn',
        message: 'unset — broadcast-redis driver cannot connect',
        fix:     'Set REDIS_URL (or BROADCAST_REDIS_URL) in .env',
      }
    }
    return { status: 'ok', message: 'set' }
  },
})

// Optional deep check — `rudder doctor --deep` only.
registerDoctorCheck({
  id:       'broadcast-redis:connectivity',
  category: 'broadcast',
  title:    'broadcast-redis: redis reachable',
  deep:     true,
  async run(): Promise<DoctorResult> {
    /* TODO: connect, PING, disconnect — copy pattern from cache-redis if it has one */
  },
})
```

Note: only register doctor checks when the package is installed. Pattern matches `@rudderjs/queue-inngest/src/doctor.ts`. CLI loader entry needed (see "CLI changes" below).

## Tests

### `packages/broadcast/src/ws-server.test.ts` (additions)

Add Phase 6 fixtures via a `TestDriver` (shared EventEmitter) that two `initWsServer` instances can both subscribe to:

```ts
class TestDriver implements BroadcastDriver { /* shared EventEmitter */ }

it('broadcast() reaches subscribers on a different driver-shared instance', async () => {
  const drv = new TestDriver()
  // Spin two wss listening on two http.Servers but pointed at the same driver
  const a = await spinUp({ driver: () => drv })
  const b = await spinUp({ driver: () => drv })
  const seen: unknown[] = []
  const wsA = await connectAndSubscribe(a.url, 'public-test', (msg) => seen.push(msg))
  await b.broadcast('public-test', 'hello', { foo: 1 })
  await waitFor(() => seen.length === 1)
  assert.deepEqual(seen[0], { type: 'event', channel: 'public-test', event: 'hello', data: { foo: 1 } })
  wsA.close(); await a.shutdown(); await b.shutdown()
})

it('LocalDriver behaviour unchanged for single-instance deployments', async () => {
  // existing broadcast() → local subscriber path still works with the
  // implicit default LocalDriver
})

it('client-event frames fan out via the driver', async () => {
  // Two instances pointed at TestDriver; client A sends client-event,
  // client B (on the other instance, subscribed to same channel) receives.
})
```

### `packages/broadcast/src/provider.test.ts` (additions)

```ts
it('uses LocalDriver by default', async () => {
  // boot provider without a driver config; broadcast() works
})

it('honours config.broadcast.driver factory (sync)', async () => {
  // pass () => testDriver instance, assert wss subscribes to it
})

it('honours config.broadcast.driver factory (async)', async () => {
  // pass () => Promise.resolve(testDriver instance)
})

it('HMR re-boot replaces upgrade handler without re-attaching to http.Server', async () => {
  const initial = httpServer.listeners('upgrade').length
  await rebootBroadcastProvider()    // simulate HMR
  assert.equal(httpServer.listeners('upgrade').length, initial)
})
```

### `packages/broadcast-redis/src/redis-driver.test.ts`

- **In-memory ioredis mock.** Use `ioredis-mock` as a devDependency, or write a tiny mock inline. Mock is fine — we're testing the driver wiring, not Redis itself.
- Cases:
  - `publish()` → `subscribe()` handler fires (single instance round-trip)
  - Two `RedisDriver` instances sharing the mock → publish on A is seen on B
  - `publish()` swallows transport errors (mock throws) — no rethrow
  - `close()` unsubscribes + disconnects both connections

## Docs

- **`docs/guide/broadcasting.md`** — new section "Multi-instance deployments" with the Redis driver setup snippet. Cross-link to `@rudderjs/broadcast-redis` README.
- **`packages/broadcast/README.md`** — add a "Drivers" section listing Local (default) + `@rudderjs/broadcast-redis`, with import snippet.
- **`packages/broadcast-redis/README.md`** — full package README (install, config snippet, env vars, doctor checks, troubleshooting). Sized to match other driver-package READMEs (`cache-redis`, `queue-bullmq`).
- **`Architecture.md`** — broadcast section gains a note that drivers are pluggable; broadcast-redis is the first non-Local driver.
- **`CLAUDE.md`** — "Common Pitfalls" entry for single-process Map dropping cross-instance messages when running without a Redis driver.

Per [[feedback_docs_update]] all of the above land in the Phase 6 PR, not later.

## CLI changes

`packages/cli/src/index.ts` — add `loadPackageCommands` entries for `@rudderjs/broadcast-redis/doctor` so `rudder doctor` picks up the new checks. Pattern matches the existing `queue-inngest/doctor` entry per [[feedback]] "Package commands don't register in CLI" in `CLAUDE.md`.

## Scaffolder changes (`create-rudder/`)

**Out of scope for v1.** The scaffolder still emits a `broadcast` boolean that adds `@rudderjs/broadcast` — no driver selection prompt. Adding a "use Redis" toggle pulls in an `ioredis` install step + REDIS_URL .env scaffold and is better as a follow-up. The Redis driver is opt-in via README → config; users who want it can wire it manually.

## Changesets

Three changeset files in the same PR per [[feedback_changeset_for_fix_prs]]:

1. **`.changeset/broadcast-multi-instance-driver.md`** — `@rudderjs/broadcast` minor.
   - Added `BroadcastDriver` interface + `LocalDriver` (default; current single-process behaviour preserved).
   - `broadcast()` is now `async` and resolves after the driver has accepted the message.
   - `config.broadcast.driver` factory option for plugging in a multi-instance driver.
   - 6b: HMR fix — upgrade handler trampoline reads `globalThis[UPGRADE_KEY]` at upgrade time instead of capturing the closure at attach time. Fixes stale-handler-after-HMR.

2. **`.changeset/broadcast-redis-init.md`** — `@rudderjs/broadcast-redis@1.0.0` (new).
   - First non-Local broadcast driver. ioredis pub/sub fan-out across instances.
   - `RedisDriver({ redis: <url-or-instance>, prefix? })` constructor.
   - `rudder doctor` checks for `REDIS_URL` env + (deep) connectivity.

3. **`.changeset/broadcast-vite-server-hono-trampoline.md`** — `@rudderjs/vite` + `@rudderjs/server-hono` patch.
   - Switch from caching the upgrade-handler reference to a trampoline that reads from `globalThis[UPGRADE_KEY]` per upgrade event. Pairs with `@rudderjs/broadcast`'s HMR fix.

## Risk + verification checklist

Per [[feedback_verify_before_push]]:

- [ ] `pnpm build` from root — all packages compile, no cycles
- [ ] `pnpm typecheck` — no new errors
- [ ] `pnpm --filter @rudderjs/broadcast test` — full broadcast suite green
- [ ] `pnpm --filter @rudderjs/broadcast-redis test` — new suite green
- [ ] `pnpm lint` — both packages
- [ ] Playground smoke: `cd playground && pnpm dev`, hit the Broadcast demo, force HMR (touch the provider), verify ws still works
- [ ] Multi-instance smoke (manual): run playground at port 3000 + a second instance at port 3001 with `config/broadcast.ts` pointing to a local Redis, subscribe from a browser on :3000, publish from a curl to :3001, observe delivery

## Out of scope (defer to follow-ups)

- Per-channel encoding / msgpack — JSON v1, add `serializer?` option later if benchmarks warrant.
- Driver pattern: `keyByChannel` (one Redis channel per app channel) — current single-channel fan-in is simpler; partition only when scale demands it.
- Scaffolder Redis-driver prompt — see above.
- `@rudderjs/broadcast-ably`, `@rudderjs/broadcast-pusher` — same shape, deferred until asked.
- Read-through compatibility for `globalThis['__rudderjs_ws_upgrade__']` callers outside the framework — none exist (verified by grep across the monorepo); document the slot in `@rudderjs/broadcast/README.md` as `@internal`.

## Open questions

1. **`broadcast()` becomes `async`.** Today it's sync. Most call sites are already inside async handlers; we'd need to `void broadcast(...)` for fire-and-forget call sites. Audit:
   - `packages/sync/src/index.ts` — uses `broadcast()` cross-package; check for return-value usage. None expected.
   - Apps: `playground/`, `playground-web/`, test fixtures. Same audit.
   Likely safe; if not, change `broadcast()` to fire-and-forget internally (start the publish promise, swallow errors via observer) and keep the sync signature. Decide during impl based on call-site audit.

2. **`ioredis` import strategy.** ESM-only-peer pattern says dynamic import; ioredis ships CJS + ESM so either works. Decide during impl, document in changeset.

3. **Single-channel vs per-channel pub/sub partitioning.** Single-channel + payload-routing is cheaper to set up but every instance receives every message. Audit whether the local re-filter cost matters at the scale we'd recommend Redis. If not, single-channel is the right default. If yes, expose via option.

Linked memory: [[eventing-realtime-plan]] (predecessor batch tracking).
