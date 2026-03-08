# @boostkit/queue-bullmq

BullMQ Redis-backed queue adapter for BoostKit.

```bash
pnpm add @boostkit/queue-bullmq bullmq ioredis
```

---

## Setup

```ts
// config/queue.ts
import { Env } from '@boostkit/core'
import { SendEmailJob } from '../app/Jobs/SendEmailJob.js'

export default {
  default: Env.get('QUEUE_CONNECTION', 'bullmq'),
  connections: {
    bullmq: {
      driver:   'bullmq',
      host:     Env.get('REDIS_HOST', '127.0.0.1'),
      port:     Env.getNumber('REDIS_PORT', 6379),
      password: Env.get('REDIS_PASSWORD', ''),
      prefix:   'boostkit',
      jobs:     [SendEmailJob],
    },
  },
}
```

```ts
// bootstrap/providers.ts
import { queue } from '@boostkit/queue'
import configs from '../config/index.js'

export default [queue(configs.queue)]
```

---

## Defining a Job

```ts
import { Job } from '@boostkit/queue'

export class SendEmailJob extends Job {
  static queue   = 'mail'
  static retries = 3

  constructor(
    private readonly to:      string,
    private readonly subject: string,
  ) {
    super()
  }

  async handle(): Promise<void> {
    // send the email
  }
}
```

```ts
await SendEmailJob.dispatch('alice@example.com', 'Welcome!')
  .onQueue('mail')
  .delay(2000)
  .send()
```

---

## Running the Worker

```bash
pnpm artisan queue:work
pnpm artisan queue:work mail
pnpm artisan queue:work default,mail,notifications
```

Handles `SIGTERM`/`SIGINT` for graceful shutdown — in-flight jobs complete before the process exits.

---

## `BullMQConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | Full Redis URL — overrides `host`/`port` when set |
| `host` | `string` | `'127.0.0.1'` | Redis host |
| `port` | `number` | `6379` | Redis port |
| `password` | `string` | — | Redis password |
| `prefix` | `string` | `'boostkit'` | Key prefix for all BullMQ Redis keys |
| `concurrency` | `number` | `1` | Jobs processed in parallel per worker |
| `removeOnComplete` | `number` | `100` | Completed jobs to keep in Redis |
| `removeOnFail` | `number` | `500` | Failed jobs to keep in Redis |
| `jobs` | `Job[]` | `[]` | Job classes the worker can execute |

---

## Notes

- All Job classes that workers need to execute must be in the `jobs[]` array. The worker resolves handlers by the JavaScript class name — keep class names stable across deploys.
- `url` takes precedence over `host`/`port` when both are provided.
- BullMQ requires Redis 5.0 or higher with Lua scripting enabled.
