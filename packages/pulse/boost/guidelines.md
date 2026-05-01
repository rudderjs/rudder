# @rudderjs/pulse — AI Coding Guidelines

## What This Package Does

Pulse is an application metrics dashboard for RudderJS applications. It records time-series data (request throughput, cache hit rates, queue metrics, server stats) into 1-minute buckets and exposes a JSON API + a single-page dashboard at `/pulse`.

## Architecture

Two data models:
1. **Aggregates** — Time-bucketed metrics (1-minute resolution). Used for throughput, duration, hit rates.
2. **Entries** — Individual notable events (slow requests, slow queries, exceptions, failed jobs).

Seven recorders collect data:
- `RequestRecorder` — middleware: request count + duration
- `QueueRecorder` — wraps adapter: throughput + wait time + failures
- `CacheRecorder` — wraps adapter: hit/miss counting
- `ExceptionRecorder` — exception reporter hook
- `UserRecorder` — middleware: unique users per minute
- `QueryRecorder` — ORM hook: slow query detection
- `ServerRecorder` — periodic: CPU + memory

### File Layout

- `src/index.ts` — `PulseProvider`, `Pulse` facade, `PulseRegistry`, public re-exports
- `src/types.ts` — `PulseAggregate`, `PulseEntry`, `Recorder`, `PulseStorage`, `PulseConfig`
- `src/storage.ts` — `MemoryStorage`, `SqliteStorage`
- `src/recorders/` — seven recorder classes (request, queue, cache, exception, query, user, server)
- `src/routes.ts` — `registerPulseRoutes(storage, opts)` — UI + API route registration. Mirrors `@rudderjs/telescope`'s `registerTelescopeRoutes()`.
- `src/api/routes.ts` — pure handler functions (`getOverview`, `getRequests`, `listSlowRequests`, `authMiddleware`, …) called from `routes.ts`. Holds no router calls.
- `src/views/vanilla/` — UI: `Layout`, `Dashboard` (single page), `_html` (auto-escape helper), `index.ts` barrel.

## Key Patterns

- Recorders implement the `Recorder` interface with a `register()` method
- `storage.record(type, value, key?)` increments a 1-minute bucket aggregate
- `storage.storeEntry(type, content)` records individual notable events
- API endpoints support `?period=1h|6h|24h|7d` for time range selection

## Do NOT

- Import peer dependencies statically — always use dynamic `import()` with try/catch
- Record Pulse's own API requests (RequestRecorder skips `/pulse*`)
- Store high-cardinality keys in aggregates — keep `key` to queue names, route patterns, not full URLs
- Use the old `*Aggregator` class names — renamed to `*Recorder` in v6 to align with Laravel Pulse vocabulary
