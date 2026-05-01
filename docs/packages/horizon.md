# Horizon

Queue monitoring dashboard for RudderJS. Records every job's lifecycle (dispatch → start → complete or fail), tracks per-queue throughput / wait / runtime, and reports the current process's worker status. Mounted at `/horizon` by default with five built-in pages — Dashboard, Recent Jobs, Failed Jobs, Queues, Workers.

## Install

```bash
pnpm add @rudderjs/horizon
```

The provider is auto-discovered — no manual wiring in `bootstrap/providers.ts`. Add a `config/horizon.ts` to tune defaults; everything works out of the box without it.

```ts
// config/horizon.ts (optional — ships with sensible defaults)
import type { HorizonConfig } from '@rudderjs/horizon'

export default {
  enabled:           true,
  path:              'horizon',
  storage:           'memory',
  maxJobs:           1000,
  pruneAfterHours:   72,
  metricsIntervalMs: 60_000,
} satisfies HorizonConfig
```

Boot the app (`pnpm dev`) and hit `/horizon`. Until jobs flow through `@rudderjs/queue`, the pages render empty shells — see [Exercising it](#exercising-it) for a full demo loop.

## Dashboard pages

| Page | Path | Shows |
|---|---|---|
| Dashboard | `/horizon` | Job counts by status (total / pending / processing / completed / failed) + queue-metrics table. Auto-refreshes every 10 s. |
| Recent Jobs | `/horizon/jobs/recent` | Paginated list of all jobs with name, queue, status, duration, dispatched-time. Search + per-row delete. |
| Failed Jobs | `/horizon/jobs/failed` | Same shape as Recent, filtered to `status: 'failed'`, with a Retry button per row. |
| Queues | `/horizon/queues` | Per-queue throughput, average wait, average runtime, pending / active / completed / failed counts. |
| Workers | `/horizon/workers` | Each registered worker process — id, queue, status, jobs run, memory, last-job timestamp. |

The UI is vanilla HTML + Alpine.js + Tailwind CDN — no build step, no client framework, no `vike` peer. The package is fully self-contained.

## Collectors

Horizon registers three collectors on boot. Each one subscribes to `@rudderjs/queue`'s observer hooks and persists its data through the configured `HorizonStorage`:

- **JobCollector** — records every dispatch / start / complete / fail event as a `HorizonJob` row.
- **MetricsCollector** — polls the queue adapter on `metricsIntervalMs` and snapshots per-queue throughput, wait time, runtime.
- **WorkerCollector** — registers the current Node process as a worker, tracking memory + jobs processed since startup.

Collectors fail open: if `@rudderjs/queue` isn't installed (or the adapter doesn't support a particular hook), the collector silently skips that event. Horizon never breaks the request path.

## Storage

```ts
// config/horizon.ts
storage:    'memory',  // 'memory' | 'sqlite'
sqlitePath: '.horizon.db',
maxJobs:    1000,
```

| Driver | Persistence | When to use |
|---|---|---|
| `memory` *(default)* | In-process, bounded by `maxJobs` | Dev, single-process apps, anywhere job history doesn't need to survive a restart |
| `sqlite` | Persistent via `better-sqlite3` | Production single-node deployments, or any time you want job history across restarts |

For sqlite, install the optional peer: `pnpm add better-sqlite3`. The driver writes to `sqlitePath` (default `.horizon.db`) using WAL mode so the dev server and CLI workers can read/write the same file concurrently.

Multi-node deployments need a custom driver — implement `HorizonStorage` (the contract is in `@rudderjs/horizon`'s `types.ts`) and register it via your own provider.

## The `Horizon` facade

Read access from anywhere — useful for embedding stats in your own admin UI or shipping them off to an external dashboard:

```ts
import { Horizon } from '@rudderjs/horizon'

const recent  = await Horizon.recentJobs({ queue: 'emails', perPage: 25 })
const failed  = await Horizon.failedJobs()
const job     = await Horizon.findJob('job-id')
const metrics = await Horizon.currentMetrics()
const workers = await Horizon.workers()
const total   = await Horizon.jobCount('failed')
```

| Method | Returns | Notes |
|---|---|---|
| `recentJobs(opts?)` | `HorizonJob[]` | `opts`: `page`, `perPage`, `queue`, `search`, `status` |
| `failedJobs(opts?)` | `HorizonJob[]` | Same shape, pre-filtered |
| `findJob(id)` | `HorizonJob \| null` | |
| `currentMetrics()` | `QueueMetric[]` | Latest snapshot per queue |
| `workers()` | `WorkerInfo[]` | All registered workers |
| `jobCount(status?)` | `number` | Total or by `JobStatus` |

## Mounting on a custom path

Override `path` in `config/horizon.ts`:

```ts
export default {
  path: 'admin/horizon',   // → mounts the dashboard at /admin/horizon
} satisfies HorizonConfig
```

The provider re-derives the API prefix (`/admin/horizon/api`) automatically — both the inline Alpine fetches and external integrations share the same base.

## Auth gate

By default `/horizon` is open. Lock it down with an auth callback:

```ts
// config/horizon.ts
import type { HorizonConfig } from '@rudderjs/horizon'

export default {
  auth: async (req: any) => {
    return req.user?.role === 'admin'
  },
} satisfies HorizonConfig
```

The callback runs as middleware on every Horizon route (UI + API). Returning anything falsy responds `403 { message: 'Unauthorized.' }`. The handler receives the framework `AppRequest` — read `req.user`, sessions, headers, anything you need.

For a typical setup, read `req.user` populated by `AuthMiddleware` (auto-installed on the `web` group). Horizon routes are registered globally, so make sure your auth check itself doesn't depend on the `web` group's session middleware (it isn't applied to package-internal routes by default).

## Exercising it

Horizon's worker page only populates if a real worker process is running. The playground includes a `/test/horizon` route that demonstrates the full loop:

```bash
# Terminal 1 — boot the app
cd playground && pnpm dev

# Terminal 2 — start a worker for both queues
pnpm rudder queue:work --queue=default,priority

# Terminal 3 — dispatch a mix of jobs (default + priority + one guaranteed failure)
curl http://localhost:3000/test/horizon
```

Then open `/horizon` — you'll see the dispatched jobs land in Recent, the priority queue show up in Queues, the worker process appear in Workers, and (after retries are exhausted) the failure land in Failed Jobs.

The default queue connection in the playground is BullMQ, which needs Redis. Either run a local instance (`brew services start redis`) or set `QUEUE_CONNECTION=sync` to dispatch inline — but note that sync dispatch processes jobs in the request lifecycle and never produces a separate worker process, so the Workers page will only ever show the request-handling Node process.

## Pitfalls

- **Worker page empty in dev.** With the `sync` queue driver, jobs run inline in the request handler — there is no separate worker. Switch to `bullmq` + `pnpm rudder queue:work` to populate Workers properly.
- **Memory driver loses history on restart.** `maxJobs` bounds the in-process buffer; once you restart, recent and failed history is gone. Use `sqlite` for any environment where you want to inspect old failures after a deploy.
- **Auto-prune cadence.** With `pruneAfterHours: 72`, the prune timer runs every `min(pruneAfterHours, 1)` hours, deleting jobs older than the cutoff. The first prune runs on the next interval, not on boot — fresh restarts will not show stale data being purged immediately.
- **Retry uses the queue adapter.** The "Retry" button on the Failed Jobs page calls the queue adapter's `retryFailed(queue)` method. If your adapter doesn't implement it (e.g. the `sync` driver), the API responds `501 { message: 'Queue adapter does not support retry.' }`. BullMQ supports retry; Inngest re-runs failures via its own dashboard, so retry is delegated there.
- **Dashboard UI is not a control plane.** Horizon reports queue / worker state but does not orchestrate workers — it doesn't start, stop, pause, or scale them. Use your queue adapter's CLI (`pnpm rudder queue:work`) and process manager (PM2, systemd, Kubernetes) for that.
- **Multi-node deployments need a shared storage.** Memory and the default sqlite path are local to one Node process. Behind a load balancer, each request might hit a different process and see different history. Either implement a shared `HorizonStorage` driver, or pin Horizon to a single observer node.
