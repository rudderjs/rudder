# @rudderjs/horizon — AI Coding Guidelines

## What This Package Does

Horizon is a deep queue monitoring tool for RudderJS applications. It goes beyond basic job recording (Telescope) to provide full job lifecycle tracking, per-queue metrics, worker status, and failed job management (retry/delete).

## Architecture

Three collectors:
1. **JobCollector** — Wraps `QueueAdapter.dispatch()` to track full job lifecycle (pending → processing → completed/failed)
2. **MetricsCollector** — Periodically snapshots per-queue stats: throughput, wait time, runtime, pending/active/completed/failed counts
3. **WorkerCollector** — Reports current process as a worker with memory usage and job counts

### File Layout

- `src/index.ts` — `HorizonProvider`, `Horizon` facade, `HorizonRegistry`, public re-exports
- `src/types.ts` — `HorizonJob`, `QueueMetric`, `WorkerInfo`, `HorizonStorage`, `HorizonConfig`
- `src/storage.ts` — `MemoryStorage`, `SqliteStorage`
- `src/collectors/` — three collector classes (job, metrics, worker)
- `src/routes.ts` — `registerHorizonRoutes(storage, opts)` — UI + API route registration. Mirrors `@rudderjs/telescope`'s `registerTelescopeRoutes()`.
- `src/api/routes.ts` — pure handler functions (`getStats`, `listRecentJobs`, `retryJob`, `authMiddleware`, …) called from `routes.ts`. Holds no router calls.
- `src/views/vanilla/` — UI pages (one file per page): `Layout`, `Dashboard`, `RecentJobs`, `FailedJobs`, `Queues`, `Workers`, `_html` (auto-escape helper), `_jobTable` (shared table partial).

## Key Patterns

- `HorizonJob` records the full lifecycle: dispatchedAt, startedAt, completedAt, duration, exception
- Metrics are collected at configurable intervals (default 60s) and stored per-queue
- Worker status is self-reported from the current process
- Failed jobs can be retried via the API (delegates to `QueueAdapter.retryFailed()`)
- Uses `@rudderjs/queue` as a direct dependency (not optional)

## API Endpoints

- `GET /horizon/api/stats` — Overview (job counts, queue metrics, worker count)
- `GET /horizon/api/jobs/recent` — Recent jobs with filtering
- `GET /horizon/api/jobs/failed` — Failed jobs list
- `GET /horizon/api/jobs/:id` — Job detail
- `POST /horizon/api/jobs/:id/retry` — Retry a failed job
- `DELETE /horizon/api/jobs/:id` — Delete a job record
- `GET /horizon/api/queues` — Current metrics for all queues
- `GET /horizon/api/queues/:queue` — 24h metric history for a specific queue
- `GET /horizon/api/workers` — Worker status list

## Do NOT

- Block the dispatch path — storage writes should be fast (fire-and-forget for memory)
- Store full job payloads for sensitive data — use `safeSerialize` which strips functions
- Wrap the adapter if no adapter is registered — always check `QueueRegistry.get()` first
