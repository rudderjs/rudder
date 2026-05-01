# @rudderjs/pulse

Application performance monitoring for RudderJS — records request throughput, queue metrics, cache hit rates, exceptions, active users, slow queries, and server resource usage.

## Installation

```bash
pnpm add @rudderjs/pulse
```

## Setup

```ts
// bootstrap/providers.ts
import { pulse } from '@rudderjs/pulse'
import configs from '../config/index.js'
export default [..., pulse(configs.pulse), ...]
```

## Pulse Facade

```ts
import { Pulse } from '@rudderjs/pulse'

// Record a metric
Pulse.record('request_duration', 142)
Pulse.record('cache_hits', 1, 'user-cache')

// Query aggregates
const since = new Date(Date.now() - 3600_000) // last hour
const requestMetrics = await Pulse.aggregates('request_count', since)
const cacheMetrics   = await Pulse.aggregates('cache_hits', since, 'user-cache')

// Get entries (slow requests, exceptions, etc.)
const slowRequests = await Pulse.entries('slow_request', { perPage: 25 })

// Overview of all metrics
const overview = await Pulse.overview(since)
```

## `Pulse` Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `record(type, value, key?)` | `void` | Increment an aggregate bucket |
| `aggregates(type, since, key?)` | `PulseAggregate[]` | Aggregates for a metric type within a period |
| `entries(type, options?)` | `PulseEntry[]` | Individual entries (slow requests, exceptions) |
| `overview(since)` | `PulseAggregate[]` | All aggregates since a given date |

## Metric Types

| Type | Source |
|------|--------|
| `request_count` | Request middleware |
| `request_duration` | Request middleware |
| `queue_throughput` | Queue recorder |
| `queue_wait_time` | Queue recorder |
| `cache_hits` / `cache_misses` | Cache recorder |
| `exceptions` | Exception recorder |
| `active_users` | User recorder middleware |
| `server_cpu` / `server_memory` | Server recorder (periodic) |

## Storage Drivers

- **`memory`** (default) — In-process, capped at `maxEntries`. Good for development.
- **`sqlite`** — Persistent storage via `better-sqlite3`. Run `pnpm add better-sqlite3` to enable.

## Configuration

```ts
// config/pulse.ts
export default {
  enabled: true,
  path: 'pulse',
  storage: 'memory',
  sqlitePath: '.pulse.db',
  pruneAfterHours: 168,            // 7 days
  slowRequestThreshold: 1000,      // ms
  slowQueryThreshold: 100,         // ms
  recordRequests: true,
  recordQueues: true,
  recordCache: true,
  recordExceptions: true,
  recordUsers: true,
  recordServers: true,
  serverStatsIntervalMs: 15_000,
  auth: null,
} satisfies PulseConfig
```

## Recorders

Pulse auto-registers recorders based on config:

- **RequestRecorder** — Tracks request throughput and duration via middleware
- **QueueRecorder** — Tracks queue throughput and wait times
- **CacheRecorder** — Tracks cache hit/miss rates
- **ExceptionRecorder** — Counts unhandled exceptions
- **QueryRecorder** — Records slow database queries
- **UserRecorder** — Tracks unique active users via middleware
- **ServerRecorder** — Periodically records CPU and memory usage

## Notes

- Auto-prune runs on a background interval.
- Optional peers: `@rudderjs/log`, `@rudderjs/orm`, `@rudderjs/cache`, `@rudderjs/queue`.
- Dashboard served at `/{path}` with auto-refreshing metric cards.
