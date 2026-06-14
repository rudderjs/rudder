---
"@rudderjs/horizon": patch
---

Two fixes:

- **Failed-job count no longer over-counts after a retry.** On the Redis store, `updateJob` only removed a job from the `failed` ZSet on a `completed` transition. A retry sets the status back to `pending`, so the member lingered and `jobCount('failed')` stayed inflated forever while the listing (which re-filters by status) showed one fewer. Any non-failed transition now clears the failed set.
- **Worker uptime is stable.** `WorkerCollector` recomputed `startedAt` with `new Date()` on every report, so each tick overwrote the stored start time and uptime always read ~0. The start time is now captured once when the collector is created.
