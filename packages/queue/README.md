# @rudderjs/queue

Queue job abstractions, registry, and provider factory with built-in `sync` driver and plugin support for `inngest` and `bullmq`.

## Installation

```bash
pnpm add @rudderjs/queue
```

## Setup

```ts
// config/queue.ts
import type { QueueConfig } from '@rudderjs/queue'

export default {
  default: Env.get('QUEUE_CONNECTION', 'sync'),
  connections: {
    sync: { driver: 'sync' },
    bullmq: { driver: 'bullmq', host: '127.0.0.1', port: 6379 },
  },
} satisfies QueueConfig
```

```ts
// bootstrap/providers.ts
import { queue } from '@rudderjs/queue'
import configs from '../config/index.js'

export default [queue(configs.queue)]
```

## Defining Jobs

```ts
import { Job } from '@rudderjs/queue'

export class SendWelcomeEmail extends Job {
  static override queue   = 'emails'
  static override retries = 5
  static override delay   = 0

  constructor(private readonly userId: string) { super() }

  async handle(): Promise<void> {
    // send the email
  }

  async failed(error: unknown): Promise<void> {
    // called when all retries are exhausted
    console.error('SendWelcomeEmail failed', error)
  }
}
```

## Dispatching Jobs

```ts
// Dispatch with defaults from static properties
await SendWelcomeEmail.dispatch('user-123').send()

// Override queue and delay at call site
await SendWelcomeEmail.dispatch('user-123')
  .onQueue('priority')
  .delay(5000)
  .send()
```

## `Job` Static Properties

| Property  | Default     | Description                              |
|-----------|-------------|------------------------------------------|
| `queue`   | `'default'` | Queue name to dispatch to.               |
| `retries` | `3`         | Retry attempts before calling `failed()`. |
| `delay`   | `0`         | Delay in ms before the job runs.         |

## `DispatchBuilder` Methods

| Method            | Returns           | Description                       |
|-------------------|-------------------|-----------------------------------|
| `delay(ms)`       | `this`            | Override the job delay (ms).      |
| `onQueue(name)`   | `this`            | Override the target queue name.   |
| `send()`          | `Promise<void>`   | Dispatch the job.                 |

## Configuration

### `QueueConfig`

```ts
interface QueueConfig {
  default: string
  connections: Record<string, QueueConnectionConfig>
}
```

### `QueueConnectionConfig`

```ts
// Sync (built-in — runs jobs immediately in-process)
{ driver: 'sync' }

// BullMQ (requires: pnpm add @rudderjs/queue-bullmq ioredis)
{ driver: 'bullmq', host: '127.0.0.1', port: 6379 }

// Inngest (requires: pnpm add @rudderjs/queue-inngest inngest)
{ driver: 'inngest', eventKey: '...', signingKey: '...' }
```

## Built-in Drivers

### `sync`

Runs jobs immediately in the same process. No external dependencies. Good for development and testing.

```ts
{ driver: 'sync' }
```

## Plugin Drivers

| Driver    | Package                    | Install                                    |
|-----------|----------------------------|--------------------------------------------|
| `bullmq`  | `@rudderjs/queue-bullmq`   | `pnpm add @rudderjs/queue-bullmq ioredis`  |
| `inngest` | `@rudderjs/queue-inngest`  | `pnpm add @rudderjs/queue-inngest inngest` |

## Rudder Commands

| Command          | Description                                     |
|------------------|-------------------------------------------------|
| `queue:work`     | Start a queue worker (BullMQ only).             |
| `queue:status`   | Show waiting/active/completed/failed counts.    |
| `queue:clear`    | Drain waiting and delayed jobs from a queue.    |
| `queue:failed`   | List recently failed jobs.                      |
| `queue:retry`    | Re-enqueue all failed jobs.                     |

```bash
pnpm rudder queue:work
pnpm rudder queue:work emails,default
pnpm rudder queue:status
pnpm rudder queue:status emails
pnpm rudder queue:clear
pnpm rudder queue:failed
pnpm rudder queue:retry
```

## `QueueRegistry`

```ts
import { QueueRegistry } from '@rudderjs/queue'

const adapter = QueueRegistry.get()  // QueueAdapter | null
```

## `SyncAdapter`

Exported for standalone use and testing:

```ts
import { SyncAdapter } from '@rudderjs/queue'

const adapter = new SyncAdapter()
await adapter.dispatch(new MyJob())
```

## Notes

- TTL/delay values are in **milliseconds**.
- `sync` driver ignores `delay` — jobs run immediately.
- `SyncAdapter` calls `job.failed()` before re-throwing on error.
- All commands are registered in `boot()` — they appear in `pnpm rudder --help` regardless of driver.
- Commands that the active driver doesn't support throw an error with a helpful message.
