# @boostkit/queue

Queue job abstractions, registry, and provider factory.

## Installation

```bash
pnpm add @boostkit/queue
```

This package provides the `Job` base class, the `DispatchBuilder` fluent interface, the `QueueAdapter` contract, and the `queue()` provider factory. It does not include a driver — use it with `@boostkit/queue-bullmq` or `@boostkit/queue-inngest` for real background processing, or rely on the built-in `sync` driver for in-process execution.

## Defining a Job

Extend `Job` and implement `handle()`:

```ts
import { Job } from '@boostkit/queue'

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
import { queue } from '@boostkit/queue'
import configs from '../config/index.js'

export default [
  // ...other providers
  queue(configs.queue),
]
```

Define the queue config in `config/queue.ts`:

```ts
import { Env } from '@boostkit/support'

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

## Artisan Commands

The queue provider registers the following artisan commands. Commands that require adapter support (anything beyond `sync`) throw an error when invoked with an unsupported driver.

| Command | Description |
|---|---|
| `queue:work [queue]` | Start a long-running worker. Defaults to `default` queue. |
| `queue:status [queue]` | Show waiting/active/completed/failed/delayed/paused counts. |
| `queue:clear [queue]` | Drain all waiting and delayed jobs from a queue. |
| `queue:failed [queue]` | List recently failed jobs. |
| `queue:retry [queue]` | Re-enqueue all failed jobs. |

```bash
pnpm artisan queue:work
pnpm artisan queue:work notifications

pnpm artisan queue:status
pnpm artisan queue:failed default
pnpm artisan queue:retry default
```

The `sync` driver does not support `queue:work` — it throws an error with a hint to switch to `bullmq`. The `sync` driver executes jobs inline at dispatch time, so no background worker is needed.

## Notes

- The built-in `sync` driver requires no additional packages and is always available.
- For Redis-backed queuing, use `@boostkit/queue-bullmq`.
- For serverless/event-driven queuing, use `@boostkit/queue-inngest`.
- Job payloads are passed as constructor arguments — ensure they are serializable if using an external driver.
- `static queue` sets the default queue name for the job class; `static retries` sets the retry count; `static delay` sets the default dispatch delay in milliseconds (default `0`).
