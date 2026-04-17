# @rudderjs/queue

## Overview

Queue abstraction for RudderJS. Provides a `Job` base class with `handle()` / `failed()` lifecycle, a fluent `dispatch()` builder, a driver registry (`QueueRegistry`), and rudder CLI commands (`queue:work`, `queue:status`, `queue:clear`, `queue:failed`, `queue:retry`). Ships with a built-in `sync` driver. BullMQ and Inngest are available as separate driver packages.

## Key Patterns

### Defining a job

```ts
import { Job } from '@rudderjs/queue'

export class SendWelcomeEmail extends Job {
  static override queue   = 'emails'
  static override retries = 5
  static override delay   = 0             // ms

  constructor(private readonly userId: string) { super() }

  async handle(): Promise<void> {
    // do the work
  }

  async failed(error: unknown): Promise<void> {
    // called after retries are exhausted
    console.error('SendWelcomeEmail failed', error)
  }
}
```

`queue`, `retries`, and `delay` are class-level defaults — call-site values on `dispatch()` override them.

### Dispatching

```ts
// Use static defaults
await SendWelcomeEmail.dispatch('user-123').send()

// Override per call
await SendWelcomeEmail.dispatch('user-123')
  .onQueue('priority')
  .delay(5_000)                // ms
  .send()
```

### Registering the provider

```ts
// config/queue.ts
import type { QueueConfig } from '@rudderjs/queue'

export default {
  default: Env.get('QUEUE_CONNECTION', 'sync'),
  connections: {
    sync:   { driver: 'sync' },
    bullmq: { driver: 'bullmq', host: '127.0.0.1', port: 6379 },
  },
} satisfies QueueConfig
```

```ts
// bootstrap/providers.ts — QueueProvider is auto-discovered; nothing to import manually
import { defaultProviders } from '@rudderjs/core'

export default [...(await defaultProviders())]
```

To opt out of auto-discovery, import `QueueProvider` from `@rudderjs/queue` and list it explicitly.

### Drivers

| Driver    | Package                   | Install                                    |
|-----------|---------------------------|--------------------------------------------|
| `sync`    | built-in                  | — (in-process, immediate, ignores `delay`) |
| `bullmq`  | `@rudderjs/queue-bullmq`  | `pnpm add @rudderjs/queue-bullmq ioredis`  |
| `inngest` | `@rudderjs/queue-inngest` | `pnpm add @rudderjs/queue-inngest inngest` |

### rudder commands

```bash
pnpm rudder queue:work                  # start worker (BullMQ only)
pnpm rudder queue:work emails,default   # specific queues
pnpm rudder queue:status                # waiting/active/completed/failed counts
pnpm rudder queue:status emails         # single queue
pnpm rudder queue:clear                 # drain waiting + delayed
pnpm rudder queue:failed                # list recently failed jobs
pnpm rudder queue:retry                 # re-enqueue all failed jobs
```

### Using the registry directly

```ts
import { QueueRegistry, SyncAdapter } from '@rudderjs/queue'

const adapter = QueueRegistry.get()      // QueueAdapter | null

// Standalone (testing / scripts) — no provider required
const sync = new SyncAdapter()
await sync.dispatch(new MyJob())
```

## Common Pitfalls

- **No provider registered**: calling `Job.dispatch().send()` before `QueueProvider` is booted throws. Make sure auto-discovery is running (`defaultProviders()`) or list `QueueProvider` explicitly.
- **`sync` driver ignores `delay`**: the sync adapter runs the job immediately in-process, regardless of `.delay()` or static `delay`. Use BullMQ / Inngest for actual scheduling.
- **`queue:work` only works for BullMQ**: the `sync` and `inngest` drivers don't expose a worker loop (sync runs inline; Inngest is external). Commands that the active driver doesn't support throw a clear error.
- **All commands register in `boot()`**: commands appear in `pnpm rudder --help` regardless of which driver is configured — only execution is driver-gated.
- **TTL / delay units are milliseconds**: `.delay(5000)` is 5 seconds, not 5 minutes. Same for `static delay`.
- **`SyncAdapter` calls `failed()` before re-throwing**: if your `handle()` throws under the sync driver, `failed()` runs and then the error propagates up — make sure `failed()` is idempotent and doesn't swallow the original error.

## Key Imports

```ts
import {
  Job,                        // base class
  QueueProvider,              // service provider class (auto-discovered; import only to opt out)
  QueueRegistry,              // access the active adapter
  SyncAdapter,                // standalone sync driver
  FakeQueueAdapter,           // fake adapter for tests
  Queue,                      // facade
  Chain, getChainState,       // job chaining
  Bus, Batch, PendingBatch,   // job batching
  dispatch,                   // closure-style dispatch
  RateLimited, WithoutOverlapping, ThrottlesExceptions, Skip,   // job middleware
} from '@rudderjs/queue'

import type {
  QueueConfig,
  QueueConnectionConfig,
  QueueAdapter,
  DispatchBuilder,
} from '@rudderjs/queue'
```
