# @rudderjs/broadcast

## Overview

Native WebSocket server — public/private/presence channels with pub/sub messaging. Runs on the same port as your HTTP server (no separate process, no Pusher). Provides the `broadcast()` helper to push events from anywhere in the app, `Broadcast.channel()` for auth callbacks, and `RudderSocket` (vendored client) for the browser. Shares upgrade handler with `@rudderjs/sync` via `@rudderjs/vite` in dev and `@rudderjs/server-hono` in prod. Multi-instance deployments install `@rudderjs/broadcast-redis` for cross-process fan-out via the pluggable `BroadcastDriver` interface — single-instance keeps the default in-process `LocalDriver`.

## Key Patterns

### Setup

```ts
// bootstrap/providers.ts
import { BroadcastingProvider } from '@rudderjs/broadcast'
export default [BroadcastingProvider]

// bootstrap/app.ts — add channels loader
.withRouting({
  channels: () => import('../routes/channels.ts'),
})

// routes/channels.ts — auth callbacks for private + presence channels
import { Broadcast } from '@rudderjs/broadcast'

Broadcast.channel('private-orders.*', async (req) => {
  const user = await verifyToken(req.token)
  return !!user
})

Broadcast.channel('presence-room.*', async (req) => {
  const user = await verifyToken(req.token)
  return user ? { id: user.id, name: user.name } : false
})
```

### Channel types

| Type | Prefix | Auth | Use case |
|---|---|---|---|
| Public | — | none | Chat, notifications, feeds |
| Private | `private-` | return `true`/`false` | User-specific events |
| Presence | `presence-` | return member info (or `false`) | Collaborative rooms, online indicators |

Wildcard patterns use `*` (matches non-dot characters). `private-orders.*` matches `private-orders.42` but not `private-orders.42.items`.

### Broadcasting from server code

```ts
import { broadcast } from '@rudderjs/broadcast'

await broadcast('news', 'article.published', { id: 42, title: 'Hello' })
await broadcast('private-orders.1', 'status.updated', { status: 'shipped' })
```

`broadcast()` returns `Promise<void>` — resolves once the configured driver has accepted the message. Same-tick on the default `LocalDriver`; one Redis round-trip on the multi-instance `RedisDriver`. `await` it (or `void broadcast(...)` if you don't care about back-pressure).

### Multi-instance deployments

```bash
pnpm add @rudderjs/broadcast-redis ioredis
```

```ts
// config/broadcast.ts
import type { BroadcastConfig } from '@rudderjs/broadcast'
import { RedisDriver }           from '@rudderjs/broadcast-redis'

export default {
  driver: () => new RedisDriver({ redis: process.env.REDIS_URL! }),
} satisfies BroadcastConfig
```

Default `LocalDriver` walks an in-process subscriber map only — fine for one Node process. As soon as you run 2+ instances behind a load balancer, a `broadcast()` call from instance B silently delivers to nobody on instance A. `RedisDriver` fans every message across instances via Redis pub/sub. Channel auth, presence, telescope observability all unchanged.

### Client (RudderSocket)

```bash
pnpm rudder vendor:publish --tag=broadcast-client
```

```ts
import { RudderSocket } from './vendor/RudderSocket'

const socket = new RudderSocket('ws://localhost:3000/ws')

const chat = socket.channel('chat')
chat.on('message', handler)
chat.emit('typing', { user: 'Alice' })

const orders = socket.private('orders.42', authToken)
orders.on('status.updated', handler)

const room = socket.presence('room.lobby', authToken)
room.on('presence.joined', ({ user }) => { ... })
room.on('presence.left',   ({ user }) => { ... })
```

### Observability

If `@rudderjs/telescope` is installed, every connection, subscribe, unsubscribe, broadcast, and auth failure records under the **Broadcasts** tab. Entries group by `connectionId` for full-lifecycle view. No config needed.

## Common Pitfalls

- **Missing `channels` loader in `withRouting`.** Auth callbacks never register — all private/presence subscribes fail. Add `channels: () => import('../routes/channels.ts')` to `withRouting`.
- **Global middleware on WebSocket upgrades.** HTTP middleware doesn't run on upgrade requests. Auth for WebSockets lives in the `Broadcast.channel()` callback, not middleware.
- **`broadcast()` in tests.** Fires real WebSocket frames to any connected clients. In tests, either skip WS server startup or use `broadcastStats()` to verify emits without connecting clients.
- **Prefix convention.** Private channels MUST start with `private-`, presence with `presence-`. `Broadcast.channel('orders.*', ...)` matches nothing because `orders.42` isn't a private or presence name — it's a public channel that doesn't need auth. The registry only fires the callback for prefixed names.
- **`client-event` frames.** Clients can emit events that broadcast to other subscribers. These are separate from server-originated `broadcast()` calls — your protocol needs to distinguish if it matters.
- **Port sharing in dev.** `@rudderjs/vite`'s `rudderjs:ws` plugin hooks the Vite dev server for upgrades. If you're running a custom Vite config without `@rudderjs/vite`, WS won't work — add the plugin.
- **Multi-instance silent drop.** The default `LocalDriver` walks an in-process map only — any deployment with 2+ Node processes silently drops half its broadcasts (publisher on instance B has zero local subscribers for a channel only subscribed on instance A). Install `@rudderjs/broadcast-redis` and set `config.broadcast.driver = () => new RedisDriver({ redis: env.REDIS_URL })`. Single-instance keeps `LocalDriver`.

## Key Imports

```ts
import { BroadcastingProvider, broadcast, Broadcast, broadcastStats } from '@rudderjs/broadcast'
import { Channel, PrivateChannel, PresenceChannel } from '@rudderjs/broadcast'
import { LocalDriver }                              from '@rudderjs/broadcast'
import { RedisDriver }                              from '@rudderjs/broadcast-redis'

import type { BroadcastConfig, BroadcastAuthRequest, AuthCallback } from '@rudderjs/broadcast'
import type { BroadcastDriver, BroadcastMeta }                       from '@rudderjs/broadcast'
```
