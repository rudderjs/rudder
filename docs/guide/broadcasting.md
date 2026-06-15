# Broadcasting

`@rudderjs/broadcast` is the framework's WebSocket pub/sub layer. It runs on the same port as your HTTP server, supports public, private, and presence channels, and ships a small client (`RudderSocket`) for the browser. No Pusher account, no separate process, no external service.

## Setup

```bash
pnpm add @rudderjs/broadcast
```

```ts
// bootstrap/providers.ts
import { BroadcastingProvider } from '@rudderjs/broadcast'

export default [
  ...(await defaultProviders()),
  BroadcastingProvider,
]
```

Add a channel-routes loader to `bootstrap/app.ts`:

```ts
Application.configure({ ... })
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    channels: () => import('../routes/channels.ts'),
  })
  .create()
```

`channels.ts` is where you register auth callbacks for non-public channels:

```ts
// routes/channels.ts
import { Broadcast } from '@rudderjs/broadcast'

Broadcast.channel('private-orders.*', async (req) => {
  const user = await verifyToken(req.token)
  return !!user
})

Broadcast.channel('presence-room.*', async (req) => {
  const user = await verifyToken(req.token)
  if (!user) return false
  return { id: user.id, name: user.name }
})
```

## Channel types

| Type | Prefix | Auth |
|---|---|---|
| Public | none | None — anyone can subscribe |
| Private | `private-` | Auth callback must return truthy |
| Presence | `presence-` | Auth callback returns the member info object (or `false` to deny) |

The pattern after the prefix supports `*` as a wildcard matching non-dot segments — `private-user.*` matches `private-user.42` but not `private-user.42.profile`.

## Broadcasting events

Push events from anywhere on the server — route handlers, jobs, services, listeners:

```ts
import { broadcast } from '@rudderjs/broadcast'

Route.post('/orders/:id/ship', async (req) => {
  await shipOrder(req.params.id)
  await broadcast(`orders.${req.params.id}`, 'order.shipped', { id: req.params.id })
  return { ok: true }
})
```

`broadcast(channel, event, payload)` returns a `Promise<void>` — it resolves once the configured driver has accepted the message. On the default `LocalDriver` that's same-tick, effectively fire-and-forget. With a multi-instance driver (see below) it resolves after one Redis round-trip. Subscribed clients receive the event asynchronously over the WebSocket.

## Multi-instance deployments

`@rudderjs/broadcast` ships an in-process `LocalDriver` by default. It walks the local subscriber map — fine for a single Node process, but a `broadcast()` call from any other instance silently delivers to nobody as soon as you scale beyond one process.

Install [`@rudderjs/broadcast-redis`](https://www.npmjs.com/package/@rudderjs/broadcast-redis) and point the broadcast config at it:

```bash
pnpm add @rudderjs/broadcast-redis ioredis
```

```ts
// config/broadcast.ts
import type { BroadcastConfig } from '@rudderjs/broadcast'
import { RedisDriver }           from '@rudderjs/broadcast-redis'

const config: BroadcastConfig = {
  driver: () => new RedisDriver({ redis: process.env.REDIS_URL! }),
}

export default config
```

That's it. Channel auth, server-originated `broadcast()` events, telescope, the rudder commands all fan across the cluster. Run `pnpm rudder doctor --deep` to verify `REDIS_URL` is set and reachable.

> **Presence channels are per-instance.** Presence rosters and `presence.joined` / `presence.left` events are tracked in each instance's memory and are NOT fanned across the driver, so a member connected to instance A is absent from the roster computed on instance B. Regular `broadcast()` and `client-event` traffic IS cluster-wide. If you need a single cluster-wide roster, pin presence-channel clients to one instance (sticky sessions) or aggregate roster state yourself. The provider logs a one-time notice at boot when a cross-instance driver is configured.

## The browser client

Publish the client into your project:

```bash
pnpm rudder vendor:publish --tag=broadcast-client
# → src/RudderSocket.ts
```

Use it from frontend code:

```ts
import { RudderSocket } from './RudderSocket'

const socket = new RudderSocket('ws://localhost:3000/ws')

// Public channel — no auth
const chat = socket.channel('chat')
chat.on('new-message', (msg) => console.log(msg.text))

// Private channel — auth callback fires server-side
const orders = socket.private(`orders.${orderId}`, userToken)
orders.on('order.shipped', (data) => showNotification(`Order ${data.id} shipped!`))

// Client events — broadcast back to other subscribers
chat.emit('typing', { user: 'Alice' })

// Presence — track who's in a room
const room = socket.presence('room.lobby', userToken)
room.on('presence.members', (members) => console.log('Online:', members))
room.on('presence.joined',  (user)    => console.log(`${user.name} joined`))
room.on('presence.left',    (user)    => console.log(`${user.name} left`))

orders.leave()
```

`RudderSocket` reconnects automatically after 3 seconds on disconnect and resubscribes to every active channel after reconnecting. The token is re-sent on each reconnect so the server can re-validate.

## Stats

```ts
import { broadcastStats } from '@rudderjs/broadcast'

const { connections, channels } = broadcastStats()
```

Or the rudder command:

```bash
pnpm rudder broadcast:connections
```

## Auth callback inputs

The auth callback receives the upgrade-time request and the channel name:

```ts
Broadcast.channel('private-user.*', async (req, channelName) => {
  // req.headers — HTTP headers from the WebSocket upgrade
  // req.url     — upgrade request URL
  // req.token   — token from the client's subscribe message
  // channelName — the resolved channel string (e.g. 'private-user.42')
  const user = await verifyToken(req.token)
  return !!user && user.id === parseUserIdFromChannel(channelName)
})
```

For presence channels, returning a member object publishes that member's metadata to other subscribers. Returning `false` denies the subscription.

## How it shares the HTTP port

Broadcasting hooks into Node's HTTP `upgrade` event on your existing server. In dev, `@rudderjs/vite` patches `http.createServer` so srvx's server gets the upgrade handler. In production, `@rudderjs/server-hono`'s `listen()` attaches it after `serve()` starts. The handler chain is:

```
HTTP server → /ws  → @rudderjs/broadcast
            → /ws-sync → @rudderjs/sync
            → /<other> → Vite HMR (dev only) or 404
```

Both real-time packages can coexist in the same process — they own different paths.

## Pitfalls

- **Channel auth callback running too late.** The callback fires on subscribe, not on every event. Re-validate inside the auth callback if your token can expire mid-session — or rely on token TTL + reconnect.
- **Forgetting `channels: () => import('./routes/channels.ts')`.** The provider boots cleanly but no auth callbacks are registered, so private/presence channels reject everyone.
- **Sending sensitive data to public channels.** Public means *unauthenticated*. Treat anything you broadcast there as world-readable.
- **Browser client without `RudderSocket`.** Hand-rolling the WebSocket protocol is fiddly — the client handles framing, channel multiplexing, and reconnect resubscribe. Vendor it once and forget.
