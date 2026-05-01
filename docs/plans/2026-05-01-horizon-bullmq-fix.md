# Horizon — BullMQ correctness fix

**Status:** Draft 2026-05-01, awaiting Suleiman's nod
**Discovered:** 2026-05-01 during browser-verify of horizon (PR #144). Worker terminal was processing jobs cleanly, but `/horizon` showed every job stuck at `pending` 23s after dispatch. Two stacked architectural bugs.

## Symptom

```
# /test/horizon dispatches 4 jobs across default + priority queues
# pnpm rudder queue:work default,priority

[BullMQ] Worker ready — queues: "default, priority", concurrency: 1
[WelcomeUserJob] Sending welcome email to Alice <alice@example.com>
[BullMQ] ✓ "WelcomeUserJob" completed (queue: default, id: 9)
[BullMQ] ✗ "FailingJob"     failed    (attempt 1/1): Crash on purpose
…
```

Dashboard at `/horizon`:

```
FailingJob       default   pending   —   23s ago
WelcomeUserJob   priority  pending   —   23s ago
WelcomeUserJob   default   pending   —   23s ago
WelcomeUserJob   default   pending   —   23s ago
```

Every job permanently `pending`, even after the worker logs `✓ completed` / `✗ failed`. Failed jobs never appear on `/horizon/jobs/failed`. Queue/metrics cards stay empty. Workers list shows the **dev server**, not the actual `pnpm rudder queue:work` process.

## Root cause — two stacked bugs

### Bug 1 — `JobCollector` monkey-patches an instance that never crosses Redis

`packages/horizon/src/collectors/job.ts:21–84` wraps the `dispatch()` method on the active `QueueAdapter`. Inside the wrapper it mutates `job.handle` on the **in-memory Job instance**, then forwards to the original dispatch:

```ts
;(adapter as unknown as Record<string, unknown>)['dispatch'] = async (job, options) => {
  // … recordJob({ status: 'pending', … })
  job.handle = async () => { /* updateJob(id, { status: 'processing'/'completed'/'failed' }) */ }
  await originalDispatch(job, options)
}
```

This works for the **sync** adapter (same process, same instance, wrapped function survives until `handle()` is called). For **BullMQ** it does nothing useful:

1. Dispatcher serializes the job via `JSON.parse(JSON.stringify(job))` — see `packages/queue-bullmq/src/index.ts:136`. **Functions are not JSON; the wrapped `handle` is dropped on the wire.**
2. Worker process pulls the job from Redis, calls `Object.assign(new JobClass(), bullJob.data)` — a brand new instance with the original prototype `handle()` (`packages/queue-bullmq/src/index.ts:107`).
3. The wrap that was supposed to flip status from `pending` → `processing` → `completed`/`failed` lives only in the dispatcher's heap, on an object the worker never sees.

**Result:** the `recordJob()` write happens at dispatch time (`pending`), then nothing ever updates it.

### Bug 2 — `MemoryStorage` is process-local

`packages/horizon/src/storage.ts:9` keeps jobs/metrics/workers in private arrays/Maps on a single instance. The dev server has one instance; the worker process (when it boots `HorizonProvider` via `defaultProviders()`) has another. They cannot see each other.

So even if Bug 1 were fixed and the worker process correctly recorded `completed`/`failed`, the **dashboard process serving `/horizon`** would still be reading the in-memory array it holds — which only ever saw `pending` writes.

`SqliteStorage` (also in `storage.ts`) is technically cross-process if both processes open the same `.sqlite` file, but: (a) BullMQ already mandates Redis, so adding SQLite as a sync mechanism is a second persistence layer for no reason; (b) SQLite locking under concurrent `INSERT`/`UPDATE` from a busy worker + a polling dashboard is a footgun.

## Why this slipped through

- Tests in `packages/horizon/src/index.test.ts` use `MemoryStorage` + a fake adapter, both in the same process — Bug 1 never trips because the wrapped `handle` is reachable, and Bug 2 never trips because there's only one process.
- Browser-verify in PR #144 was deferred to Suleiman per memory note `project_horizon_pulse_pennant_untested.md`.
- The CLI flag bug (`--queue=` vs positional) hid this for the first 30s of testing — once the worker subscribed to the wrong queue name, it looked like a queue-routing problem, not a horizon problem.

## Fix shape

Three layers, in dependency order. Land as one PR (the layers are too interdependent to split cleanly without a half-broken intermediate state).

### Layer 1 — Adapter observer surface (`@rudderjs/queue`)

Mirror the proven `globalThis` singleton + subpath export pattern from `mcp/observers.ts`, `gate/observers.ts`, `http/observers.ts` (see `reference_observer_registry_pattern.md`).

```ts
// packages/queue/src/observers.ts (new)
export interface QueueJobEvent {
  jobId:    string                       // adapter-assigned id (BullMQ id, UUID for sync)
  name:     string                       // job class name
  queue:    string
  payload:  Record<string, unknown>      // safeSerialize'd
  attempts: number
  dispatchedAt: Date
}

export interface QueueJobLifecycleEvent extends QueueJobEvent {
  startedAt?:   Date
  completedAt?: Date
  duration?:    number                   // ms
  exception?:   string                   // failed only
}

export interface QueueObserver {
  onJobDispatched?(e: QueueJobEvent): void | Promise<void>
  onJobActive?(e: QueueJobLifecycleEvent): void | Promise<void>
  onJobCompleted?(e: QueueJobLifecycleEvent): void | Promise<void>
  onJobFailed?(e: QueueJobLifecycleEvent): void | Promise<void>
}

class QueueObservers {
  private observers: QueueObserver[] = []
  add(o: QueueObserver): () => void { /* push + return unsub */ }
  // notify methods catch+log per-observer errors, never throw upward
  async notifyDispatched(e: QueueJobEvent) { /* … */ }
  // … notifyActive, notifyCompleted, notifyFailed
}

const KEY = '__rudderjs_queue_observers__' as const
export const queueObservers: QueueObservers =
  ((globalThis as Record<string, unknown>)[KEY] ??=
    new QueueObservers()) as QueueObservers
```

Subpath export: `@rudderjs/queue/observers`. Telescope and horizon import from there; user code wouldn't typically.

### Layer 2 — Adapter emissions

**SyncAdapter** (`packages/queue/src/sync-adapter.ts` or wherever it lives):

```ts
async dispatch(job: Job, options?: DispatchOptions) {
  const e = buildEvent(job, options)
  await queueObservers.notifyDispatched(e)
  const startedAt = new Date()
  await queueObservers.notifyActive({ ...e, startedAt })
  try {
    await job.handle()
    const completedAt = new Date()
    await queueObservers.notifyCompleted({ ...e, startedAt, completedAt, duration: completedAt.getTime() - startedAt.getTime() })
  } catch (err) { /* notifyFailed; rethrow as today */ }
}
```

**BullMQ adapter** (`packages/queue-bullmq/src/index.ts`):

```ts
async dispatch(job, options) {
  // … existing add() call …
  const bullJob = await this.getQueue(queueName).add(name, data, opts)
  await queueObservers.notifyDispatched({ jobId: String(bullJob.id), name, queue: queueName, … })
}

private async processor(bullJob) {
  // … resolve JobClass, hydrate instance …
  await queueObservers.notifyActive({ jobId: String(bullJob.id), … startedAt: new Date() })
  await instance.handle()
  // completion notify happens in worker.on('completed') — see below
}

// in work():
worker.on('completed', async (bullJob) => {
  await queueObservers.notifyCompleted({
    jobId: String(bullJob.id),
    name:  bullJob.name,
    queue,
    payload:     bullJob.data,
    attempts:    bullJob.attemptsMade,
    dispatchedAt: new Date(bullJob.timestamp),
    startedAt:    bullJob.processedOn ? new Date(bullJob.processedOn) : new Date(),
    completedAt:  bullJob.finishedOn  ? new Date(bullJob.finishedOn)  : new Date(),
    duration:     (bullJob.finishedOn ?? Date.now()) - (bullJob.processedOn ?? Date.now()),
  })
  console.log(`[BullMQ] ✓ "${bullJob.name}" completed …`) // existing log stays
})

worker.on('failed', async (bullJob, error) => {
  if (!bullJob) return
  await queueObservers.notifyFailed({ /* … exception: error.message */ })
  // existing failed() callback + console.error
})
```

**Inngest:** out of scope — Inngest runs jobs externally and reports back via webhook; integrating its lifecycle is a separate piece of work and Inngest users don't typically use horizon (they have Inngest's own dashboard).

### Layer 3 — Cross-process storage (`@rudderjs/horizon`)

Add `RedisStorage` as a third `HorizonStorage` driver alongside `MemoryStorage` / `SqliteStorage`. Why Redis specifically:

1. BullMQ already requires Redis. No new infrastructure cost.
2. Horizon dashboards only make sense alongside a real worker daemon, which by definition means BullMQ + Redis.
3. Keeps horizon's storage abstraction symmetric — a driver, not a magic side path.

Storage layout (Redis keys all prefixed by `horizon:` under the BullMQ prefix, default `rudderjs:horizon:…`):

| Key                                   | Type   | Purpose                                  |
|---------------------------------------|--------|------------------------------------------|
| `horizon:jobs:{id}`                   | Hash   | Single HorizonJob record                 |
| `horizon:jobs:recent`                 | ZSet   | `dispatchedAt` → `id`, capped via maxJobs |
| `horizon:jobs:failed`                 | ZSet   | `dispatchedAt` → `id`, status='failed'    |
| `horizon:jobs:by-queue:{queue}`       | ZSet   | Per-queue index                          |
| `horizon:metrics:{queue}:current`     | Hash   | Latest QueueMetric                       |
| `horizon:metrics:{queue}:history`     | ZSet   | `ts` → JSON metric, capped to 1440 (24h) |
| `horizon:workers:{id}`                | Hash   | WorkerInfo                               |
| `horizon:workers`                     | Set    | Worker IDs                               |

`pruneOlderThan()` evicts via `ZRANGEBYSCORE` + `DEL`. Capping happens in `recordJob` via `ZADD` + `ZCARD` + `ZREMRANGEBYRANK`.

Config:

```ts
// config/horizon.ts
export default {
  storage: 'redis',                              // default 'memory' for sync driver
  redis:   { url: process.env.REDIS_URL,         // reuse BullMQ env vars if present
             prefix: 'rudderjs' },
  maxJobs: 1000,
  pruneAfterHours: 24,
  metricsIntervalMs: 60_000,
} satisfies HorizonConfig
```

`HorizonProvider.boot()` resolves `storage: 'redis'` to a new `RedisStorage` instance backed by `ioredis`. `ioredis` is already a transitive dep via `bullmq`, but list it explicitly so the type imports work.

### Layer 4 — Bind it all together

In `HorizonProvider.boot()`:

```ts
HorizonRegistry.set(storage)

queueObservers.add({
  onJobDispatched: (e) => storage.recordJob({ id: e.jobId, status: 'pending', … }),
  onJobActive:     (e) => storage.updateJob(e.jobId, { status: 'processing', startedAt: e.startedAt, attempts: e.attempts }),
  onJobCompleted:  (e) => {
    storage.updateJob(e.jobId, { status: 'completed', completedAt: e.completedAt, duration: e.duration })
    metricsCollector.recordJobCompleted(e.queue, /* waitTime */ e.startedAt!.getTime() - e.dispatchedAt.getTime(), e.duration ?? 0)
  },
  onJobFailed:     (e) => {
    storage.updateJob(e.jobId, { status: 'failed', completedAt: e.completedAt, duration: e.duration, exception: e.exception })
  },
})
```

`JobCollector` (the `register()` method that monkey-patches `adapter.dispatch`) is **deleted**. The class itself can stay for now as a thin compatibility shim for anything that imports it, but the `register()` body becomes a no-op. Move the file's exported types (if any) and remove the wrap entirely.

### Layer 5 — WorkerCollector reports the right process

`WorkerCollector` currently records the **current process** as a worker. In normal RudderJS app boot, that's the dev server — **not** a worker. Two changes:

1. Skip self-registration in non-worker processes. Detect via an env var the queue:work command sets, e.g. `RUDDERJS_QUEUE_WORKER=1` (set in `bullmq adapter.work()` and inherited by the rudder CLI worker subprocess if any).
2. The `pnpm rudder queue:work` command path should ensure `HorizonProvider.boot()` runs in the worker process so the WorkerCollector + observers actually subscribe. Today `bootApp()` is skipped for some commands (see `feedback_cli_skip_boot_for_tooling.md`) — `queue:work` already boots, but verify the provider stage finishes before `adapter.work()` blocks the event loop.

## Decisions (locked)

1. **One PR, three layers.** Splitting leaves intermediate states where horizon is more broken (e.g. observer surface added but storage not cross-process — UI still shows wrong data). The blast radius of a single contained PR is smaller than a multi-PR migration.
2. **`storage: 'redis'` is opt-in but recommended for BullMQ.** We could auto-flip the default when `queue.default === 'bullmq'` is detected, but that ties horizon's config to queue config and surprises users. Default stays `memory`; docs make Redis storage the unambiguous recommendation when running real workers; emit a one-line warning at boot if `queue: bullmq` + `horizon.storage: memory` is detected (`[Horizon] You're using BullMQ but horizon storage is 'memory' — the dashboard won't see worker-process events. Set horizon.storage='redis' to enable cross-process tracking.`).
3. **No data migration from `MemoryStorage` to `RedisStorage`.** Memory is by definition ephemeral. New install, fresh dashboard.
4. **Reuse BullMQ's Redis connection config shape.** Same `url` / `host` / `port` / `password` / `prefix` fields. Most projects will set `REDIS_URL` once and want both packages to read it.
5. **Don't break `JobCollector` import path.** Keep the export, neuter the body. External code (unlikely but possible) keeps compiling. Add a deprecation comment pointing at `queueObservers`.
6. **Major bump on `@rudderjs/horizon`.** Storage interface adds methods; provider behavior changes meaningfully even though the public API of the facade (`Horizon.recentJobs()` etc.) stays. Cleaner to call it 2.0 than to ship "1.x but only really works if you change config." Per `project_1x_graduation.md` semantics — internal restructure with config implications justifies a major.
7. **Minor bump on `@rudderjs/queue` + `@rudderjs/queue-bullmq`.** New observer subpath is additive; emissions don't change existing adapter consumer behavior.
8. **No companion fix for `@rudderjs/pulse`.** Pulse's `QueueRecorder` has the same architecture (wraps `dispatch`), so it also misses BullMQ worker-side events. **Document the limitation in pulse's README** ("queue throughput in pulse currently reflects the dispatching process only — for worker-side metrics, install horizon"), defer the actual fix to a follow-up. Pulse aggregates request-process metrics primarily; missing worker-emit data is a known asterisk, not a blocker. Same `queueObservers` surface lets us fix it later by subscribing the recorder.
9. **No companion fix for `@rudderjs/telescope`.** Telescope's job collector records dispatch + handler invocation in the dispatching process — for sync that's complete, for BullMQ telescope already has the same blind spot but **the doc copy explicitly frames telescope as request-correlated**, not worker-process introspection (that's horizon's job). Don't change telescope behavior in this PR; revisit if worker-side telescope entries become a real ask.

## Phases

1. **`@rudderjs/queue/observers` subpath.** New file, new export, no behavior change to existing code. Tests: subscribe + emit in isolation.
2. **SyncAdapter emissions.** Wire `notifyDispatched`/`notifyActive`/`notifyCompleted`/`notifyFailed` into `dispatch()`. Tests: subscribe an observer, dispatch through sync, assert all four events fire in order with the right shapes.
3. **BullMQAdapter emissions.** Wire into `dispatch()` + `processor()` + `worker.on('completed' | 'failed')`. Tests: existing bullmq integration test suite has a real Redis setup — extend with observer assertion.
4. **`@rudderjs/horizon` `RedisStorage` driver.** New file. Tests: identical surface contract to `MemoryStorage` + `SqliteStorage` (re-run the storage interface test suite with all three drivers via a `describe.each`). Requires Redis in CI — already present for queue-bullmq tests.
5. **`HorizonProvider` rewire.** Replace `JobCollector.register()` body with `queueObservers.add(…)` subscriptions. Delete the `dispatch` monkey-patch. Tests: end-to-end test using `FakeQueueAdapter` that emits observer events directly (no real BullMQ) — assert `MemoryStorage` reflects the right state transitions.
6. **WorkerCollector worker-process gating.** Add env-var check; bullmq adapter sets `RUDDERJS_QUEUE_WORKER=1` before instantiating `Worker`s. Tests: dev-process boot doesn't register a worker entry; worker-process boot does.
7. **Boot warning for misconfig.** `[Horizon] BullMQ + memory storage detected — dashboard won't see worker events. Switch to storage: 'redis'.` Tests: warning fires once, with bullmq + memory; no warning with bullmq + redis or sync + memory.
8. **Playground exercise.** Update `playground/config/horizon.ts` to default `storage: 'redis'` (gated on `process.env.QUEUE_CONNECTION === 'bullmq'`). Re-run `/test/horizon` flow end to end with real BullMQ + worker. Confirm UI populates, failed jobs appear, queue/metrics/worker cards are alive.
9. **Docs.** Update `docs/packages/horizon.md` + sync to rudderjs-com. New section: **"Storage drivers — when to use which"**. Add a callout in `docs/packages/queue.md` mentioning the observer subpath for advanced users.
10. **Changesets.** `@rudderjs/horizon` major. `@rudderjs/queue` + `@rudderjs/queue-bullmq` minor. (Sync between them is the existing peer-version dance — see `feedback_changesets_workspace_caret.md`.)

## Out of scope

- Pulse fix (deferred — see Decision #8).
- Telescope fix (deferred — see Decision #9).
- Inngest observer emissions.
- A queue-driver-agnostic worker registry (multiple workers across hosts reporting to one dashboard). For now, one worker per node, tracked in Redis under its own `workers:{id}` key — fine for v1.
- Horizon SQLite storage cross-process testing. SQLite storage stays single-process; recommend Redis for worker scenarios.
- Designing observer middleware (e.g. transform/skip events). Add when there's a real use case.

## Open questions

1. Do we need a `notifyRetrying` event? BullMQ retries are surfaced as a fresh `attemptsMade` on the same job id, observable through `failed` + a subsequent `active`. Probably no — the existing four cover it. Punt unless someone asks.
2. Should `RedisStorage` share the BullMQ Redis connection or open a new one? Sharing saves one connection but couples lifecycle (closing horizon shouldn't close BullMQ's connection). Default to a separate connection with the same config; document override if someone wants to share.
3. `MetricsCollector.recordJobCompleted` is currently called from inside `JobCollector` — after Layer 4, it's called from the observer. Should the metrics collector subscribe directly to `queueObservers` instead, fully decoupling it from the job collector? Yes, probably — clean refactor follow-up. Keep the indirect call in this PR to minimize blast radius, then refactor in a small follow-up.

## References

- Bug locations: `packages/horizon/src/collectors/job.ts:21–84`, `packages/horizon/src/storage.ts:9`, `packages/queue-bullmq/src/index.ts:107`, `:136`, `:180–198`
- Observer pattern reference: `packages/mcp/src/observers.ts` + `packages/telescope/src/collectors/mcp.ts` (the canonical clone target per `reference_observer_registry_pattern.md`)
- Memory: `project_horizon_pulse_pennant_untested.md` (the "browser-verify still owed" note that surfaced this), `reference_observer_registry_pattern.md`
- Prior horizon UI work: `docs/plans/2026-05-01-horizon-pulse-view-migration.md`, PR #144
- Related: `project_1x_graduation.md` (major-version posture for opt-in feature packages)
