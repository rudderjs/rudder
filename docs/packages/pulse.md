# Pulse

Lightweight application performance monitoring for Rudder. Records pre-aggregated time-series for request throughput, queue activity, cache hit rate, exceptions, active users, and server CPU / memory — plus full entries for slow requests, slow queries, and exception details. Mounts a single auto-refreshing dashboard at `/pulse`.

Where Telescope captures every event in detail (one row per request, query, job) and Horizon focuses specifically on queue health, Pulse aggregates *over time* — counts and averages per minute bucket — so it stays fast even at production traffic.

## Install

```bash
pnpm add @rudderjs/pulse
```

The provider is auto-discovered — no manual wiring in `bootstrap/providers.ts`. Default config is sensible; add `config/pulse.ts` only when you need to tune it.

```ts
// config/pulse.ts (optional)
import type { PulseConfig } from '@rudderjs/pulse'

export default {
  enabled:              true,
  path:                 'pulse',
  storage:              'memory',
  pruneAfterHours:      168,    // 7 days
  slowRequestThreshold: 1000,   // ms
  slowQueryThreshold:   100,    // ms
} satisfies PulseConfig
```

Boot the app and hit `/pulse`. Until traffic flows through the recorders, the dashboard renders empty cards — see [Exercising it](#exercising-it).

## The dashboard

A single page at `/pulse` with seven metric cards (Requests, Cache Hit Rate, Queue Jobs, Exceptions, Active Users, CPU, Memory), sparklines for throughput, and tables for the last slow requests + recent exceptions. The period selector covers Last hour / 6 hours / 24 hours / 7 days. The whole page auto-refreshes every 10 seconds.

The UI is vanilla HTML + Alpine.js + Tailwind CDN — zero client framework, zero build step, zero `vike` peer. The package is fully self-contained.

## Recorders

Pulse ships seven recorders. Each one subscribes to its peer package's hooks (or installs middleware) and emits aggregates / entries through `Pulse.record()`:

| Recorder | Source | Records |
|---|---|---|
| **RequestRecorder** | Global middleware | `request_count`, `request_duration`, `slow_request` entries |
| **QueueRecorder** | `@rudderjs/queue/observers` (cross-process) | `queue_throughput`, `queue_wait_time`, `failed_job` entries |
| **CacheRecorder** | Wraps `@rudderjs/cache` adapter | `cache_hits`, `cache_misses` |
| **ExceptionRecorder** | Hooks `@rudderjs/core`'s exception reporter | `exceptions`, `exception` entries |
| **QueryRecorder** | Hooks `@rudderjs/orm` adapter `onQuery` | `slow_query` entries |
| **UserRecorder** | Global middleware | `active_users` (unique per minute) |
| **ServerRecorder** | Periodic timer | `server_cpu`, `server_memory` |

Recorders fail open: if their peer package isn't installed (or the adapter doesn't expose the relevant hook), the recorder silently no-ops. Pulse never breaks the request path.

Toggle individual recorders via config:

```ts
export default {
  recordRequests:   true,
  recordQueues:     true,
  recordCache:      true,
  recordExceptions: true,
  recordUsers:      true,
  recordServers:    true,
} satisfies PulseConfig
```

`QueryRecorder` (slow-query capture) is always registered and has no toggle.

## Aggregation model

Pulse stores **buckets**, not raw events. Every `Pulse.record(type, value, key?)` call increments the per-minute bucket for `(type, key)` — adding `1` to `count`, `value` to `sum`, and updating `min` / `max`. Reads then sum / average across buckets in the requested period.

This is the key difference from Telescope: a million requests produce ~minute-many bucket rows, not a million entry rows. Pulse stays small.

`PulseEntry` rows (slow requests, slow queries, exceptions, failed jobs) are stored individually because they're rare and you want the detail. Aggregates and entries share the same `pruneAfterHours` window.

## Storage

```ts
storage:    'memory',  // 'memory' | 'sqlite'
sqlitePath: '.pulse.db',
```

| Driver | Persistence | Cross-process | When to use |
|---|---|---|---|
| `memory` *(default)* | In-process | No | Dev with the `sync` queue driver, single-process apps where a bit of metric loss on restart is acceptable |
| `sqlite` | Persistent via `better-sqlite3` | Yes (WAL) | Production single-node deployments — **required when using BullMQ** so the dashboard process and the worker process share queue metrics |

For sqlite, install the optional peer: `pnpm add better-sqlite3`. The driver writes to `sqlitePath` in WAL journal mode so the dev server, CLI commands, and worker process can read/write the same file concurrently.

**BullMQ caveat:** with `storage: 'memory'`, queue metrics live in whichever process emits them — the dashboard sees its own dispatches but never the worker's `completed` / `failed` events, and `/pulse/api/queues` returns empty. Switch to `storage: 'sqlite'` to get true cross-process queue throughput and wait time.

Multi-node deployments need a custom driver — implement the `PulseStorage` contract from `@rudderjs/pulse`'s `types.ts` and register your driver via your own provider.

## The `Pulse` facade

Read or record from anywhere — useful for embedding stats in your own admin UI, scripted health probes, or shipping snapshots to an external dashboard:

```ts
import { Pulse } from '@rudderjs/pulse'

// Record a custom metric
Pulse.record('request_duration', 142)
Pulse.record('cache_hits', 1, 'user-cache')

// Read aggregates
const since = new Date(Date.now() - 3600_000)   // last hour
const requests = await Pulse.aggregates('request_count', since)
const cache    = await Pulse.aggregates('cache_hits',     since, 'user-cache')

// Read entries (the rare/detailed ones)
const slow = await Pulse.entries('slow_request', { perPage: 25 })

// Bulk read — latest bucket for each metric
const overview = await Pulse.overview(since)
```

| Method | Returns | Notes |
|---|---|---|
| `record(type, value, key?)` | `void` | Increment a per-minute bucket |
| `aggregates(type, since, key?)` | `PulseAggregate[]` | Buckets for a metric over time |
| `entries(type, opts?)` | `PulseEntry[]` | Individual entries (`slow_request`, `slow_query`, `exception`, `failed_job`) |
| `overview(since)` | `PulseAggregate[]` | All metrics' buckets since `since` |

## Mounting on a custom path

Override `path` in `config/pulse.ts`:

```ts
export default {
  path: 'admin/pulse',   // → mounts the dashboard at /admin/pulse
} satisfies PulseConfig
```

The provider re-derives the API prefix automatically.

## Auth gate

Pulse is open by default. Lock it down with an auth callback:

```ts
export default {
  auth: async (req: any) => req.user?.role === 'admin',
} satisfies PulseConfig
```

The callback runs as middleware on every Pulse route (UI + API). Returning falsy responds `403 { message: 'Unauthorized.' }`. Reads `req.user` populated by `AuthMiddleware` on the `web` group, sessions, headers — anything attached to the framework `AppRequest`.

## Exercising it

The playground includes a `/test/pulse` route that fires every recorder in one request — cache hit + miss, an ORM query, a queue dispatch, a reported exception, and a forced 1.1s sleep so the slow-request entry table populates:

```bash
cd playground && pnpm dev
curl http://localhost:3000/test/pulse
```

Then open `/pulse`. The Cache, Requests, Queue, Exceptions, and Slow Requests sections should all show non-zero data within ~10 s (the dashboard's auto-refresh interval). Active Users counts the request itself. Server CPU / Memory populate independently on the periodic timer (default every 15 s).

Pulse's request, cache, exception, query, user, and server recorders all fire in the dashboard process — no separate worker needed. The queue recorder works the same way under the `sync` driver. Under BullMQ the worker process emits `job.completed` / `job.failed` events; pair `storage: 'sqlite'` with the worker (`pnpm rudder queue:work`) so those metrics reach the dashboard.

## Pulse vs Telescope vs Horizon

| | Pulse | Telescope | Horizon |
|---|---|---|---|
| **Granularity** | Aggregated per minute | One row per event | One row per job |
| **Cost at scale** | Cheap (bucket inserts) | Heavy (one row per request/query) | Bounded by `maxJobs` |
| **Use for** | Dashboards, alerting, trends | Debugging — "what happened in this request?" | Queue health, retry / kill failed jobs |
| **Default** | Off-by-default in production unless you keep it on | Off in production | Off in production |

Most apps keep Telescope in dev only, Horizon optional, and Pulse always-on for low-overhead visibility.

## Pitfalls

- **Memory driver loses history on restart.** Buckets and entries live in-process. Dev / single-node prod with `sqlite` is the practical persistence step.
- **`pruneAfterHours` cadence.** With the default 168 hours, the prune timer runs hourly, deleting buckets and entries older than the cutoff. Fresh restarts won't see stale data purged immediately — first prune fires after one interval.
- **Slow query threshold defaults to 100ms.** Anything below that doesn't generate a `slow_query` entry, regardless of recorder config. Bump `slowQueryThreshold` in noisy dev environments where every query is "slow."
- **`active_users` is per-minute, not lifetime.** UserRecorder rotates its dedup set every minute, so the same user counted again next minute is a "new" active user for that bucket. Sum the buckets for a "uniques over the period" approximation.
- **Server CPU is OS-load, not Node-only.** `ServerRecorder` reads `os.cpus()` — that's the *whole machine*, not just the Node process. Useful as a "is the box hot" signal, not for measuring app cost.
- **No path-level breakdowns by default.** Aggregates are keyless unless you record with a `key`. To track requests per route, call `Pulse.record('request_count', 1, req.path)` from your own middleware. RequestRecorder intentionally keys nothing to avoid cardinality blow-up on dynamic paths.
- **Recorder classes were renamed in 6.0.** `RequestAggregator` → `RequestRecorder`, etc. — the `Aggregator` interface is now `Recorder`. The change aligns with Laravel Pulse's vocabulary; the runtime behavior is identical.
- **`QueueRecorder` semantics in 6.1.** `queue_throughput` now increments on terminal states (`job.completed` / `job.failed`), so it counts jobs *processed* per minute, not *dispatched* per minute. `queue_wait_time` is the true queue-to-active wait (`startedAt - dispatchedAt`), not the enqueue duration. Anyone alerting off pre-6.1 numbers should re-baseline.
- **MemoryStorage + BullMQ = empty queue metrics.** See the storage table — switch to `sqlite` to get cross-process queue visibility under BullMQ.
