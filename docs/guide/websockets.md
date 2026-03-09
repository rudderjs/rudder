# Real-time

BoostKit ships two real-time packages that share the same port and process as your HTTP server:

| Package | Purpose |
|---|---|
| `@boostkit/broadcast` | Channel-based pub/sub — events, notifications, presence |
| `@boostkit/live` | Yjs CRDT — collaborative editing, shared document state |

---

## Broadcasting (`@boostkit/broadcast`)

Channel-based WebSocket pub/sub with public, private, and presence channels. No Pusher, no Echo, no external service.

### Installation

```bash
pnpm add @boostkit/broadcast
```

### Setup

**1. Register the provider:**

```ts
// bootstrap/providers.ts
import { broadcasting } from '@boostkit/broadcast'

export default [
  // ... other providers
  broadcasting(),
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
import { Broadcast } from '@boostkit/broadcast'

Broadcast.channel('private-orders.*', async (req) => {
  const user = await getUserFromToken(req.token)
  return !!user
})

Broadcast.channel('presence-room.*', async (req) => {
  const user = await getUserFromToken(req.token)
  if (!user) return false
  return { id: user.id, name: user.name }
})
```

### Channel Types

| Type | Prefix | Auth |
|---|---|---|
| Public | — | None — anyone can subscribe |
| Private | `private-` | Auth callback must return `true` |
| Presence | `presence-` | Auth callback returns member info object |

### Broadcasting Events

Push events from anywhere on the server — route handlers, jobs, service classes:

```ts
import { broadcast } from '@boostkit/broadcast'

// Inside a route
Route.post('/orders/:id/ship', async (req) => {
  await shipOrder(req.params.id)
  broadcast(`orders.${req.params.id}`, 'order.shipped', { id: req.params.id })
  return { ok: true }
})
```

### Auth Callbacks

Private and presence channels require an auth callback registered with `Broadcast.channel()`:

```ts
import { Broadcast } from '@boostkit/broadcast'

// Private — return true/false
Broadcast.channel('private-user.*', async (req, channel) => {
  // req.headers — HTTP headers from the WebSocket upgrade request
  // req.url     — upgrade request URL
  // req.token   — token from the client's subscribe message
  const user = await verifyToken(req.token)
  return !!user
})

// Presence — return a member info object
Broadcast.channel('presence-room.*', async (req) => {
  const user = await verifyToken(req.token)
  if (!user) return false
  return { id: user.id, name: user.name, avatar: user.avatar }
})
```

The pattern supports `*` as a wildcard (matches non-dot characters). Use `private-user.*` to match `private-user.1`, `private-user.42`, etc.

### Client (BKSocket)

Publish the client to your project:

```bash
pnpm artisan vendor:publish --tag=broadcast-client
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

### Stats

```ts
import { broadcastStats } from '@boostkit/broadcast'

const { connections, channels } = broadcastStats()
```

```bash
pnpm artisan broadcast:connections
```

---

## Live Collaboration (`@boostkit/live`)

Yjs CRDT document sync — every client always sees the same shared state, with conflict-free merging even when offline.

### Installation

```bash
pnpm add @boostkit/live
# Client side
pnpm add yjs y-websocket
```

### Setup

```ts
// bootstrap/providers.ts
import { broadcasting } from '@boostkit/broadcast'
import { live }         from '@boostkit/live'

export default [
  broadcasting(),  // /ws       — pub/sub channels
  live(),          // /ws-live  — Yjs CRDT sync
]
```

### Persistence

By default documents are kept in memory (resets on restart). For production, use a persistence adapter:

```ts
import { live, liveRedis, livePrisma } from '@boostkit/live'

// Redis — append-only log per document
live({ persistence: liveRedis({ url: process.env.REDIS_URL }) })

// Prisma — store updates in a database table
live({ persistence: livePrisma() })
```

### Auth

```ts
live({
  onAuth: async (req, docName) => {
    const token = req.headers['authorization']?.split(' ')[1]
    return await verifyToken(token)
  },
})
```

### onChange

Called whenever a document is updated — useful for indexing or webhooks:

```ts
live({
  onChange: async (docName, update) => {
    console.log(`Document "${docName}" updated`)
  },
})
```

### Client

`@boostkit/live` is server-side only. On the client use standard Yjs packages:

```ts
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc      = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:3000/ws-live', 'my-doc', doc)

// Collaborative text
const text = doc.getText('content')
text.observe(() => console.log(text.toString()))

// Awareness — who is online, cursor positions
provider.awareness.setLocalStateField('user', { name: 'Alice', color: '#f00' })
provider.awareness.on('change', () => {
  const states = [...provider.awareness.getStates().values()]
  console.log('Online:', states.map(s => s.user?.name))
})
```

### Artisan Commands

| Command | Description |
|---|---|
| `live:docs` | List active documents and connected client count |
| `live:clear <doc>` | Clear a document from persistence |

---

## How It Works

Both packages hook into Node.js HTTP `upgrade` events on your existing server — no separate port or process needed.

- **Dev (Vite):** `@boostkit/vite` monkey-patches `http.createServer` to intercept srvx's server and attach the upgrade handler
- **Production:** `@boostkit/server-hono`'s `listen()` attaches the handler to the HTTP server after `serve()` starts

The chain: HTTP server → `@boostkit/broadcast` handles `/ws` → `@boostkit/live` handles `/ws-live` → Vite HMR handles the rest.
