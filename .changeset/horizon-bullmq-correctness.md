---
"@rudderjs/horizon": major
"@rudderjs/queue-bullmq": minor
"@rudderjs/queue": minor
"@rudderjs/cli": patch
---

**`@rudderjs/horizon`** — Fix the BullMQ correctness bug where every job appeared stuck at `pending` forever on the dashboard, even after the worker terminal logged `✓ completed` / `✗ failed`.

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
import { Env } from '@rudderjs/core'
import type { HorizonConfig } from '@rudderjs/horizon'

export default {
  storage: 'redis',
  redis: {
    url:      Env.get('REDIS_URL', ''),
    host:     Env.get('REDIS_HOST', '127.0.0.1'),
    port:     Env.getNumber('REDIS_PORT', 6379),
    password: Env.get('REDIS_PASSWORD', ''),
    prefix:   'rudderjs',
  },
  // … rest of config unchanged
} satisfies HorizonConfig
```

`ioredis` is now an optional dep — if you have `@rudderjs/queue-bullmq` installed, you already have it.

If you're on the `sync` driver, no migration needed — `MemoryStorage` continues to work and `'memory'` stays the default.

**Why a major bump:** the storage interface adds a third driver, the config interface adds `redis`, and the runtime path for BullMQ users changes meaningfully. The public `Horizon` facade (`recentJobs()` / `failedJobs()` / etc.) is unchanged.

**`@rudderjs/queue`** — additive: new `@rudderjs/queue/observers` subpath. `SyncAdapter.dispatch()` now emits four lifecycle events. Existing consumers that don't subscribe see no behavior change.

**`@rudderjs/queue-bullmq`** — emits the same lifecycle events from the dispatcher and worker processes. Sets `RUDDERJS_QUEUE_WORKER=1` before instantiating BullMQ `Worker`s.

**`@rudderjs/cli`** — sets `RUDDERJS_QUEUE_WORKER=1` when argv includes `queue:work`, before booting providers, so cross-cutting collectors can self-register at the right time.

Pulse's queue recorder has the same architecture as the old horizon JobCollector and currently misses BullMQ worker-side events too. Documented as a known limitation in pulse's README; fix deferred to a follow-up that subscribes the recorder to `queueObservers`.

Plan: `docs/plans/2026-05-01-horizon-bullmq-fix.md`
