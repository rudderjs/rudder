---
'@rudderjs/horizon': major
---

Fix two bugs surfaced during browser-verify of the BullMQ correctness fix (5.0.0):

**Bug A — id collision across queues.** BullMQ assigns job ids per-queue starting at 1, so `default:1` and `priority:1` collided on the single-id storage key (`jobs:{id}`) and overwrote each other. Storage records are now keyed by `(queue, id)`:

- Storage interface: `findJob(queue, id)`, `updateJob(queue, id, ...)`, `deleteJob(queue, id)`. Same change reflected on the `Horizon` facade.
- Redis storage: job hashes at `jobs:{queue}:{id}`; `recent` and `failed` ZSet members are `{queue}:{id}`.
- SQLite storage: bumped table to `horizon_jobs_v2` with composite `PRIMARY KEY (queue, id)`. v1 table is left in place — old data ages out via `pruneAfterHours`.
- API routes: `GET/POST/DELETE /horizon/api/jobs/:queue/:id` (was `/:id`). UI builds detail-page URLs from `queue` + `id`.

Also fixes a race in `RedisStorage.recordJob` — the dashboard process emits `job.dispatched` and writes via microtask, so a fast worker process could update the record to `completed` before the dashboard's write landed, and a plain HSET would overwrite the worker's status with `pending`. Lifecycle fields (`status`, `attempts`, `startedAt`, `completedAt`, `duration`, `exception`) are now written with HSETNX so worker updates always win.

**Bug B — duplicated MetricsCollector across processes.** The dashboard process and worker process both polled `MetricsCollector.collect()` every interval and wrote to the shared Redis `metrics:{queue}:current` hash. The dashboard's empty counters (BullMQ events fire only in the worker) clobbered the worker's writes. `MetricsCollector.register()` is now gated to the worker process for out-of-process queue drivers (BullMQ); the sync driver still registers in the dashboard process because dashboard and worker are the same process.

This is a major bump because the storage interface, the API URL shape, and the Redis/SQLite key schema all change. Apps consuming `Horizon.findJob(...)` or hitting `/horizon/api/jobs/:id` need to migrate to the new `(queue, id)` shape.
