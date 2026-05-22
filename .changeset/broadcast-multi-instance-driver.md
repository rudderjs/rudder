---
"@rudderjs/broadcast": minor
---

Add `BroadcastDriver` interface + `LocalDriver` default for multi-instance fan-out.

`broadcast()` now routes through a pluggable driver. Single-instance deployments keep the in-process `LocalDriver` (same same-tick fan-out as before — no behaviour change). For 2+ instance deployments, install [`@rudderjs/broadcast-redis`](https://www.npmjs.com/package/@rudderjs/broadcast-redis) and wire it via `config/broadcast.ts`:

```ts
import { RedisDriver } from '@rudderjs/broadcast-redis'

export default {
  driver: () => new RedisDriver({ redis: process.env.REDIS_URL! }),
}
```

**API change:** `broadcast(channel, event, data)` now returns `Promise<void>` instead of `void`. Single-line `await` update at call sites:

```ts
// Before:
broadcast('chat', 'message', payload)
// After:
await broadcast('chat', 'message', payload)
```

Server-initiated broadcasts AND `client-event` frames now both fan out via the driver. The local subscriber loop receives all fan-out (whether produced locally or via Redis), so existing tests and observers continue to fire identically.

`BroadcastMeta.excludeConnectionId` carries the `client-event` echo guard through the driver — multi-instance drivers MUST drop it on foreign-origin deliveries (a connection id is only meaningful on its own instance). `RedisDriver` does this automatically by tagging each envelope with the origin instance id.

New exports: `BroadcastDriver`, `BroadcastMeta`, `LocalDriver`.

The `WsServerOptions.driver` and `BroadcastConfig.driver` fields are both optional — omitting them keeps the legacy single-instance behaviour.
