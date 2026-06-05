# @rudderjs/queue

## 4.4.0

### Minor Changes

- 119cf9f: feat: the native database queue reserves jobs with `FOR UPDATE SKIP LOCKED` (Postgres/MySQL). A worker whose top candidate is mid-reservation by another worker now takes the next runnable job immediately instead of blocking on the row lock and re-evaluating to zero rows — multi-worker pickup no longer serializes on the head-of-queue row. No-op on SQLite (its write transaction already serializes the reservation); reservation semantics are otherwise unchanged.

## 4.3.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

- a93455e: feat(queue): native database-backed queue driver (`@rudderjs/queue/native`)

  A persistent, self-hosted queue driver backed by the native ORM engine — the
  zero-infrastructure default tier, modeled on Laravel's `database` driver.
  Selected with `driver: 'database'` in `config/queue.ts`; BullMQ and Inngest
  remain the high-throughput / cloud tiers, unchanged.

  - Jobs persist in a `jobs` table; exhausted jobs move to `failed_jobs`. Stub the
    migrations with `pnpm rudder queue:table`, then `pnpm rudder migrate`.
  - For apps on a non-native ORM (Prisma/Drizzle), set `engine` + `url` on the
    queue connection to give the queue its own dedicated SQLite/Postgres/MySQL
    store — its `jobs` / `failed_jobs` tables are created automatically on first
    use (its private DB, no migration step). Omit `engine` to run against the app's
    native ORM connection instead.
  - `pnpm rudder queue:work [queues] [--once --sleep --tries --backoff --timeout
--max-jobs --stop-when-empty]` — a polling worker with comma-separated queue
    **priority** order, retries with backoff, and `retry_after` reclaim of jobs
    abandoned by a crashed worker. Atomic reservation via a transaction +
    `lockForUpdate()` (`FOR UPDATE` on Postgres/MySQL; a serializing write
    transaction on SQLite — run a single worker on SQLite).
  - `queue:status` / `queue:clear` / `queue:failed` / `queue:retry` all work
    against the new driver.

  Supporting changes:

  - `@rudderjs/orm` (native): new `QueryBuilder.lockForUpdate()` / `sharedLock()`
    — first-class pessimistic row locking (Laravel parity). The compiler emits the
    dialect's `FOR UPDATE` / `FOR SHARE` suffix, a no-op on SQLite.
  - `@rudderjs/contracts`: `QueryBuilder` gains optional `lockForUpdate?()` /
    `sharedLock?()` (additive; adapters without row locking omit them).
  - `@rudderjs/queue`: `executeJob` gains an opt-out `invokeFailedHook` flag so the
    database worker fires `failed()` exactly once, on terminal failure (Laravel
    parity); existing drivers are unaffected.

  Deferred to a follow-up (same limits as the BullMQ driver today): chains,
  batches, and closure dispatch.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/cache@1.4.0
  - @rudderjs/core@1.7.0
  - @rudderjs/router@1.8.0

## 4.2.2

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/core@1.5.1
  - @rudderjs/router@1.7.1

## 4.2.1

### Patch Changes

- 9c46b04: fix(queue): admin commands now exit instead of hanging the terminal

  `queue:status`, `queue:clear`, `queue:failed`, and `queue:retry` printed their output but never closed the adapter's connection — the open BullMQ/Redis connection kept the Node event loop alive, so the CLI hung until Ctrl+C (the command did its job, but the prompt never returned). These one-shot admin commands now `await a.disconnect?.()` after their work, so the process exits cleanly. `queue:work` (which is meant to block until SIGTERM) is unchanged.

## 4.2.0

### Minor Changes

- b774f0f: Atomic unique-lock + typed payload serializer (Phase 3 of the 2026-05-22 eventing/realtime plan):

  - **`@rudderjs/cache` adds `add(key, value, ttl)`** — atomic claim (SETNX semantics). Redis: `SET NX EX`; in-memory: synchronous check-and-set. Returns `true` if THIS caller wrote, `false` if a concurrent caller got there first. Implemented on `MemoryAdapter`, `RedisAdapter`, and `FakeCacheAdapter` (also surfaces a new `'add'` entry in `CacheOperation`). Same `Cache.add(...)` shape on the static facade.
  - **`acquireUniqueLock` now uses `cache.add()`** — the prior `cache.get` + `cache.set` pattern allowed two concurrent dispatchers to both read `null`, both write, and both think they acquired the lock; the duplicate `ShouldBeUnique` jobs would then run side-by-side. The new path closes the race on every driver `@rudderjs/cache` ships. The in-memory fallback (no cache provider registered) is already safe because the check-and-set runs synchronously in one event-loop tick.
  - **Typed payload serializer (`encodePayload` / `decodePayload`)** — every driver previously did `JSON.parse(JSON.stringify(job))` on dispatch. `Date` round-tripped as ISO string (handlers typed `Date` saw `string`), `BigInt` threw, `Buffer` collapsed to `{type,data}`, `Map`/`Set` collapsed to `{}`/`[]`. The new serializer tags non-JSON-safe types with `{ __rj: '<tag>', value: ... }` so they survive the wire and rehydrate in the worker. Wired into `SyncAdapter`, `@rudderjs/queue-bullmq`, and `@rudderjs/queue-inngest` on both the dispatch and worker sides.
  - **`safePayload` no longer hides serialisation failures** — was `try { JSON.parse(JSON.stringify(job)) } catch { return {} }`, silently dropping the entire payload (and the observer signal that something was wrong). Now propagates the error.
  - **`Queue.fake()` no longer reaches for ESM `require()`** — replaced the `require('./fake.js')` workaround with a static import. The previous landmine matches [[esm-only-peer-require-bug]] — pure-ESM bundles would crash on `require` not being defined.

  The serializer behavior change is a true bug fix — apps whose handlers received `string` for a `Date` field were broken; they now receive a `Date`. Apps that explicitly worked around the bug (manual `new Date(payload.field)` in the handler) keep working because the tagged shape is opaque to user code.

- 2b1819a: Closure / chain / batch dispatchers now declare driver capability (Phase 2 of the 2026-05-22 eventing/realtime plan):

  Until now, `dispatch(fn)`, `Chain.of([...])`, and `Bus.batch([...])` silently no-op'd on async drivers. Each helper builds a wrapper `{ handle: fn }` plain object that holds the user's logic as a closure — under `JSON.stringify`, the function silently becomes `undefined`. The wrapped job got enqueued, but the worker side reconstructed it with `constructor.name === 'Object'`, no `handle` method, and no error path. Apps shipped "works locally" + "nothing runs in prod".

  - **`QueueAdapter` gains three optional `readonly` flags** — `supportsClosures`, `supportsChain`, `supportsBatch`. Drivers that can run wrapped closures (Sync, Fake) declare `true`; drivers that serialise jobs over the wire (BullMQ, Inngest) declare `false`. The flags are additive — existing third-party adapters that don't declare them keep working through the legacy `dispatchBatch` / `dispatchChain` shape checks.
  - **`dispatch(fn)`, `Chain.of([...]).dispatch()`, `Bus.batch([...]).dispatch()` throw clear errors** when the registered driver opts out. Each message names the driver and suggests either switching to the sync driver for that code path or rewriting to concrete `Job` classes.
  - **Native overrides win.** A driver that ships its own `dispatchChain` / `dispatchBatch` keeps working regardless of the flags — the capability check runs only after the native fast-path doesn't match.
  - **`batch.catch()` fires exactly once per batch.** Was called inside each per-job wrapper's catch, so a 3-failure batch fired `catch` three times. Now fires once after `Promise.allSettled`, passing the first rejection reason (or a synthesised error when failures were swallowed inside `allowFailures()` wrappers). Matches Laravel.

  7 new tests across `closure.test.ts`, `chain.test.ts`, `batch.test.ts` cover capability throws on a fake async-only adapter + `catch()` firing exactly once on multi-failure batches.

- 4254abe: Drivers must enforce middleware + `failed()` + `ShouldBeUnique` (Phase 1 of the 2026-05-22 eventing/realtime plan):

  Until now, `@rudderjs/queue` exported `runJobMiddleware`, `acquireUniqueLock`, and the `failed()` hook contract — but **none of the shipped drivers invoked them**. A user who shipped `middleware() { return [new RateLimited(...)] }` got zero rate-limiting in prod; a user with `implements ShouldBeUnique` dispatched duplicates on every concurrent call; an Inngest job that threw never saw its `failed()` hook fire. This phase centralises execution so every driver routes through the same pipeline.

  - **New `executeJob(instance, ctx)` helper.** Single source of truth for "run a built job through the full pipeline" — context hydration (`@rudderjs/context`) → middleware → `handle()` → `failed()` hook on terminal failure → release of the `ShouldBeUnique` dispatch lock. Exported from `@rudderjs/queue`.
  - **`runJobMiddleware` gains an optional `handler` argument.** Backwards-compatible (defaults to `() => job.handle()`); `executeJob` uses it to catch from inside the pipeline so `failed()` fires even when middleware throws.
  - **`DispatchBuilder.send()` now acquires the `ShouldBeUnique` lock at dispatch time.** Mirrors Laravel: if `acquireUniqueLock` returns `false` (another dispatcher already won the atomic claim from Phase 3), the dispatch is silently skipped. `executeJob` releases the lock when the worker side finishes — or right before `handle()` runs for `ShouldBeUniqueUntilProcessing`.
  - **`SyncAdapter` routes through `executeJob`** — passes the original instance directly so closure-style jobs (`dispatch(fn)`, `Chain`, batch wrappers) keep their `handle` closure intact (it would not survive a JSON round-trip on async drivers; that's a separate Phase 2 fix).
  - **`queue-bullmq` processor routes through `executeJob`** — reconstructs the instance with `decodePayload` + `Object.assign`, then `executeJob(instance, { __context })`. Drops the inline context-hydration block; `executeJob` handles it.
  - **`queue-inngest` function body routes through `executeJob`** — Inngest gains the `failed()` hook, middleware, and unique-lock release it has never had.

  **Behaviour change to call out:** on `queue-bullmq` and `queue-inngest`, `failed()` now fires on every catch from the worker side, not only on terminal retry exhaustion. Closer to the Laravel semantic but worth noting for apps whose `failed()` does irreversible cleanup. Retry-aware `failed()` is a follow-up.

### Patch Changes

- 652c858: Inngest context propagation + BullMQ lifecycle hygiene + queue CLI lazy adapter (Phase 4 of the 2026-05-22 eventing/realtime plan):

  **`@rudderjs/queue-inngest`**

  - **P0 — `__context` now round-trips through the Inngest transport.** `dispatch()` embeds the serialized `DispatchOptions.__context` on `event.data`; the function body extracts it and forwards to `executeJob({ __context })`. Apps using `@rudderjs/context` (tenant / user / locale ALS) that switched driver from BullMQ → Inngest were silently dropping context on every job, opening a wrong-tenant-DB-write risk. The wire format now matches BullMQ, so cross-driver migrations are safe.
  - **P1 — `Job.retries` validated and clamped to `[0, 20]` with a `console.warn`.** Inngest accepts only integers in that range. The previous `as 0|1|…|20` cast accepted any number at compile-time and crashed at registration with a confusing error. Out-of-range values now warn at boot and clamp to the nearest valid value — surfacing the misuse instead of breaking the boot.
  - Minor bump because `__context` now propagates where it previously did not — apps relying on the broken state would observe a _correct_ tenant being attached to jobs after upgrade.

  **`@rudderjs/queue-bullmq`**

  - **P1 — Worker shutdown is now properly awaited.** `disconnect()` closes workers (via `Promise.allSettled`) **before** queues, then closes queues, logging any rejections without swallowing them. Previously `Promise.all([...queues].map(q => q.close()))` ignored workers entirely — workers kept polling BRPOP through the SIGTERM grace period and k8s rolling restart pods outlived their window. Closing workers before queues also avoids a "Connection is closed" race during worker BRPOP-in-flight.
  - **P1 — `SIGTERM` / `SIGINT` listeners no longer leak.** They're registered once per adapter (on the first `work()` call) and removed in `disconnect()`. Multi-tenant boot or test re-runs no longer accumulate handlers; `process.off` matches the listener because the closure is bound on the adapter instance.
  - **P1 — BullMQ no longer double-fires `instance.failed()` per attempt.** The worker `'failed'` event listener previously called `await instance.failed?.(error)` separately, on top of `executeJob`'s `failed()` invocation (Phase 1). The duplicate call is removed; the listener now owns observer emission + the console log only. The unhandled-rejection risk from the async listener body is gone for the same reason — there's no longer an awaited hook in the listener that could throw into an EventEmitter.
  - `work()` now exposes the underlying `workers: Worker[]` on the adapter (read-only by convention) so callers and tests can introspect lifecycle state.

  **`@rudderjs/queue`**

  - **P1 — `QueueServiceProvider`'s 5 CLI commands (`queue:work`, `queue:status`, `queue:clear`, `queue:failed`, `queue:retry`) now resolve the adapter via `QueueRegistry.get()` at invocation time** instead of closing over the value captured at boot. Under Vite SSR re-eval (the documented `bootstrap/` / `app/` reload path) the `rudder.command()` dedup replaces the stale closure with a fresh one — and now the fresh closure always acts on the latest registered adapter. Tests that swap the adapter via `QueueRegistry.set(...)` between bootings work end-to-end with no boot re-run.

  No public API additions in this PR; all changes are bug fixes + internal lifecycle hardening.

- Updated dependencies [b774f0f]
  - @rudderjs/cache@1.3.0

## 4.1.5

### Patch Changes

- 69ad453: Route 5 cross-bundle singletons through `globalThis` so duplicate bundles of these packages share state. Defensive sweep of the same "module-scoped state ≠ bundle-split-survival" pattern that produced #498 / #500–#506 (static-state registries) and #507 (router) and #514 (mcp metadata symbols).

  | Singleton       | Package              | Global key                        | Risk if unfixed                                                                                                                             |
  | --------------- | -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | `container`     | `@rudderjs/core`     | `__rudderjs_core_container__`     | Defensive — only `Application` imports today, but a direct cross-bundle import would split                                                  |
  | `dispatcher`    | `@rudderjs/core`     | `__rudderjs_core_dispatcher__`    | Multiple packages re-export `dispatch()` — events fired from one bundle don't reach listeners in another                                    |
  | `schedule`      | `@rudderjs/schedule` | `__rudderjs_schedule_singleton__` | User registers tasks in `routes/console.ts`; cron runner + telescope's ScheduleCollector read from a different bundle's Scheduler → no jobs |
  | `customDrivers` | `@rudderjs/log`      | `__rudderjs_log_custom_drivers__` | Public `extendLog('sentry', ...)` API — write to one bundle's Map, read from another → "Unknown driver" on every channel                    |
  | `_chainStates`  | `@rudderjs/queue`    | `__rudderjs_queue_chain_states__` | Chain.dispatch() stamps state on each job; worker reads via `getChainState(this)` — split = state silently lost                             |

  No public API change. Same shape as `groupMiddlewareStore` (long-standing globalThis precedent in `@rudderjs/core`).

  Out-of-scope: `queue/_locks` (documented process-local fallback — "use cache for production"), `server-hono/perf-boundaries` (single-module scope, no cross-bundle access).

- Updated dependencies [69ad453]
  - @rudderjs/core@1.1.7

## 4.1.4

### Patch Changes

- 13e5fb6: Route `QueueRegistry`'s adapter state through `globalThis` so the registry survives the case where `@rudderjs/queue` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/queue` inline (both `Queue.dispatch` and worker boot read `QueueRegistry`), but driver packages (`@rudderjs/queue-bullmq`) are externalized and resolve their own copy of `@rudderjs/queue` from `node_modules`. Without a shared store, `set()` from the externalized driver would land on a different class than the one `Queue.*` reads from inside the bundle, producing a misleading `No queue adapter registered` error on every `Queue.dispatch` call in prod.

  No public API change — same `set` / `get` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), PR #500 (`@rudderjs/pennant`), and PR #501 (`@rudderjs/cache`).

- Updated dependencies [e8808c9]
  - @rudderjs/cache@1.1.5

## 4.1.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/cache@1.1.4
  - @rudderjs/core@1.1.5
  - @rudderjs/router@1.2.1

## 4.1.2

### Patch Changes

- ab9d0a4: Fix two latent `@rudderjs/cache` integration bugs in the queue middleware and unique-job lock.

  - **`RateLimited` and `ThrottlesExceptions` no longer throw on first use.** Both middlewares were calling `cache.put(...)` even though `CacheAdapter` only exposes `set`. The bug was masked before #212 because `_getCache()` used CommonJS `require('@rudderjs/cache')` from inside an ESM module, threw, was swallowed by the `try/catch`, and the middlewares fell through to the "no cache — fail open" path. #212 converted `_getCache()` to `await import(...)`, so a real adapter is now returned and the missing-method `TypeError` surfaces on the first job that hits either middleware. Switched both calls to `cache.set(...)` and tightened the local `CacheLike` interface to match.

  - **`acquireUniqueLock` / `releaseUniqueLock` now talk to `@rudderjs/cache`.** Same root cause: `unique.ts` still used CJS `require('@rudderjs/cache')` from ESM, so the cache branch in both helpers was permanently unreachable and `ShouldBeUnique` jobs silently fell through to the in-process `_locks` Map (no cross-process uniqueness). Switched to `await import(...)`, made `_getCache()` async, and updated the two awaited call sites. Also fixed the same `cache.put` → `cache.set` mistake on the unique-key write.

  Adds `RateLimited`, `ThrottlesExceptions`, and `acquireUniqueLock`/`releaseUniqueLock` test coverage backed by `FakeCacheAdapter` so any regression on either path now fails CI.

- Updated dependencies [158f7ee]
- Updated dependencies [7125676]
  - @rudderjs/core@1.1.1
  - @rudderjs/router@1.1.2

## 4.1.1

### Patch Changes

- 0420c1e: Add atomic `Cache.lock()` API + refactor `WithoutOverlapping` and `schedule.withoutOverlapping()`/`onOneServer()` to use it (Laravel parity #1).

  **`@rudderjs/cache` (minor — additive):**

  - `Cache.lock(name, seconds)` — non-blocking try-acquire returning a `Lock` with `get()` / `get(callback)` / `block(seconds, callback?)` / `release()` / `forceRelease()` / `owner()`.
  - `Cache.restoreLock(name, owner)` — rebuild a lock handle by owner token for cross-process release (capture `lock.owner()` on the dispatcher, release on the worker).
  - Driver implementations: in-process `MemoryLock` (single-process only — documented caveat) and `RedisLock` (atomic `SET NX EX` acquire + Lua compare-and-delete release).
  - Owner-checked release: `lock.release()` returns `false` if the holder doesn't match (no more "release-someone-else's-lock" race when TTLs collide); `forceRelease()` bypasses the check for orphan recovery.
  - `block(seconds)` waits with ~250ms polling and throws `LockTimeoutError` on timeout.
  - `FakeCacheAdapter` records `lock-acquire` / `lock-release` / `lock-force-release` ops with `assertLockAcquired(name)` / `assertLockReleased(name)`.

  **`@rudderjs/queue` (patch — internal refactor):**

  - `WithoutOverlapping` now uses `Cache.lock()` instead of a check-then-set against the regular cache. Closes a race where two workers could both observe `null`, both write the lock, and both proceed; closes a "release-someone-else's-lock" bug when the holder's TTL elapsed mid-execution.
  - `WithoutOverlapping` now requires `@rudderjs/cache` to be installed and registered — overlap protection without a cache adapter is silently broken under contention, so it fails fast with a clear error rather than running unprotected.
  - Adds `@rudderjs/cache` as an optional peer dependency.

  **`@rudderjs/schedule` (patch — internal refactor):**

  - `schedule.withoutOverlapping()` and `schedule.onOneServer()` now use `Cache.lock()`. Closes the same race for cross-server coordination — across N app boxes ticking the same minute, exactly one will acquire the `onOneServer` lock.
  - Adds `@rudderjs/cache` as an optional peer dependency.

  No public API changes for queue/schedule consumers.

- Updated dependencies [0420c1e]
- Updated dependencies [6c03c74]
- Updated dependencies [3ccac5d]
- Updated dependencies [5447fa9]
- Updated dependencies [a0b96f9]
- Updated dependencies [ca63e78]
- Updated dependencies [fcca26b]
  - @rudderjs/cache@1.1.0
  - @rudderjs/core@1.1.0
  - @rudderjs/router@1.1.0

## 4.1.0

### Minor Changes

- 8689218: **`@rudderjs/horizon`** — Fix the BullMQ correctness bug where every job appeared stuck at `pending` forever on the dashboard, even after the worker terminal logged `✓ completed` / `✗ failed`.

  Two stacked architectural bugs are fixed in one change:

  1. `JobCollector` was monkey-patching `dispatch()` and mutating `job.handle` on the in-memory `Job` instance. BullMQ serializes the job via `JSON.parse(JSON.stringify(job))` and reconstructs a fresh instance in the worker process — so the wrapped handler that was supposed to flip status to `processing` / `completed` / `failed` lived only in the dispatcher's heap and was never reached.
  2. `MemoryStorage` is per-process. The dev/web process and the worker process held separate in-memory arrays with no path to share state; even if the wrap had survived, the dashboard process couldn't see what the worker recorded.

  **Fix shape:**

  - `@rudderjs/queue` now exposes a `@rudderjs/queue/observers` subpath — a `QueueObserverRegistry` singleton on `globalThis` that adapters emit lifecycle events to. Same pattern as `@rudderjs/mcp/observers`, `@rudderjs/http/observers`, etc.
  - The built-in `SyncAdapter` and `@rudderjs/queue-bullmq`'s `BullMQAdapter` emit `job.dispatched` / `job.active` / `job.completed` / `job.failed` events at the right lifecycle points. BullMQ emits `active` from the worker process via `processor()`, and `completed` / `failed` via `worker.on(...)` — the exact transitions that previously didn't reach the dashboard.
  - `@rudderjs/horizon` adds a third storage driver, `RedisStorage`, alongside `MemoryStorage` and `SqliteStorage`. The `JobCollector` is rewritten to subscribe to `queueObservers` instead of monkey-patching the adapter — observer events emitted in the worker process flow through Redis to the dashboard process.
  - `WorkerCollector` only self-registers when `RUDDERJS_QUEUE_WORKER=1` is set. The CLI sets it before booting providers when running `queue:work`, and the BullMQ adapter sets it again defensively before instantiating `Worker`s — so the dev/web process no longer lists itself as a worker.
  - `HorizonProvider.boot()` warns when `queue: bullmq` + `horizon.storage: memory` is detected, surfacing the misconfig before it manifests as a dead dashboard.

  **Migration:**

  If you're using `@rudderjs/queue-bullmq`, switch `config/horizon.ts` to:

  ```ts
  import { Env } from "@rudderjs/core";
  import type { HorizonConfig } from "@rudderjs/horizon";

  export default {
    storage: "redis",
    redis: {
      url: Env.get("REDIS_URL", ""),
      host: Env.get("REDIS_HOST", "127.0.0.1"),
      port: Env.getNumber("REDIS_PORT", 6379),
      password: Env.get("REDIS_PASSWORD", ""),
      prefix: "rudderjs",
    },
    // … rest of config unchanged
  } satisfies HorizonConfig;
  ```

  `ioredis` is now an optional dep — if you have `@rudderjs/queue-bullmq` installed, you already have it.

  If you're on the `sync` driver, no migration needed — `MemoryStorage` continues to work and `'memory'` stays the default.

  **Why a major bump:** the storage interface adds a third driver, the config interface adds `redis`, and the runtime path for BullMQ users changes meaningfully. The public `Horizon` facade (`recentJobs()` / `failedJobs()` / etc.) is unchanged.

  **`@rudderjs/queue`** — additive: new `@rudderjs/queue/observers` subpath. `SyncAdapter.dispatch()` now emits four lifecycle events. Existing consumers that don't subscribe see no behavior change.

  **`@rudderjs/queue-bullmq`** — emits the same lifecycle events from the dispatcher and worker processes. Sets `RUDDERJS_QUEUE_WORKER=1` before instantiating BullMQ `Worker`s.

  **`@rudderjs/cli`** — sets `RUDDERJS_QUEUE_WORKER=1` when argv includes `queue:work`, before booting providers, so cross-cutting collectors can self-register at the right time.

  Pulse's queue recorder has the same architecture as the old horizon JobCollector and currently misses BullMQ worker-side events too. Documented as a known limitation in pulse's README; fix deferred to a follow-up that subscribes the recorder to `queueObservers`.

  Plan: `docs/plans/2026-05-01-horizon-bullmq-fix.md`

## 4.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0
  - @rudderjs/router@1.0.0

## 3.0.2

### Patch Changes

- 5ca3e29: Fix type-system contravariance errors that rejected common subclass patterns.

  **`@rudderjs/queue`** — `Job.dispatch`'s `this: new (...args: unknown[]) => T` constraint rejected every subclass with a typed constructor (`constructor(public name: string, public email: string)`). Parameter types are contravariant, so a narrower signature can't satisfy `unknown[]`. Relaxed to `new (...args: any[]) => T`; `ConstructorParameters<typeof this>` still enforces arg-level type safety at the call site.

  **`@rudderjs/auth`** — `Gate.define(ability, callback)` accepted only `(user, ...args: unknown[])` callbacks. A typed callback like `(user, post: Post) => …` failed the same contravariance check. Made `Gate.define` generic on the args tuple so callers can narrow without casting:

  ```ts
  Gate.define<[Post]>("edit-post", (user, post) => user.id === post.authorId);
  ```

  The stored callback is widened to the internal `AbilityCallback` type; narrowing only matters at the call site.

  Both fixes add regression tests covering the subclass-constructor / typed-arg patterns. No runtime behavior change — pure typing fix.

## 3.0.1

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 3.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0

## 2.0.1

### Patch Changes

- dc37411: Ship `boost/guidelines.md` in the published npm tarball. Adds `"boost"` to the `files` field so downstream `boost:install` in consumer projects finds the per-package AI coding guidelines.
- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/core@0.0.12

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10

## 0.0.6

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/core@0.0.9
  - @rudderjs/router@0.0.4

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.5

## 0.0.2

### Patch Changes

- @rudderjs/core@0.0.4
- @rudderjs/router@0.0.3
