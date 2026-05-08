# @rudderjs/horizon

## 6.0.1

### Patch Changes

- 4c24021: Guard JSON.parse on Redis/SQLite data and event serialization
- Updated dependencies [8e682a6]
  - @rudderjs/contracts@1.5.0

## 6.0.0

### Major Changes

- 05852de: Fix two bugs surfaced during browser-verify of the BullMQ correctness fix (5.0.0):

  **Bug A — id collision across queues.** BullMQ assigns job ids per-queue starting at 1, so `default:1` and `priority:1` collided on the single-id storage key (`jobs:{id}`) and overwrote each other. Storage records are now keyed by `(queue, id)`:

  - Storage interface: `findJob(queue, id)`, `updateJob(queue, id, ...)`, `deleteJob(queue, id)`. Same change reflected on the `Horizon` facade.
  - Redis storage: job hashes at `jobs:{queue}:{id}`; `recent` and `failed` ZSet members are `{queue}:{id}`.
  - SQLite storage: bumped table to `horizon_jobs_v2` with composite `PRIMARY KEY (queue, id)`. v1 table is left in place — old data ages out via `pruneAfterHours`.
  - API routes: `GET/POST/DELETE /horizon/api/jobs/:queue/:id` (was `/:id`). UI builds detail-page URLs from `queue` + `id`.

  Also fixes a race in `RedisStorage.recordJob` — the dashboard process emits `job.dispatched` and writes via microtask, so a fast worker process could update the record to `completed` before the dashboard's write landed, and a plain HSET would overwrite the worker's status with `pending`. Lifecycle fields (`status`, `attempts`, `startedAt`, `completedAt`, `duration`, `exception`) are now written with HSETNX so worker updates always win.

  **Bug B — duplicated MetricsCollector across processes.** The dashboard process and worker process both polled `MetricsCollector.collect()` every interval and wrote to the shared Redis `metrics:{queue}:current` hash. The dashboard's empty counters (BullMQ events fire only in the worker) clobbered the worker's writes. `MetricsCollector.register()` is now gated to the worker process for out-of-process queue drivers (BullMQ); the sync driver still registers in the dashboard process because dashboard and worker are the same process.

  This is a major bump because the storage interface, the API URL shape, and the Redis/SQLite key schema all change. Apps consuming `Horizon.findJob(...)` or hitting `/horizon/api/jobs/:id` need to migrate to the new `(queue, id)` shape.

## 5.0.0

### Major Changes

- 8689218: **`@rudderjs/horizon`** — Fix the BullMQ correctness bug where every job appeared stuck at `pending` forever on the dashboard, even after the worker terminal logged `✓ completed` / `✗ failed`.

  Two stacked architectural bugs are fixed in one change:

  1. `JobCollector` was monkey-patching `dispatch()` and mutating `job.handle` on the in-memory `Job` instance. BullMQ serializes the job via `JSON.parse(JSON.stringify(job))` and reconstructs a fresh instance in the worker process — so the wrapped handler that was supposed to flip status to `processing` / `completed` / `failed` lived only in the dispatcher's heap and was never reached.
  2. `MemoryStorage` is per-process. The dev/web process and the worker process held separate in-memory arrays with no path to share state; even if the wrap had survived, the dashboard process couldn't see what the worker recorded.

  **Fix shape:**

  - `@rudderjs/queue` now exposes a `@rudderjs/queue/observers` subpath — a `QueueObserverRegistry` singleton on `globalThis` that adapters emit lifecycle events to. Same pattern as `@rudderjs/mcp/observers`, `@rudderjs/http/observers`, etc.
  - The built-in `SyncAdapter` and `@rudderjs/queue-bullmq`'s `BullMQAdapter` emit `job.dispatched` / `job.active` / `job.completed` / `job.failed` events at the right lifecycle points. BullMQ emits `active` from the worker process via `processor()`, and `completed` / `failed` via `worker.on(...)` — the exact transitions that previously didn't reach the dashboard.
  - `@rudderjs/horizon` adds a third storage driver, `RedisStorage`, alongside `MemoryStorage` and `SqliteStorage`. The `JobCollector` is rewritten to subscribe to `queueObservers` instead of monkey-patching the adapter — observer events emitted in the worker process flow through Redis to the dashboard process.
  - `WorkerCollector` only self-registers when `RUDDERJS_QUEUE_WORKER=1` is set. The CLI sets it before booting providers when running `queue:work`, and the BullMQ adapter sets it again defensively before instantiating `Worker`s — so the dev/web process no longer lists itself as a worker.
  - `HorizonProvider.boot()` warns when `queue: bullmq` + `horizon.storage: memory` is detected, surfacing the misconfig before it manifests as a dead dashboard.

  **Migration:**

  If you're using `@rudderjs/queue-bullmq`, switch `config/horizon.ts` to:

  ```ts
  import { Env } from "@rudderjs/core";
  import type { HorizonConfig } from "@rudderjs/horizon";

  export default {
    storage: "redis",
    redis: {
      url: Env.get("REDIS_URL", ""),
      host: Env.get("REDIS_HOST", "127.0.0.1"),
      port: Env.getNumber("REDIS_PORT", 6379),
      password: Env.get("REDIS_PASSWORD", ""),
      prefix: "rudderjs",
    },
    // … rest of config unchanged
  } satisfies HorizonConfig;
  ```

  `ioredis` is now an optional dep — if you have `@rudderjs/queue-bullmq` installed, you already have it.

  If you're on the `sync` driver, no migration needed — `MemoryStorage` continues to work and `'memory'` stays the default.

  **Why a major bump:** the storage interface adds a third driver, the config interface adds `redis`, and the runtime path for BullMQ users changes meaningfully. The public `Horizon` facade (`recentJobs()` / `failedJobs()` / etc.) is unchanged.

  **`@rudderjs/queue`** — additive: new `@rudderjs/queue/observers` subpath. `SyncAdapter.dispatch()` now emits four lifecycle events. Existing consumers that don't subscribe see no behavior change.

  **`@rudderjs/queue-bullmq`** — emits the same lifecycle events from the dispatcher and worker processes. Sets `RUDDERJS_QUEUE_WORKER=1` before instantiating BullMQ `Worker`s.

  **`@rudderjs/cli`** — sets `RUDDERJS_QUEUE_WORKER=1` when argv includes `queue:work`, before booting providers, so cross-cutting collectors can self-register at the right time.

  Pulse's queue recorder has the same architecture as the old horizon JobCollector and currently misses BullMQ worker-side events too. Documented as a known limitation in pulse's README; fix deferred to a follow-up that subscribes the recorder to `queueObservers`.

  Plan: `docs/plans/2026-05-01-horizon-bullmq-fix.md`

### Patch Changes

- Updated dependencies [8689218]
  - @rudderjs/queue@4.1.0

## 4.1.0

### Minor Changes

- 4705d64: Migrate UI to the canonical package-UI shape (`views/vanilla/` + `registerHorizonRoutes()`). One file per page (`Dashboard`, `RecentJobs`, `FailedJobs`, `Queues`, `Workers`), with the shared layout in `Layout.ts` and the auto-escape `html\`\``helper available in`\_html.ts`. Route registration moves from `src/api/routes.ts`to a new`src/routes.ts`; API handler implementations stay where they were as pure functions. Internal restructure only — public API (`HorizonProvider`, `Horizon` facade, configuration) is unchanged.

## 4.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/middleware@1.0.0
  - @rudderjs/router@1.0.0
  - @rudderjs/queue@4.0.0

## 3.0.3

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/middleware@0.0.14
  - @rudderjs/router@0.3.1

## 3.0.2

### Patch Changes

- Updated dependencies [5ca3e29]
  - @rudderjs/queue@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1
  - @rudderjs/queue@3.0.1
  - @rudderjs/middleware@0.0.13

## 3.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0
  - @rudderjs/middleware@0.0.12
  - @rudderjs/queue@3.0.0

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/queue@2.0.1
  - @rudderjs/core@0.0.12
  - @rudderjs/middleware@0.0.11

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11
  - @rudderjs/queue@2.0.0
  - @rudderjs/middleware@0.0.10

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10
  - @rudderjs/queue@1.0.0
  - @rudderjs/middleware@0.0.9

## 0.0.2

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
  - @rudderjs/middleware@0.0.8
  - @rudderjs/queue@0.0.6
  - @rudderjs/router@0.0.4
