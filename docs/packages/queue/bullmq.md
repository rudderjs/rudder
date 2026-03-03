# @forge/queue-bullmq

BullMQ Redis-backed queue adapter for Forge.

## Installation

```bash
pnpm add @forge/queue-bullmq bullmq ioredis
```

## Configuration

Define the BullMQ connection in `config/queue.ts`:

```ts
import { Env } from '@forge/core'
import { SendEmailJob } from '../app/Jobs/SendEmailJob.js'
import { ProcessImageJob } from '../app/Jobs/ProcessImageJob.js'

export default {
  default: Env.get('QUEUE_CONNECTION', 'bullmq'),
  connections: {
    bullmq: {
      driver:   'bullmq',
      url:      Env.get('REDIS_URL', ''),          // e.g. redis://localhost:6379
      host:     Env.get('REDIS_HOST', '127.0.0.1'),
      port:     Env.getNumber('REDIS_PORT', 6379),
      password: Env.get('REDIS_PASSWORD', ''),
      prefix:   Env.get('QUEUE_PREFIX', 'forge'),
      jobs: [
        SendEmailJob,
        ProcessImageJob,
      ],
    },
  },
}
```

## Bootstrap Integration

Register the queue provider in `bootstrap/providers.ts`:

```ts
import { queue } from '@forge/queue'
import configs from '../config/index.js'
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  DatabaseServiceProvider,
  AppServiceProvider,
  queue(configs.queue),
]
```

## Defining a Job

```ts
import { Job } from '@forge/queue'

export class SendEmailJob extends Job {
  static jobName = 'SendEmailJob'

  constructor(
    private readonly to:      string,
    private readonly subject: string,
    private readonly body:    string,
  ) {
    super()
  }

  async handle(): Promise<void> {
    // integrate with your mail service
    console.log(`Sending email to ${this.to}: ${this.subject}`)
  }
}
```

Dispatching it:

```ts
import { SendEmailJob } from './app/Jobs/SendEmailJob.js'

await SendEmailJob.dispatch('alice@example.com', 'Welcome to Forge', '<p>Hello!</p>')
  .onQueue('mail')
  .delay(2000)
  .send()
```

## BullMQConfig Options

| Option | Type | Default | Description |
|---|---|---|---|
| `driver` | `'bullmq'` | — | Must be set to `'bullmq'` |
| `url` | `string` | `''` | Full Redis URL (overrides host/port when set) |
| `host` | `string` | `'127.0.0.1'` | Redis host |
| `port` | `number` | `6379` | Redis port |
| `password` | `string` | `''` | Redis password (empty = no auth) |
| `prefix` | `string` | `'forge'` | Key prefix used for all BullMQ keys in Redis |
| `jobs` | `Job[]` | `[]` | Array of Job classes the worker can resolve by name |

## API

### `bullmq(config?)`

Returns a `QueueAdapterProvider` that integrates with the `queue()` factory:

```ts
import { bullmq } from '@forge/queue-bullmq'

const provider = bullmq({
  host:   '127.0.0.1',
  port:   6379,
  prefix: 'myapp',
  jobs:   [SendEmailJob],
})
```

Normally you do not call `bullmq()` directly — pass the connection config to `queue()` and the factory resolves the correct adapter based on `driver: 'bullmq'`.

## Running the Worker

Start the BullMQ worker with the `queue:work` artisan command:

```bash
pnpm artisan queue:work
pnpm artisan queue:work --queue=mail
pnpm artisan queue:work --queue=default,mail,notifications
```

The worker connects to Redis using the configured connection, registers all job handlers from the `jobs[]` array, and processes jobs as they arrive.

## Graceful Shutdown

When the worker process receives `SIGTERM` or `SIGINT` (e.g. from `Ctrl+C` or a process manager), the BullMQ adapter:

1. Stops accepting new jobs from the queue.
2. Waits for any currently executing job to complete.
3. Closes the Redis connection cleanly.

This ensures that in-flight jobs are never abandoned mid-execution during deployments or restarts.

## Notes

- All Job classes that the worker needs to execute must be listed in the `jobs[]` array of the BullMQ connection config. The worker resolves job handlers by matching `Job.jobName` — if a class is not in the array, the worker will fail to process that job type.
- `url` takes precedence over `host`/`port` when both are set.
- The `prefix` option namespaces all BullMQ keys in Redis, making it safe to share a single Redis instance across multiple applications or environments.
- BullMQ requires Redis 5.0 or higher with Lua scripting enabled.
