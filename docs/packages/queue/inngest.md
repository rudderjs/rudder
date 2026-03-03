# @forge/queue-inngest

Inngest serverless queue adapter for Forge.

## Installation

```bash
pnpm add @forge/queue-inngest inngest
```

## Configuration

Define the Inngest connection in `config/queue.ts`:

```ts
import { Env } from '@forge/core'
import { SendEmailJob } from '../app/Jobs/SendEmailJob.js'
import { ProcessImageJob } from '../app/Jobs/ProcessImageJob.js'

export default {
  default: Env.get('QUEUE_CONNECTION', 'inngest'),
  connections: {
    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID', 'my-forge-app'),
      signingKey: Env.get('INNGEST_SIGNING_KEY', ''),
      eventKey:   Env.get('INNGEST_EVENT_KEY', ''),
      baseUrl:    Env.get('APP_URL', 'http://localhost:3000'),
      jobs: [
        SendEmailJob,
        ProcessImageJob,
      ],
    },
  },
}
```

## Defining a Job

Extend `Job` and optionally set a static `retries` property:

```ts
import { Job } from '@forge/queue'

export class SendEmailJob extends Job {
  static jobName = 'SendEmailJob'
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

Dispatching works the same as any Forge queue adapter:

```ts
await SendEmailJob.dispatch('alice@example.com', 'Welcome!')
  .onQueue('default')
  .send()
```

Inngest receives a `forge/job.SendEmailJob` event and invokes the registered function handler.

## Event Naming Convention

Forge maps each job class to an Inngest event using the pattern:

```
forge/job.<JobName>
```

For example, `SendEmailJob` → `forge/job.SendEmailJob`. This is handled automatically — you do not need to define event names manually.

## Mounting the Serve Handler

Inngest requires an HTTP endpoint where it can deliver job invocations. Use `serveHandler()` to mount it in your routes:

```ts
import { router } from '@forge/router'
import { serveHandler } from '@forge/queue-inngest'
import configs from '../config/index.js'

router.post('/api/inngest', serveHandler(configs.queue.connections.inngest))
```

The handler verifies the Inngest signature on incoming requests and dispatches the correct job function.

## InngestConfig Options

| Option | Type | Required | Description |
|---|---|---|---|
| `driver` | `'inngest'` | Yes | Must be `'inngest'` |
| `appId` | `string` | Yes | Unique identifier for this application in Inngest Cloud |
| `signingKey` | `string` | No | Inngest signing key — required in production for request verification |
| `eventKey` | `string` | No | Inngest event API key — required in production for sending events |
| `baseUrl` | `string` | No | Public URL of your app where Inngest can reach `/api/inngest`; defaults to `APP_URL` |
| `jobs` | `Job[]` | Yes | Array of Job classes to register as Inngest functions |

## API

### `inngest(config)`

Returns a `QueueAdapterProvider` that integrates with the `queue()` factory:

```ts
import { inngest } from '@forge/queue-inngest'

const provider = inngest({
  appId: 'my-forge-app',
  jobs:  [SendEmailJob, ProcessImageJob],
})
```

Normally you do not call `inngest()` directly — pass the connection config to `queue()` and the factory selects the adapter based on `driver: 'inngest'`.

## Bootstrap Integration

```ts
import { queue } from '@forge/queue'
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
INNGEST_APP_ID=my-forge-app
INNGEST_SIGNING_KEY=signkey-prod-xxxxxxxxxxxx
INNGEST_EVENT_KEY=xxxxxxxxxxxxxxxxxx
APP_URL=https://api.myapp.com
```

Inngest Cloud will call your `/api/inngest` endpoint to register functions and deliver invocations. The `signingKey` is used to verify that requests genuinely originate from Inngest.

## Notes

- Every Job class in the `jobs[]` array is registered as a distinct Inngest function when the application boots. Functions not in the array cannot be invoked by Inngest.
- In dev mode, the Inngest Dev Server at `localhost:8288` intercepts all events — you do not need cloud credentials.
- Set `APP_URL` to your public-facing URL in production so Inngest Cloud can reach the serve handler.
- Retries are configured per job via `static retries` on the Job class. If not set, Inngest applies its default retry policy.
- The `delay()` option on `DispatchBuilder` is supported — Inngest schedules the event delivery accordingly.
