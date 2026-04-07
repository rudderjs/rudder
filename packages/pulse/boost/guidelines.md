# @rudderjs/pulse — AI Coding Guidelines

## What This Package Does

Pulse is an application metrics dashboard for RudderJS applications. It aggregates time-series data (request throughput, cache hit rates, queue metrics, server stats) into 1-minute buckets and exposes a JSON API for visualization.

## Architecture

Two data models:
1. **Aggregates** — Time-bucketed metrics (1-minute resolution). Used for throughput, duration, hit rates.
2. **Entries** — Individual notable events (slow requests, slow queries, exceptions, failed jobs).

Seven aggregators collect data:
- `RequestAggregator` — middleware: request count + duration
- `QueueAggregator` — wraps adapter: throughput + wait time + failures
- `CacheAggregator` — wraps adapter: hit/miss counting
- `ExceptionAggregator` — exception reporter hook
- `UserAggregator` — middleware: unique users per minute
- `QueryAggregator` — ORM hook: slow query detection
- `ServerAggregator` — periodic: CPU + memory

## Key Patterns

- Aggregators implement the `Aggregator` interface with `register()` method
- `storage.record(type, value, key?)` increments a 1-minute bucket aggregate
- `storage.storeEntry(type, content)` records individual notable events
- API endpoints support `?period=1h|6h|24h|7d` for time range selection

## Do NOT

- Import peer dependencies statically — always use dynamic `import()` with try/catch
- Record Pulse's own API requests (request aggregator skips `/pulse*`)
- Store high-cardinality keys in aggregates — keep `key` to queue names, route patterns, not full URLs
