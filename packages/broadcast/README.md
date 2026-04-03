# @rudderjs/broadcast

Native WebSocket server for RudderJS — channel-based pub/sub with public, private, and presence channels. Runs on the same port as your HTTP server. No Pusher, no Echo, no external service required.

## Installation

```bash
pnpm add @rudderjs/broadcast
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { broadcasting } from '@rudderjs/broadcast'

export default [
  // ... other providers
  broadcasting(),
]
```

Add a channels file to `bootstrap/app.ts`:

```ts
export default Application.configure({ ... })
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    channels: () => import('../routes/channels.ts'),  // ← add this
  })
  .create()
```

Create `routes/channels.ts` to register auth callbacks:

```ts
import { Broadcast } from '@rudderjs/broadcast'

// Private channels — return true/false
Broadcast.channel('private-orders.*', async (req) => {
  const user = await getUserFromToken(req.token)
  return !!user
})

// Presence channels — return member info object or false
Broadcast.channel('presence-room.*', async (req) => {
  const user = await getUserFromToken(req.token)
  if (!user) return false
  return { id: user.id, name: user.name }
})
```

## Channels

RudderJS WebSockets are organized into three types:

| Type | Class | Prefix | Auth |
|---|---|---|---|
| Public | `Channel` | — | None |
| Private | `PrivateChannel` | `private-` | Required |
| Presence | `PresenceChannel` | `presence-` | Returns member info |

## Server API

### `broadcast(channel, event, data)`

Push an event to all subscribers of a channel from anywhere in your application:

```ts
import { broadcast } from '@rudderjs/broadcast'

// In a route handler, job, or event listener
broadcast('orders', 'order.shipped', { orderId: 123 })
broadcast('private-orders.42', 'status.updated', { status: 'delivered' })
```

### `Broadcast.channel(pattern, callback)`

Register an auth callback for private/presence channels. The pattern supports `*` as a wildcard (matches non-dot characters):

```ts
import { Broadcast } from '@rudderjs/broadcast'

Broadcast.channel('private-user.*', async (req, channel) => {
  // req.headers — HTTP headers from the upgrade request
  // req.token   — token sent in the subscribe message
  // req.url     — request URL
  return true  // or false to deny
})
```

### `broadcastStats()`

```ts
import { broadcastStats } from '@rudderjs/broadcast'

broadcastStats()  // → { connections: 5, channels: 3 }
```

## Client (BKSocket)

Publish the client asset:

```bash
pnpm rudder vendor:publish --tag=ws-client
```

Then use it in your frontend:

```ts
import { BKSocket } from './vendor/BKSocket'

const socket = new BKSocket('ws://localhost:3000/ws')

// Public channel
const chat = socket.channel('chat')
chat.on('message', (data) => console.log(data))

// Private channel (requires auth)
const orders = socket.private('orders.42', authToken)
orders.on('status.updated', (data) => console.log(data))

// Send events to other subscribers
chat.emit('typing', { user: 'Alice' })

// Presence channel — tracks who is connected
const room = socket.presence('room.lobby', authToken)
room.on('presence.joined', ({ user }) => console.log(`${user.name} joined`))
room.on('presence.left',   ({ user }) => console.log(`${user.name} left`))
```

## Protocol

All communication uses JSON over a single `/ws` path.

**Client → Server:**
| Type | Fields |
|---|---|
| `subscribe` | `channel`, `token?` |
| `unsubscribe` | `channel` |
| `client-event` | `channel`, `event`, `data` |
| `ping` | — |

**Server → Client:**
| Type | Meaning |
|---|---|
| `connected` | Sent on connect with `socketId` |
| `subscribed` | Channel join confirmed |
| `unsubscribed` | Channel leave confirmed |
| `event` | Event from broadcast or client-event |
| `presence.members` | Current member list (after joining presence channel) |
| `presence.joined` | A member joined |
| `presence.left` | A member left |
| `error` | Auth failure or protocol error |
| `pong` | Response to ping |

## How It Works

WebSocket connections share the same port as your HTTP server. The `ws` package intercepts HTTP `upgrade` events before they reach Hono:

- **Dev (Vite):** the `@rudderjs/vite` plugin hooks into Vite's dev server
- **Production:** `@rudderjs/server-hono`'s `listen()` attaches to the underlying Node.js HTTP server

This means no extra port, no proxy configuration.
