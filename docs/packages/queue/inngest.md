# @rudderjs/queue-inngest

Inngest serverless queue adapter for RudderJS.

## Installation

```bash
pnpm add @rudderjs/queue-inngest inngest
```

## Configuration

Define the Inngest connection in `config/queue.ts`:

```ts
import { Env } from '@rudderjs/core'
import { SendEmailJob } from '../app/Jobs/SendEmailJob.js'
import { ProcessImageJob } from '../app/Jobs/ProcessImageJob.js'

export default {
  default: Env.get('QUEUE_CONNECTION', 'inngest'),
  connections: {
    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID', 'my-rudderjs-app'),
      signingKey: Env.get('INNGEST_SIGNING_KEY', ''),
      eventKey:   Env.get('INNGEST_EVENT_KEY', ''),
      jobs: [
        SendEmailJob,
        ProcessImageJob,
      ],
    },
  },
}
```

## Defining a Job

Extend `Job` and optionally set `static retries`:

```ts
import { Job } from '@rudderjs/queue'

export class SendEmailJob extends Job {
  static retries = 3   // Inngest will retry failed executions up to 3 times

  constructor(
    private readonly to:      string,
    private readonly subject: string,
  ) {
    super()
  }

  async handle(): Promise<void> {
    console.log(`Sending email to ${this.to}: ${this.subject}`)
  }
}
```

Dispatching works the same as any RudderJS queue adapter:

```ts
await SendEmailJob.dispatch('alice@example.com', 'Welcome!')
  .onQueue('default')
  .send()
```

## Event Naming Convention

RudderJS maps each job class to an Inngest event using the pattern:

```
rudderjs/job.<ClassName>
```

For example, `SendEmailJob` → `rudderjs/job.SendEmailJob`. This is handled automatically — you do not need to define event names manually.

## Serve Handler

The Inngest adapter requires an HTTP endpoint (`/api/inngest`) where Inngest can deliver job invocations. The queue provider **mounts this route automatically** when it detects the Inngest adapter — no manual registration needed.

The provider calls:

```ts
router.all('/api/inngest', (req) => handler(req.raw))
```

This happens during `boot()` as part of `queue(configs.queue)`. Ensure the queue provider is registered before any route-level catch-all that might intercept `/api/inngest`.

## InngestConfig Options

| Option | Type | Required | Description |
|---|---|---|---|
| `driver` | `'inngest'` | Yes | Must be `'inngest'` |
| `appId` | `string` | Yes | Unique identifier for this application in Inngest Cloud |
| `signingKey` | `string` | No | Inngest signing key — required in production for request verification |
| `eventKey` | `string` | No | Inngest event API key — required in production for sending events |
| `jobs` | `Job[]` | Yes | Array of Job classes to register as Inngest functions |

## API

### `inngest(config)`

Returns a `QueueAdapterProvider` that integrates with the `queue()` factory:

```ts
import { inngest } from '@rudderjs/queue-inngest'

const provider = inngest({
  appId: 'my-rudderjs-app',
  jobs:  [SendEmailJob, ProcessImageJob],
})
```

Normally you do not call `inngest()` directly — pass the connection config to `queue()` and the factory selects the adapter based on `driver: 'inngest'`.

## Bootstrap Integration

```ts
import { queue } from '@rudderjs/queue'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,
  AppServiceProvider,
  queue(configs.queue),
]
```

## Development vs Production

### Development

In development, Inngest provides a local Dev Server that intercepts events and invokes your functions without a cloud account. Start it with:

```bash
npx inngest-cli@latest dev
```

The Inngest Dev Server runs at `http://localhost:8288` by default. It automatically discovers your `/api/inngest` endpoint and proxies events to it. No `signingKey` or `eventKey` is required locally.

### Production (Inngest Cloud)

In production, set the following environment variables:

```bash
INNGEST_APP_ID=my-rudderjs-app
INNGEST_SIGNING_KEY=signkey-prod-xxxxxxxxxxxx
INNGEST_EVENT_KEY=xxxxxxxxxxxxxxxxxx
```

Inngest Cloud will call your `/api/inngest` endpoint to register functions and deliver invocations. The `signingKey` is used to verify that requests genuinely originate from Inngest.

## Notes

- Every Job class in the `jobs[]` array is registered as a distinct Inngest function when the application boots. Functions not in the array cannot be invoked by Inngest.
- In dev mode, the Inngest Dev Server at `localhost:8288` intercepts all events — you do not need cloud credentials.
- Retries are configured per job via `static retries` on the Job class. If not set, Inngest applies its default retry policy.
- The `delay()` option on `DispatchBuilder` is supported — Inngest schedules the event delivery accordingly via the `ts` field.
- The `/api/inngest` route is registered by the queue provider automatically — do not mount it manually.
