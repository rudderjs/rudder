# @boostkit/queue-bullmq

BullMQ Redis-backed queue adapter for BoostKit.

## Installation

```bash
pnpm add @boostkit/queue-bullmq bullmq ioredis
```

## Configuration

Define the BullMQ connection in `config/queue.ts`:

```ts
import { Env } from '@boostkit/core'
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
      prefix:   Env.get('QUEUE_PREFIX', 'boostkit'),
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
import { queue } from '@boostkit/queue'
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
import { Job } from '@boostkit/queue'

export class SendEmailJob extends Job {
  static queue   = 'mail'
  static retries = 3

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

await SendEmailJob.dispatch('alice@example.com', 'Welcome to BoostKit', '<p>Hello!</p>')
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
| `prefix` | `string` | `'boostkit'` | Prefixes all BullMQ keys in Redis |
| `concurrency` | `number` | `1` | Number of jobs each worker processes in parallel |
| `removeOnComplete` | `number` | `100` | Keep last N completed jobs in Redis |
| `removeOnFail` | `number` | `500` | Keep last N failed jobs in Redis |
| `jobs` | `Job[]` | `[]` | Job classes the worker can execute |

## API

### `bullmq(config?)`

Returns a `QueueAdapterProvider` that integrates with the `queue()` factory:

```ts
import { bullmq } from '@boostkit/queue-bullmq'

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
pnpm artisan queue:work mail
pnpm artisan queue:work default,mail,notifications
```

The worker connects to Redis using the configured connection, registers all job handlers from the `jobs[]` array, and processes jobs as they arrive.

## Graceful Shutdown

When the worker process receives `SIGTERM` or `SIGINT` (e.g. from `Ctrl+C` or a process manager), the BullMQ adapter:

1. Stops accepting new jobs from the queue.
2. Waits for any currently executing job to complete.
3. Closes the Redis connection cleanly.

This ensures that in-flight jobs are never abandoned mid-execution during deployments or restarts.

## Notes

- All Job classes that the worker needs to execute must be listed in the `jobs[]` array. The worker resolves handlers by the **JavaScript class name** (`JobClass.name`) — keep class names stable across deploys.
- `url` takes precedence over `host`/`port` when both are set.
- The `prefix` option namespaces all BullMQ keys in Redis, making it safe to share a single Redis instance across multiple applications or environments.
- BullMQ requires Redis 5.0 or higher with Lua scripting enabled.
