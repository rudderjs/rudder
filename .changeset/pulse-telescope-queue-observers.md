---
"@rudderjs/telescope": minor
"@rudderjs/pulse": minor
---

Migrate Telescope `JobCollector` and Pulse `QueueRecorder` from the legacy `dispatch()` monkey-patch to `queueObservers.subscribe()` (the cross-process event surface shipped in `@rudderjs/queue@4.1.0` for Horizon).

**Why it matters under BullMQ:** the old wrapper only ran in the dispatching process, so worker-side `completed` and `failed` events were invisible. Telescope showed jobs as `dispatched` with no follow-up; Pulse `queue_throughput` undercounted and `queue_wait_time` actually measured enqueue duration, not the queue-to-active wait.

**Behavior changes:**

- **Telescope** — now records one entry per terminal lifecycle state (`dispatched` from the dispatcher process, `completed`/`failed` from the worker process). Each entry carries `jobId`, so dispatcher and worker rows for the same job correlate by id. Sync driver still records the same data, just routed through the observer instead of a wrapped method.
- **Pulse** — `queue_wait_time` now records `startedAt - dispatchedAt` on `job.active` (true wait time). `queue_throughput` increments on terminal states (`completed` / `failed`), not on enqueue, so the metric is jobs-per-minute *processed*. `failed_job` entries gain `queue`, `jobId`, and `attempts` fields.

No config changes required — both collectors auto-register as before. For BullMQ users, this is the visibility fix you'd expect to hit when first wiring up Pulse/Telescope against a real worker.
