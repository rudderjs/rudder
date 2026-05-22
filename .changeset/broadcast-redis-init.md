---
"@rudderjs/broadcast-redis": minor
---

New package — Redis pub/sub driver for `@rudderjs/broadcast`.

```bash
pnpm add @rudderjs/broadcast-redis ioredis
```

```ts
// config/broadcast.ts
import { RedisDriver } from '@rudderjs/broadcast-redis'

export default {
  driver: () => new RedisDriver({ redis: process.env.REDIS_URL! }),
}
```

Fans every `broadcast()` call across every app instance via a single Redis pub/sub channel (`rudderjs:broadcast:fanout` by default; override via the `prefix` option). Replaces the single-process Map walk so 2+ instance deployments no longer silently drop half their broadcast messages.

Ships two doctor checks:

- `broadcast-redis:url` — confirms `REDIS_URL` (or `BROADCAST_REDIS_URL`) is set
- `broadcast-redis:connectivity` — under `rudder doctor --deep`, connects + PINGs

The driver tags every envelope with a per-instance origin id and strips `excludeConnectionId` on foreign-origin deliveries so the `client-event` echo guard works correctly across the cluster.

When you pass an existing ioredis instance via `{ redis: client }`, the driver duplicates it for the subscriber connection (ioredis subscribers can't publish on the same connection) and `close()` only disconnects the duplicate — your publisher stays open. URL form (`{ redis: 'redis://...' }`) is fully driver-owned.

Initial 1.0.0 release per the `@rudderjs/cashier-paddle` precedent for new feature packages with stable APIs.
