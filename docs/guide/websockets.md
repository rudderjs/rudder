# WebSockets

BoostKit includes native WebSocket support via `@boostkit/ws` — channel-based pub/sub with public, private, and presence channels. It runs on the same port as your HTTP server. No Pusher, no Echo, no external service.

## Installation

```bash
pnpm add @boostkit/ws
```

## Setup

**1. Register the provider:**

```ts
// bootstrap/providers.ts
import { ws } from '@boostkit/ws'

export default [
  // ... other providers
  ws(),
]
```

**2. Add a channels route loader:**

```ts
// bootstrap/app.ts
export default Application.configure({ ... })
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    channels: () => import('../routes/channels.ts'),
  })
  .create()
```

**3. Register auth callbacks:**

```ts
// routes/channels.ts
import { ws } from '@boostkit/ws'

ws.auth('private-orders.*', async (req) => {
  const user = await getUserFromToken(req.token)
  return !!user
})

ws.auth('presence-room.*', async (req) => {
  const user = await getUserFromToken(req.token)
  if (!user) return false
  return { id: user.id, name: user.name }
})
```

## Channel Types

| Type | Prefix | Auth |
|---|---|---|
| Public | — | None — anyone can subscribe |
| Private | `private-` | Auth callback must return `true` |
| Presence | `presence-` | Auth callback returns member info object |

## Broadcasting

Push events from anywhere on the server — route handlers, jobs, service classes:

```ts
import { broadcast } from '@boostkit/ws'

// Inside a route
router.post('/orders/:id/ship', async (req) => {
  await shipOrder(req.params.id)
  broadcast(`orders.${req.params.id}`, 'order.shipped', { id: req.params.id })
  return { ok: true }
})
```

## Auth Callbacks

Private and presence channels require an auth callback. Register them with `ws.auth(pattern, callback)`:

```ts
import { ws } from '@boostkit/ws'

ws.auth('private-user.*', async (req, channel) => {
  // req.headers — HTTP headers from the WebSocket upgrade request
  // req.url     — upgrade request URL
  // req.token   — token from the client's subscribe message
  const user = await verifyToken(req.token)
  return !!user
})
```

The pattern supports `*` as a wildcard (matches non-dot characters). Use `private-user.*` to match `private-user.1`, `private-user.42`, etc.

For **presence channels**, return a member info object instead of `true`:

```ts
ws.auth('presence-room.*', async (req) => {
  const user = await verifyToken(req.token)
  if (!user) return false
  return { id: user.id, name: user.name, avatar: user.avatar }
})
```

## Client

Publish the BKSocket client to your project:

```bash
pnpm artisan vendor:publish --tag=ws-client
```

Then use it in your frontend pages:

```ts
import { BKSocket } from './vendor/BKSocket'

const socket = new BKSocket('ws://localhost:3000/ws')

// Public channel
const chat = socket.channel('chat')
chat.on('new-message', (data) => {
  console.log(data.text)
})

// Private channel
const orders = socket.private(`orders.${orderId}`, userToken)
orders.on('order.shipped', (data) => {
  showNotification(`Order ${data.id} has shipped!`)
})

// Send to other subscribers (client events)
chat.emit('typing', { user: 'Alice' })

// Presence channel
const room = socket.presence('room.lobby', userToken)
room.on('presence.members', ({ members }) => {
  console.log('Online:', members)
})
room.on('presence.joined', ({ user }) => {
  console.log(`${user.name} joined`)
})
room.on('presence.left', ({ user }) => {
  console.log(`${user.name} left`)
})

// Leave a channel
orders.leave()
```

BKSocket automatically reconnects after 3 seconds if the connection drops, and resubscribes to all active channels on reconnect.

## Stats

```ts
import { wsStats } from '@boostkit/ws'

const { connections, channels } = wsStats()
```

The built-in `ws:connections` artisan command shows live stats:

```bash
pnpm artisan ws:connections
```

## How It Works

WebSocket connections share the same TCP port as your HTTP application — no proxy or separate port needed.

Under the hood, the `ws` package intercepts Node.js HTTP `upgrade` events before they reach Hono:

- **Dev (Vite):** the `@boostkit/vite` plugin hooks `configureServer` to attach the handler to Vite's dev server
- **Production:** `@boostkit/server-hono`'s `listen()` attaches the handler to the underlying HTTP server after `serve()` starts

The WebSocket state (connections, subscriptions, presence) is stored on `globalThis` so it survives Vite HMR reloads during development.
