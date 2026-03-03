# @forge/queue

Queue job abstractions, registry, and provider factory.

## Installation

```bash
pnpm add @forge/queue
```

This package provides the `Job` base class, the `DispatchBuilder` fluent interface, the `QueueAdapter` contract, and the `queue()` provider factory. It does not include a driver — use it with `@forge/queue-bullmq` or `@forge/queue-inngest` for real background processing, or rely on the built-in `sync` driver for in-process execution.

## Defining a Job

Extend `Job` and implement `handle()`:

```ts
import { Job } from '@forge/queue'

export class SendEmailJob extends Job {
  static jobName = 'SendEmailJob'

  constructor(private readonly to: string, private readonly subject: string) {
    super()
  }

  async handle(): Promise<void> {
    // send the email
    console.log(`Sending email to ${this.to}: ${this.subject}`)
  }
}
```

## Dispatching a Job

Use the fluent `DispatchBuilder` to dispatch jobs:

```ts
import { SendEmailJob } from './app/Jobs/SendEmailJob.js'

// basic dispatch (uses default queue)
await SendEmailJob.dispatch('alice@example.com', 'Welcome!').send()

// specify queue name and delay
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
import { queue } from '@forge/queue'
import configs from '../config/index.js'

export default [
  // ...other providers
  queue(configs.queue),
]
```

Define the queue config in `config/queue.ts`:

```ts
import { Env } from '@forge/core'

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
  default:     string                              // name of the default connection
  connections: Record<string, QueueConnectionConfig>  // named connection definitions
}
```

### QueueConnectionConfig Shape

```ts
interface QueueConnectionConfig {
  driver: string   // 'sync' | 'bullmq' | 'inngest' | any registered driver
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

## `queue:work` Command

The `queue:work` artisan command starts a long-running worker process that polls the queue and executes jobs:

```bash
pnpm artisan queue:work
pnpm artisan queue:work --queue=notifications
pnpm artisan queue:work --connection=bullmq
```

The worker uses the adapter registered for the active connection. For `sync`, this command is a no-op.

## Notes

- Register all Job classes in the adapter's `jobs[]` array (required by BullMQ and Inngest) so the worker can resolve jobs by name at runtime.
- The built-in `sync` driver requires no additional packages and is always available.
- For Redis-backed queuing, use `@forge/queue-bullmq`.
- For serverless/event-driven queuing, use `@forge/queue-inngest`.
- Job payloads are serialized to JSON — ensure constructor arguments are JSON-serializable.
