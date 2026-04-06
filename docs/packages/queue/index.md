# @rudderjs/queue

Queue job abstractions, registry, and provider factory.

## Installation

```bash
pnpm add @rudderjs/queue
```

This package provides the `Job` base class, the `DispatchBuilder` fluent interface, the `QueueAdapter` contract, and the `queue()` provider factory. It does not include a driver — use it with `@rudderjs/queue-bullmq` or `@rudderjs/queue-inngest` for real background processing, or rely on the built-in `sync` driver for in-process execution.

## Defining a Job

Extend `Job` and implement `handle()`:

```ts
import { Job } from '@rudderjs/queue'

export class SendEmailJob extends Job {
  static queue   = 'default'
  static retries = 3

  constructor(
    private readonly to:      string,
    private readonly subject: string,
  ) {
    super()
  }

  async handle(): Promise<void> {
    // send the email
    console.log(`Sending email to ${this.to}: ${this.subject}`)
  }
}
```

## Dispatching a Job

Use the static `dispatch()` method which returns a fluent `DispatchBuilder`:

```ts
import { SendEmailJob } from './app/Jobs/SendEmailJob.js'

// Basic dispatch (uses default queue)
await SendEmailJob.dispatch('alice@example.com', 'Welcome!').send()

// Specify queue name and delay
await SendEmailJob.dispatch('bob@example.com', 'Reset password')
  .onQueue('notifications')
  .delay(5000)
  .send()
```

### DispatchBuilder Methods

| Method | Signature | Description |
|---|---|---|
| `onQueue()` | `onQueue(name: string): this` | Route the job to a named queue (default: `'default'`) |
| `delay()` | `delay(ms: number): this` | Delay execution by the given number of milliseconds |
| `send()` | `send(): Promise<void>` | Dispatch the job to the queue adapter |

## Configuration

Register the queue provider in `bootstrap/providers.ts` using the `queue()` factory:

```ts
import { queue } from '@rudderjs/queue'
import configs from '../config/index.js'

export default [
  // ...other providers
  queue(configs.queue),
]
```

Define the queue config in `config/queue.ts`:

```ts
import { Env } from '@rudderjs/support'

export default {
  default: Env.get('QUEUE_CONNECTION', 'sync'),
  connections: {
    sync: {
      driver: 'sync',
    },
  },
}
```

### QueueConfig Shape

```ts
interface QueueConfig {
  default:     string                                  // name of the default connection
  connections: Record<string, QueueConnectionConfig>  // named connection definitions
}
```

### QueueConnectionConfig Shape

```ts
interface QueueConnectionConfig {
  driver: string           // 'sync' | 'bullmq' | 'inngest' | any registered driver
  [key: string]: unknown   // driver-specific options
}
```

## Built-in Driver: `sync`

The `sync` driver runs jobs immediately in the current process — no Redis, no external worker required. It is the default for local development and testing:

```ts
connections: {
  sync: {
    driver: 'sync',
  },
}
```

When `QUEUE_CONNECTION=sync`, calling `SendEmailJob.dispatch(...).send()` executes `handle()` inline before returning.

## Rudder Commands

The queue provider registers the following rudder commands. Commands that require adapter support (anything beyond `sync`) throw an error when invoked with an unsupported driver.

| Command | Description |
|---|---|
| `queue:work [queue]` | Start a long-running worker. Defaults to `default` queue. |
| `queue:status [queue]` | Show waiting/active/completed/failed/delayed/paused counts. |
| `queue:clear [queue]` | Drain all waiting and delayed jobs from a queue. |
| `queue:failed [queue]` | List recently failed jobs. |
| `queue:retry [queue]` | Re-enqueue all failed jobs. |

```bash
pnpm rudder queue:work
pnpm rudder queue:work notifications

pnpm rudder queue:status
pnpm rudder queue:failed default
pnpm rudder queue:retry default
```

The `sync` driver does not support `queue:work` — it throws an error with a hint to switch to `bullmq`. The `sync` driver executes jobs inline at dispatch time, so no background worker is needed.

## Job Chaining

Execute jobs sequentially — if any job fails, the chain stops:

```ts
import { Chain } from '@rudderjs/queue'

await Chain.of([
  new ProcessUpload(fileId),
  new GenerateThumbnail(fileId),
  new NotifyUser(userId),
])
  .onFailure((err, job) => console.error('Chain failed at', job))
  .onQueue('media')
  .dispatch()
```

Jobs in a chain share state via `getChainState(this)`:

```ts
import { Job, getChainState } from '@rudderjs/queue'

class Step2 extends Job {
  async handle() {
    const state = getChainState(this)
    console.log(state['resultFromStep1'])
  }
}
```

---

## Job Batching

Dispatch multiple jobs in parallel with progress tracking and callbacks:

```ts
import { Bus } from '@rudderjs/queue'

const batch = await Bus.batch([
  new SendEmail(user1),
  new SendEmail(user2),
  new SendEmail(user3),
])
  .then(batch => console.log('All done!', batch.progress))
  .catch((err, batch) => console.error('Failed!', batch.failedJobs))
  .finally(batch => cleanup())
  .allowFailures()    // don't stop on individual failures
  .onQueue('mail')
  .dispatch()

batch.totalJobs      // 3
batch.processedJobs  // completed count
batch.failedJobs     // failed count
batch.pendingJobs    // remaining count
batch.progress       // 0..100
batch.finished       // boolean
batch.cancel()       // stop remaining jobs
```

---

## Unique Jobs

Prevent duplicate jobs from being dispatched:

```ts
import { Job } from '@rudderjs/queue'
import type { ShouldBeUnique } from '@rudderjs/queue'

class SyncInventory extends Job implements ShouldBeUnique {
  uniqueId() { return `sync-inventory-${this.warehouseId}` }
  uniqueFor() { return 3600 }  // lock held for 1 hour

  async handle() { /* ... */ }
}
```

`ShouldBeUniqueUntilProcessing` releases the lock when the job starts (not when it finishes).

---

## Job Middleware

Wrap job execution with reusable middleware:

```ts
import { Job, RateLimited, WithoutOverlapping, ThrottlesExceptions, Skip } from '@rudderjs/queue'

class ImportJob extends Job {
  middleware() {
    return [
      new RateLimited('api-calls', 60),        // max 60 per minute
      new WithoutOverlapping('import-lock'),    // no concurrent runs
      new ThrottlesExceptions(3, 5),            // back off after 3 errors in 5 min
      Skip.when(() => isMaintenanceMode()),     // skip conditionally
    ]
  }

  async handle() { /* ... */ }
}
```

| Middleware | Description |
|---|---|
| `RateLimited(key, max, decaySeconds?)` | Rate-limit job execution (cache-backed) |
| `WithoutOverlapping(key, expiresAfter?)` | Prevent concurrent execution |
| `ThrottlesExceptions(maxExceptions, decayMinutes?)` | Back off after repeated failures |
| `Skip.when(fn)` / `Skip.unless(fn)` | Conditionally skip execution |

---

## Queued Closures

Dispatch inline functions without defining a Job class:

```ts
import { dispatch } from '@rudderjs/queue'

await dispatch(async () => {
  await sendWelcomeEmail(user.email)
})

await dispatch(async () => { /* ... */ }, { queue: 'mail', delay: 5000 })
```

---

## Notes

- The built-in `sync` driver requires no additional packages and is always available.
- For Redis-backed queuing, use `@rudderjs/queue-bullmq`.
- For serverless/event-driven queuing, use `@rudderjs/queue-inngest`.
- Job payloads are passed as constructor arguments — ensure they are serializable if using an external driver.
- `static queue` sets the default queue name for the job class; `static retries` sets the retry count; `static delay` sets the default dispatch delay in milliseconds (default `0`).
- `Chain` and `Bus.batch` delegate to the adapter if it supports native chaining/batching; otherwise they wrap jobs for in-process execution.
- Job middleware and unique locks use `@rudderjs/cache` when available; they fail open (allow execution) without it.
- `dispatch(fn)` creates a lightweight job-like object — it works with any adapter.
