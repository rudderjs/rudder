# @rudderjs/queue-inngest

## Overview

Serverless queue driver for `@rudderjs/queue` backed by [Inngest](https://www.inngest.com/). Jobs dispatch as Inngest events (`rudderjs/job.<ClassName>`); Inngest's platform handles retries, concurrency, scheduling, and observability. No long-running worker process — Inngest calls back to a webhook endpoint your app exposes at `/api/inngest`.

## Key Patterns

### Configure (`config/queue.ts`)

```ts
import type { QueueConfig } from '@rudderjs/queue'
import { SendWelcomeEmail } from '../app/Jobs/SendWelcomeEmail.js'

export default {
  default: 'inngest',
  connections: {
    inngest: {
      driver:    'inngest',
      appId:     'my-app',                                        // Inngest app id
      eventKey:  Env.get('INNGEST_EVENT_KEY', ''),                // dispatch credential
      signingKey: Env.get('INNGEST_SIGNING_KEY', ''),             // webhook validation
      jobs:      [SendWelcomeEmail],                              // EVERY job class you'll dispatch
    },
  },
} satisfies QueueConfig
```

The driver is auto-loaded by `@rudderjs/queue` when `connection.driver === 'inngest'`.

### Webhook endpoint

The driver mounts a Hono-compatible handler at `/api/inngest` during provider boot — that's where Inngest calls back. The endpoint must be **publicly reachable** (Inngest's runners ping it). In dev, ngrok / Tailscale / `cloudflared` are common bridges.

### Job → event mapping

```ts
class SendWelcomeEmail extends Job {
  static override retries = 5            // → Inngest function retries (capped 0–20)

  constructor(private userId: string) { super() }

  async handle(): Promise<void> { /* … */ }
}

await SendWelcomeEmail.dispatch('user-123').send()
// fires Inngest event `rudderjs/job.SendWelcomeEmail` with { payload, queue } in data
```

The adapter registers one Inngest function per job class. On the callback, it deserializes the payload, reconstructs the `Job` instance, and invokes `handle()`.

### Local dev

```bash
npx inngest-cli@latest dev
```

Runs an Inngest dev server that intercepts events locally instead of sending them to production. Your app's `/api/inngest` endpoint registers with the dev server on boot — no signature validation in dev.

## Common Pitfalls

- **`/api/inngest` not publicly reachable**: Inngest can't deliver. Use a tunnel (ngrok, cloudflared) in development; ensure no global auth middleware blocks the path.
- **Missing `INNGEST_SIGNING_KEY` in production**: webhook calls fail signature validation. Required in production; optional locally when using the dev server.
- **Job class not in `connection.jobs[]`**: dispatch succeeds (events go to Inngest), but the inbound callback fails because no Inngest function was registered for the class. Add every job class.
- **Class renames break events in flight**: events already queued at Inngest carry the old `rudderjs/job.<OldName>` event name. Drain or pause before renaming, or keep an alias class.
- **No `queue:work` command**: unlike BullMQ, Inngest is serverless — there's no worker loop to start. `pnpm rudder queue:status` / `queue:failed` aren't supported either (Inngest's dashboard is the source of truth).
- **Constructor args must JSON-round-trip**: same as every queue driver — pass primitives / ids, re-fetch inside `handle()`.

## Key Imports

```ts
import { Job } from '@rudderjs/queue'
import {
  InngestAdapter,          // adapter implementation (resolved by the queue facade)
} from '@rudderjs/queue-inngest'

import type {
  InngestConfig,           // shape of connections[].inngest
} from '@rudderjs/queue-inngest'
```

## Required peer

`inngest`. Install:

```bash
pnpm add @rudderjs/queue-inngest inngest
```
