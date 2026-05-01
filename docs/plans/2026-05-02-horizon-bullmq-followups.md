# Horizon — BullMQ follow-ups (id collision + metrics propagation)

**Status:** Draft 2026-05-02, awaiting Suleiman's nod
**Discovered:** 2026-05-02 during browser-verify of the #149 fix. Single-queue scenarios populate correctly; multi-queue scenarios drop records, and `/horizon/api/queues` stays empty for the first metrics interval.

## What the verify exercise found

```bash
# Terminal 1: pnpm dev
# Terminal 2: pnpm rudder queue:work default,priority
# Terminal 3: curl /test/horizon
```

Worker terminal correctly logs all 4 jobs:

```
[BullMQ] ✓ "WelcomeUserJob" completed (queue: default,  id: 1)   ← Alice
[BullMQ] ✓ "WelcomeUserJob" completed (queue: default,  id: 2)   ← Bob
[BullMQ] ✓ "WelcomeUserJob" completed (queue: priority, id: 1)   ← VIP
[BullMQ] ✗ "FailingJob"     failed    (queue: default,  id: 3)   ← FailingJob
```

But `/horizon/api/stats` reports `total: 3` — Alice's record is gone. Recent-jobs API confirms only one record exists at id `1`, holding VIP's data. Bob (default:2) shows `status: pending` despite the worker completing it. `/horizon/api/queues` returns `data: []`.

## Bug A — Job id collision across queues

### Root cause

`packages/horizon/src/storage.ts:421` keys job records by id alone:

```ts
job: (id: string) => `${this.prefix}:jobs:${id}`,
```

BullMQ assigns ids per-queue starting at `1`. So `default:1` (Alice's `WelcomeUserJob`) and `priority:1` (VIP's `WelcomeUserJob`) both write to the same Redis hash key `rudderjs:horizon:jobs:1`. Whichever event arrives second overwrites the first.

The same applies to `MemoryStorage` (which uses a `Map<id, HorizonJob>`) and `SqliteStorage` (single-column primary key), but their use cases (sync queue driver, single-process) never trigger the collision in practice.

The "Bob stuck at pending" symptom is a downstream effect of the same bug. The order of writes from BullMQ in our test was:

1. `default:1` dispatched → record A written
2. `priority:1` dispatched → record A overwritten by VIP's pending record
3. `default:2` dispatched → record B (Bob) written
4. `default:1` active → updates record at `id: 1` (now VIP's), sets `startedAt`
5. `priority:1` active → updates record at `id: 1` (still VIP's), sets `startedAt`
6. `default:1` completed → updates record at `id: 1` (still VIP's, queue tag wrong) to completed
7. `default:2` active → tries to update id `2`, but the order may interleave with #8
8. `default:2` completed → tries to update id `2`

The `priority:1` and `default:1` events overwrite each other unpredictably. When two `WelcomeUserJob`s on the same queue race against a worker concurrency boundary, you can see `id: 2` end up in `pending` because the active/completed events fire while the dispatched event is still being written async.

### Fix shape

Namespace the storage key by **queue + id**, not id alone. Mirror what BullMQ itself does internally (`bull:{queue}:{id}` in Redis). Two layers:

#### Layer A1 — Storage key + index changes

`packages/horizon/src/storage.ts`:

```ts
// Composite key. We store the original adapter-id on the record but the
// storage primary key is `{queue}:{id}` to dodge cross-queue collisions.
private jobKey(queue: string, id: string): string {
  return `${this.prefix}:jobs:${queue}:${id}`
}

// All callers that previously took (id) now take (queue, id):
async recordJob(job: HorizonJob): Promise<void>          // already has both
async updateJob(queue: string, id: string, patch): Promise<void>
async getJob(queue: string, id: string): Promise<HorizonJob | null>
async deleteJob(queue: string, id: string): Promise<void>

// `recent` and `failed` ZSets store members as `{queue}:{id}` so the API
// that reads them can split + look up the underlying job hash:
async recent(opts): Promise<HorizonJob[]>  // unchanged signature; member parse internal
```

The public `HorizonJob` shape gains nothing — `id` and `queue` are already on it. Only the storage indirection changes.

#### Layer A2 — Observer event payload already carries `queue`

`packages/queue/src/observers.ts` already includes `queue` in every event (`QueueJobEvent`/`QueueJobLifecycleEvent`). The `JobCollector` in `packages/horizon/src/collectors/job.ts:50–76` needs to pass `event.queue` into the storage update calls:

```ts
case 'job.active':
  await this.storage.updateJob(event.queue, event.jobId, { /* … */ })
```

#### Layer A3 — API routes

`packages/horizon/src/api/routes.ts` `GET /horizon/api/jobs/:id` becomes `GET /horizon/api/jobs/:queue/:id` OR keeps the `:id` shape but accepts `queue:id` as the URL-encoded composite. The first is cleaner; the second avoids a UI route change.

UI: `packages/horizon/views/vanilla/Horizon.{html,ts}` — the recent-jobs table builds detail-page URLs from `job.id`. Update to build from `${job.queue}/${job.id}`.

### Migration

No migration. Anyone running this version of horizon for the first time gets the new key shape; anyone upgrading sees their old per-id records become orphaned (still readable via `recent` ZSet but the lookup fails). Two paths:

1. **Wipe on boot** — RedisStorage detects v1 keys (`jobs:{id}` without a colon in the suffix), logs a one-line warning, and `DEL`s them. Aggressive but cleanest.
2. **Just let them age out** — the existing `pruneAfterHours` cron will evict them within 24-72h.

Pick #2; #1 is too eager and the user's first-load dashboard is mostly populated by new events anyway.

## Bug B — `/horizon/api/queues` empty

### Root cause

`MetricsCollector.collect()` runs on a `metricsIntervalMs` interval (default `60_000` ms in `playground/config/horizon.ts`). The first `collect()` call fires 60 seconds after `register()`. The browser-verify dispatched 4 jobs and read `/queues` within 3 seconds — the interval simply hadn't fired yet. **This part is not a bug.**

The actual bug is downstream: `MetricsCollector` runs in **both** the dashboard process and the worker process (both boot `HorizonProvider`). Both have their own `throughputCounters`/`waitTimeAccum`/`runtimeAccum` Maps. Both fire `collect()` every 60s and write to the same Redis ZSet (`metrics:{queue}:history`). Three problems:

1. **Worker sees throughput, dashboard does not.** `MetricsCollector.recordJobCompleted` is invoked from `JobCollector`'s `case 'job.completed'`. `queueObservers` is in-process (`globalThis` singleton), so the worker's JobCollector handles worker-side completions, and the dashboard's JobCollector handles only what the dashboard process dispatches (which is none in real apps). Worker's `throughputCounters` accumulate; dashboard's stay at 0.
2. **Dashboard publishes `throughput: 0` rows.** The dashboard's `collect()` interval still fires every 60s and writes a `QueueMetric` with `throughput: 0`, partially clobbering the worker's writes.
3. **`adapter.status()` is the only useful source in the dashboard process** — it queries BullMQ's Redis directly for `pending`/`active`/`completed`/`failed`. That bit works regardless of which process runs it.

### Fix shape

Two options. I lean toward **Option 2** for symmetry with the JobCollector fix (subscribe to events, don't poll).

**Option 1 — Gate `MetricsCollector` to the worker process only.**

Same env-var pattern as `WorkerCollector` (Phase 6 of `2026-05-01-horizon-bullmq-fix.md`):

```ts
// HorizonProvider.boot()
if (process.env['RUDDERJS_QUEUE_WORKER'] === '1') {
  metricsCollector.register()  // only the worker process polls
}
```

Pro: minimal change. Con: the dashboard process has no fallback if the worker is dead — `/queues` shows the worker's last write, then nothing.

**Option 2 — Refactor `MetricsCollector` to subscribe to `queueObservers` directly + Redis-shared counters.**

```ts
class MetricsCollector {
  register(): void {
    queueObservers.subscribe((e) => {
      if (e.kind !== 'job.completed') return
      this.bumpRedisCounter(e.queue, e.startedAt, e.completedAt, e.dispatchedAt)
    })
    setInterval(() => this.flush(), this.intervalMs)
  }

  // Counters live in Redis hashes so both processes increment the same key.
  private async bumpRedisCounter(queue, startedAt, completedAt, dispatchedAt) {
    await this.storage.incrementCounter(queue, {
      throughput: 1,
      waitTimeMs: startedAt.getTime() - dispatchedAt.getTime(),
      runtimeMs:  completedAt.getTime() - startedAt.getTime(),
    })
  }

  // Flush reads + clears Redis counters and publishes the QueueMetric snapshot.
  // Only one process should flush (idempotent via SETNX lease).
  private async flush() { /* … */ }
}
```

Pro: the dashboard process can serve `/queues` from cached metrics without depending on the worker being alive. Multiple workers (future) all increment the same Redis counters cleanly.

Con: more code, requires `incrementCounter` on the storage interface and a flush-leader election (SETNX with TTL).

### Recommended path

Ship Option 1 first (one-line fix in `HorizonProvider.boot()`), defer Option 2 until multi-worker support is on the roadmap. The plan's "no companion fix for pulse" decision (Decision #8 in `2026-05-01-horizon-bullmq-fix.md`) sets the precedent — gate the collector to the worker process and document the dashboard-without-worker behavior.

## Decisions (open — Suleiman to confirm)

1. **Bug A fix shape.** Composite key `{queue}:{id}` everywhere, including the API URL. URL change is `/horizon/api/jobs/:id` → `/horizon/api/jobs/:queue/:id`. Acceptable breakage given horizon shipped 5.0.0 yesterday and is opt-in. **Default: yes, change the URL.**
2. **Bug A migration.** Let v1 keys age out via `pruneAfterHours`. **Default: yes, no explicit wipe.**
3. **Bug B option.** Option 1 (gate on `RUDDERJS_QUEUE_WORKER`) ships now; Option 2 deferred. **Default: yes, Option 1.**
4. **Major or minor bump.** Bug A changes the API route shape and the storage key shape on disk. **Default: major (`@rudderjs/horizon@6.0.0`).** Pulse + horizon are both opt-in feature packages; the cascade-noise calculus from `feedback_new_packages_at_1_0.md` doesn't apply since they're already at 5.x/4.x. Cleaner than gating bug fixes behind compat shims.
5. **One PR or split.** One PR, two commits — Bug A and Bug B are independent but small enough to land together. Same blast radius as the original fix. **Default: one PR.**

## Phases

1. **Storage key namespacing** — RedisStorage + MemoryStorage + SqliteStorage all gain `(queue, id)` accessors. Update internal Maps + tables to match. Keep `recordJob(job)` signature; the storage derives the composite key from `job.queue + job.id`. Tests: dispatch two jobs with the same `id` on different queues, assert both records survive.
2. **JobCollector pass-through** — update event handlers to pass `event.queue` into storage calls.
3. **API route + UI URL update** — `/horizon/api/jobs/:queue/:id` everywhere; UI builds detail links from `${queue}/${id}`.
4. **Browser-verify Bug A** — re-run the multi-queue test from `2026-05-01-horizon-bullmq-fix.md`'s Phase 8. Expect `total: 4`.
5. **Gate `MetricsCollector` on `RUDDERJS_QUEUE_WORKER`** — one-line conditional in `HorizonProvider.boot()`. Document in `docs/packages/horizon.md`.
6. **Browser-verify Bug B** — restart, dispatch jobs, wait 60s, expect `/queues` to show one row per queue with non-zero throughput.
7. **Lower the playground's `metricsIntervalMs`** to `5_000` so future browser-verify runs don't have to wait a minute. Production default stays 60s.
8. **Changesets** — `@rudderjs/horizon` major. No queue / queue-bullmq changes.
9. **Docs sync** — same 4-step sweep into rudderjs-com after release.

## Out of scope

- Multi-worker leader election for `MetricsCollector.flush()` (Option 2 above).
- Pulse's parallel architecture problem — still deferred per the original plan's Decision #8.
- Telescope job correlation — same deferral, same reasoning.
- A first-class HorizonStorage v1→v2 key migration. The 24-72h prune cycle handles it.

## References

- Bug A location: `packages/horizon/src/storage.ts:421` (`job: (id) => …`)
- Bug B location: `packages/horizon/src/index.ts:151` (unconditional `metricsCollector.register()`)
- Original plan: `docs/plans/2026-05-01-horizon-bullmq-fix.md`
- Verify session: 2026-05-02 — see chat transcript for raw API output
