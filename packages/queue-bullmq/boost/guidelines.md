# @rudderjs/queue-bullmq

## Overview

Redis-backed queue driver for `@rudderjs/queue` using BullMQ. Jobs dispatched via `Job.dispatch().send()` flow to a Redis stream; workers spawn via `pnpm rudder queue:work` and process jobs with configurable concurrency, exponential backoff, and graceful shutdown on `SIGTERM` / `SIGINT`. The only `@rudderjs/queue` driver that actually scales horizontally.

## Key Patterns

### Configure (`config/queue.ts`)

```ts
import type { QueueConfig } from '@rudderjs/queue'
import { SendWelcomeEmail } from '../app/Jobs/SendWelcomeEmail.js'

export default {
  default: Env.get('QUEUE_CONNECTION', 'bullmq'),
  connections: {
    bullmq: {
      driver:   'bullmq',
      url:      Env.get('REDIS_URL', 'redis://127.0.0.1:6379'),
      jobs:     [SendWelcomeEmail],          // EVERY job class you'll dispatch
      concurrency: 5,
      removeOnComplete: 1000,
      removeOnFail:     5000,
    },
  },
} satisfies QueueConfig
```

The driver is auto-loaded by `@rudderjs/queue` when `connection.driver === 'bullmq'`.

### Connection — `url` vs `host`/`port`

```ts
// Option A: full Redis URL (preferred)
{ driver: 'bullmq', url: 'redis://default:pwd@127.0.0.1:6379/0' }

// Option B: discrete fields
{ driver: 'bullmq', host: '127.0.0.1', port: 6379, password: 'pwd', db: 0 }
```

`url` wins if both are present.

### Run a worker

```bash
pnpm rudder queue:work                    # start worker for the default connection
pnpm rudder queue:work emails,default     # specific queue names
```

The worker spawns one `Worker` instance per queue, registers jobs from `connection.jobs[]`, and waits on `SIGTERM` / `SIGINT` for graceful shutdown (in-flight jobs finish before exit).

### Status + management

```bash
pnpm rudder queue:status               # waiting / active / completed / failed counts
pnpm rudder queue:failed               # list recent failed jobs
pnpm rudder queue:retry                # re-enqueue all failed jobs
pnpm rudder queue:clear                # drain waiting + delayed
```

### Context propagation

If `@rudderjs/context` is installed, the adapter automatically serializes the current request context on dispatch and rehydrates it inside `runWithContext()` for `handle()`. No app code change needed.

## Common Pitfalls

- **`Unknown job` at worker time**: the dispatched class name isn't in `connection.jobs[]`. Add every job class you'll dispatch — the worker resolves handlers by `JobClass.name`.
- **Class renames break in-flight jobs**: jobs in Redis carry the old class name; renaming the class makes them unresolvable. Either drain the queue before rename or keep an alias.
- **Constructor args must JSON-round-trip**: `Job.dispatch(arg1, arg2).send()` serializes args via `JSON.stringify`. `Date` becomes a string; class instances lose their prototype. Pass plain data (ids, primitives) and re-fetch inside `handle()`.
- **`removeOnComplete: false` (or unlimited) fills Redis**: every completed job stays in the stream forever. Set a count (e.g. `1000`) or rely on the default.
- **Redis not running**: `ECONNREFUSED` on first dispatch / worker start. Ensure Redis is up; in dev, `pnpm exec redis-cli ping` should return `PONG`.
- **`queue:work` doesn't auto-restart on file changes**: it's a long-running process. Use a process manager (PM2, Procfile + Foreman, etc.) or run via `tsx watch` in dev.

## Key Imports

```ts
import { Job } from '@rudderjs/queue'
import {
  BullMQAdapter,           // adapter implementation (resolved by the queue facade)
} from '@rudderjs/queue-bullmq'

import type {
  BullMQConfig,            // shape of connections[].bullmq
} from '@rudderjs/queue-bullmq'
```

## Required peer

`bullmq` and `ioredis` (BullMQ's transitive). Install:

```bash
pnpm add @rudderjs/queue-bullmq bullmq ioredis
```
