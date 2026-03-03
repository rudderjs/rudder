# @boostkit/queue-inngest

Inngest serverless queue adapter for `@boostkit/queue`.

## Installation

```bash
pnpm add @boostkit/queue-inngest inngest
```

## Usage

### 1. Configure the queue

```ts
// config/queue.ts
import { Env } from '@boostkit/core/support'
import { SendWelcomeEmailJob } from '../app/Jobs/SendWelcomeEmailJob.js'

export default {
  default: 'inngest',
  connections: {
    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID', 'my-forge-app'),
      signingKey: Env.get('INNGEST_SIGNING_KEY'),
      eventKey:   Env.get('INNGEST_EVENT_KEY'),
      baseUrl:    Env.get('APP_URL', 'http://localhost:3000'),
      jobs: [
        SendWelcomeEmailJob,
      ],
    },
  },
}
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { queue } from '@boostkit/queue'
import configs from '../config/index.js'

export default [
  queue(configs.queue),
]
```

### 3. Mount the Inngest endpoint

Inngest requires an HTTP endpoint to receive function registration and event delivery. Mount it in your routes:

```ts
// routes/api.ts
import { router } from '@boostkit/router'
import { inngest } from '@boostkit/queue-inngest'
import configs from '../config/index.js'

// Mount the Inngest serve handler at /api/inngest
router.all('/api/inngest', inngest(configs.queue.connections.inngest).serveHandler())
```

### 4. Define jobs

```ts
// app/Jobs/SendWelcomeEmailJob.ts
import { Job } from '@boostkit/queue'

export class SendWelcomeEmailJob extends Job {
  static retries = 3   // Optional: override default retry count

  constructor(private readonly data: { email: string; name: string }) {
    super()
  }

  async handle(): Promise<void> {
    await sendEmail({
      to:      this.data.email,
      subject: 'Welcome!',
      body:    `Hello, ${this.data.name}!`,
    })
  }
}
```

### 5. Dispatch jobs

```ts
import { SendWelcomeEmailJob } from '../app/Jobs/SendWelcomeEmailJob.js'

await SendWelcomeEmailJob.dispatch({
  data: { email: 'alice@example.com', name: 'Alice' }
}).send()
```

## API Reference

- `InngestConfig`
- `inngest(config)` → `QueueAdapterProvider`
- `inngest(config).serveHandler()` → route handler for `router.all('/api/inngest', ...)`

## Configuration

- `InngestConfig`
  - `driver` — `'inngest'`
  - `appId` — unique app identifier shown in the Inngest dashboard
  - `signingKey?` — Inngest signing key (required in production)
  - `eventKey?` — Inngest event key (required in production)
  - `baseUrl?` — app's public URL (Inngest uses this to call your serve endpoint)
  - `jobs` — array of job classes to register with Inngest

## Event Naming

Forge maps job class names to Inngest event names using the pattern:

```
forge/job.<ClassName>
```

For example, `SendWelcomeEmailJob` is dispatched as the `forge/job.SendWelcomeEmailJob` event.

## Retries

Override the default retry count on a job class:

```ts
export class SendWelcomeEmailJob extends Job {
  static retries = 5   // retry up to 5 times on failure
  // ...
}
```

## Development Setup

In development, run the [Inngest Dev Server](https://www.inngest.com/docs/dev-server) locally:

```bash
npx inngest-cli@latest dev
```

The dev server runs at `http://localhost:8288` and automatically discovers your functions by calling the `/api/inngest` endpoint. No signing key is needed in development.

Set `APP_URL` so Inngest can reach your endpoint:

```dotenv
APP_URL=http://localhost:3000
INNGEST_APP_ID=my-forge-app
```

## Production Setup

In production (Inngest Cloud):

```dotenv
INNGEST_APP_ID=my-forge-app
INNGEST_SIGNING_KEY=signkey-prod-...
INNGEST_EVENT_KEY=eventkey-...
APP_URL=https://my-app.example.com
```

Inngest will call your `/api/inngest` endpoint to register functions and deliver events.

## Notes

- All job classes must be listed in the `jobs` array for Inngest to register them
- The `/api/inngest` route must be publicly reachable for Inngest to deliver events
- Inngest handles retries, concurrency, and observability automatically via the dashboard
- `serveHandler()` returns a `MiddlewareHandler` compatible with `router.all()`
