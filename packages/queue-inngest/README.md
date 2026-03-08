# @boostkit/queue-inngest

Inngest serverless queue adapter for `@boostkit/queue`.

```bash
pnpm add @boostkit/queue-inngest inngest
```

---

## Setup

```ts
// config/queue.ts
import { Env } from '@boostkit/support'
import { SendWelcomeEmailJob } from '../app/Jobs/SendWelcomeEmailJob.js'

export default {
  default: 'inngest',
  connections: {
    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID', 'my-boostkit-app'),
      signingKey: Env.get('INNGEST_SIGNING_KEY'),
      eventKey:   Env.get('INNGEST_EVENT_KEY'),
      jobs: [SendWelcomeEmailJob],
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

The queue provider automatically mounts the Inngest serve handler at `/api/inngest`.

---

## Defining a Job

```ts
import { Job } from '@boostkit/queue'

export class SendWelcomeEmailJob extends Job {
  static retries = 3

  constructor(
    private readonly email: string,
    private readonly name:  string,
  ) {
    super()
  }

  async handle(): Promise<void> {
    // send the email
  }
}
```

```ts
await SendWelcomeEmailJob.dispatch('alice@example.com', 'Alice').send()
```

---

## `InngestConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `appId` | `string` | `'boostkit-app'` | Unique app identifier shown in the Inngest dashboard |
| `eventKey` | `string` | — | Inngest event key (required in production) |
| `signingKey` | `string` | — | Inngest signing key (required in production) |
| `jobs` | `Job[]` | `[]` | Job classes to register as Inngest functions |

---

## Event Naming

BoostKit maps job class names to Inngest event names:

```
boostkit/job.<ClassName>
```

`SendWelcomeEmailJob` → `boostkit/job.SendWelcomeEmailJob`

---

## Notes

- All job classes that handle events must be listed in the `jobs` array.
- The `/api/inngest` route must be publicly reachable for Inngest to deliver events.
- In development, run the [Inngest Dev Server](https://www.inngest.com/docs/dev-server): `npx inngest-cli@latest dev`
- In production, set `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` environment variables.
- Inngest handles retries, concurrency, and observability automatically via the dashboard.
