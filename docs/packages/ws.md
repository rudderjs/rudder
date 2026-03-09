# @boostkit/ws

Native WebSocket server with channel-based pub/sub. Public, private, and presence channels on the same port as your HTTP server.

## Installation

```bash
pnpm add @boostkit/ws
```

## Setup

```ts
// bootstrap/providers.ts
import { ws } from '@boostkit/ws'

export default [ws()]
```

```ts
// bootstrap/app.ts
.withRouting({
  channels: () => import('../routes/channels.ts'),
})
```

```ts
// routes/channels.ts
import { ws } from '@boostkit/ws'

ws.auth('private-orders.*', async (req) => {
  return await verifyToken(req.token)
})

ws.auth('presence-room.*', async (req) => {
  const user = await getUser(req.token)
  return user ? { id: user.id, name: user.name } : false
})
```

## API

### `broadcast(channel, event, data)`

Send an event to all subscribers of a channel:

```ts
import { broadcast } from '@boostkit/ws'

broadcast('news', 'article.published', { id: 42, title: 'Hello' })
broadcast('private-orders.1', 'status.updated', { status: 'shipped' })
```

### `ws.auth(pattern, callback)`

Register an auth callback. Pattern `*` matches non-dot characters:

```ts
ws.auth('private-*', async (req, channel) => {
  // req.headers — upgrade request headers
  // req.token   — token from subscribe message
  // req.url     — upgrade request URL
  return true | false
})
```

### `wsStats()`

```ts
import { wsStats } from '@boostkit/ws'
wsStats()  // { connections: number, channels: number }
```

### Channel Classes

```ts
import { Channel, PrivateChannel, PresenceChannel } from '@boostkit/ws'

new Channel('chat').name          // 'chat'
new PrivateChannel('orders').name // 'private-orders'
new PresenceChannel('room').name  // 'presence-room'
```

## Artisan Commands

| Command | Description |
|---|---|
| `ws:connections` | Show active connections and channel count |

## Channel Types

| Type | Prefix | Auth | Use case |
|---|---|---|---|
| Public | — | None | Chat, notifications, feeds |
| Private | `private-` | `true/false` | User-specific events |
| Presence | `presence-` | Member info object | Collaborative rooms, online indicators |

## Client

```bash
pnpm artisan vendor:publish --tag=ws-client
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
