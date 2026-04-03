# @rudderjs/broadcast

Channel-based WebSocket broadcasting with public, private, and presence channels. Runs on the same port as your HTTP server — no Pusher, no external service.

## Installation

```bash
pnpm add @rudderjs/broadcast
```

## Setup

```ts
// bootstrap/providers.ts
import { broadcasting } from '@rudderjs/broadcast'

export default [broadcasting()]
```

```ts
// bootstrap/app.ts
.withRouting({
  channels: () => import('../routes/channels.ts'),
})
```

```ts
// routes/channels.ts
import { Broadcast } from '@rudderjs/broadcast'

Broadcast.channel('private-orders.*', async (req) => {
  return await verifyToken(req.token)
})

Broadcast.channel('presence-room.*', async (req) => {
  const user = await getUser(req.token)
  return user ? { id: user.id, name: user.name } : false
})
```

## API

### `broadcasting(config?)`

ServiceProvider factory — registers the WebSocket server and upgrade handler.

```ts
broadcasting()                    // default path: /ws
broadcasting({ path: '/socket' }) // custom path
```

### `Broadcast.channel(pattern, callback)`

Register an auth callback for private or presence channels. Pattern `*` matches non-dot characters:

```ts
import { Broadcast } from '@rudderjs/broadcast'

// Private channel — return true/false
Broadcast.channel('private-user.*', async (req, channel) => {
  // req.headers — upgrade request headers
  // req.token   — token from subscribe message
  // req.url     — upgrade request URL
  return verifyToken(req.token)
})

// Presence channel — return member info object
Broadcast.channel('presence-room.*', async (req) => {
  const user = await getUser(req.token)
  return user ? { id: user.id, name: user.name } : false
})
```

### `broadcast(channel, event, data)`

Push an event to all subscribers of a channel from anywhere on the server:

```ts
import { broadcast } from '@rudderjs/broadcast'

broadcast('news', 'article.published', { id: 42, title: 'Hello' })
broadcast('private-orders.1', 'status.updated', { status: 'shipped' })
```

### `broadcastStats()`

```ts
import { broadcastStats } from '@rudderjs/broadcast'
broadcastStats()  // { connections: number, channels: number }
```

### Channel Classes

```ts
import { Channel, PrivateChannel, PresenceChannel } from '@rudderjs/broadcast'

new Channel('chat').name          // 'chat'
new PrivateChannel('orders').name // 'private-orders'
new PresenceChannel('room').name  // 'presence-room'
```

## Rudder Commands

| Command | Description |
|---|---|
| `broadcast:connections` | Show active connections and channel count |

## Channel Types

| Type | Prefix | Auth | Use case |
|---|---|---|---|
| Public | — | None | Chat, notifications, feeds |
| Private | `private-` | `true/false` | User-specific events |
| Presence | `presence-` | Member info object | Collaborative rooms, online indicators |

## Client

```bash
pnpm rudder vendor:publish --tag=broadcast-client
```

```ts
import { BKSocket } from './vendor/BKSocket'

const socket = new BKSocket('ws://localhost:3000/ws')

const chat    = socket.channel('chat')
const orders  = socket.private('orders.42', token)
const room    = socket.presence('room.lobby', token)

chat.on('message', handler)
chat.emit('typing', { user: 'Alice' })
room.on('presence.joined', ({ user }) => {})
orders.leave()
```

See the [WebSockets guide](/guide/websockets) for full documentation.
