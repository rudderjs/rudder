# @rudderjs/live

Yjs CRDT real-time document sync. Every connected client always sees the same shared state with conflict-free merging — even after going offline and reconnecting.

## Installation

```bash
pnpm add @rudderjs/live
# Client-side (in your app, not this package)
pnpm add yjs y-websocket
```

## Setup

```ts
// bootstrap/providers.ts
import { broadcasting } from '@rudderjs/broadcast'
import { live }         from '@rudderjs/live'

export default [
  broadcasting(),  // /ws       — pub/sub channels
  live(),          // /ws-live  — Yjs CRDT sync (register after broadcasting)
]
```

## Persistence

### Memory (default)

Documents are kept in memory. Resets on server restart. Good for development.

```ts
live()  // MemoryPersistence used automatically
```

### Redis

Requires `ioredis` (optional peer dependency):

```bash
pnpm add ioredis
```

```ts
import { live, liveRedis } from '@rudderjs/live'

live({
  persistence: liveRedis({ url: process.env.REDIS_URL }),
})
```

Updates are stored as an append-only list per document — efficient writes, full history.

### Prisma

Requires a `LiveDocument` model in your schema:

```prisma
model LiveDocument {
  id        String   @id @default(cuid())
  docName   String
  update    Bytes
  createdAt DateTime @default(now())
}
```

```ts
import { live, livePrisma } from '@rudderjs/live'

live({
  persistence: livePrisma({ model: 'liveDocument' }),
})
```

### Custom Adapter

Implement the `LivePersistence` interface to use any storage backend:

```ts
import type { LivePersistence } from '@rudderjs/live'
import * as Y from 'yjs'

const myAdapter: LivePersistence = {
  async getYDoc(docName)              { /* load and return Y.Doc */ },
  async storeUpdate(docName, update)  { /* persist update bytes */ },
  async getStateVector(docName)       { /* return state vector */ },
  async getDiff(docName, stateVector) { /* return update diff */ },
  async clearDocument(docName)        { /* delete all data */ },
  async destroy()                     { /* cleanup connections */ },
}

live({ persistence: myAdapter })
```

## Config

```ts
live({
  /** WebSocket path. Default: '/ws-live' */
  path: '/ws-live',

  /** Persistence adapter. Default: MemoryPersistence */
  persistence: liveRedis({ url: process.env.REDIS_URL }),

  /** Auth callback — return true to allow, false to deny */
  onAuth: async (req, docName) => {
    const token = req.headers['authorization']?.split(' ')[1]
    return await verifyToken(token)
  },

  /** Called on every document update */
  onChange: async (docName, update) => {
    console.log(`"${docName}" updated`)
  },
})
```

## Client Usage

`@rudderjs/live` is **server-side only**. On the client, use standard Yjs packages directly:

```ts
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc      = new Y.Doc()
const provider = new WebsocketProvider(
  `ws://${window.location.host}/ws-live`,
  'my-document',  // document name / room
  doc,
)

// Shared text
const text = doc.getText('content')
text.observe(() => {
  console.log('Content:', text.toString())
})

// Edit — all connected clients see the change instantly
doc.transact(() => {
  text.delete(0, text.length)
  text.insert(0, newValue)
})
```

### Awareness (presence, cursors)

```ts
// Set your local state (visible to all other clients)
provider.awareness.setLocalStateField('user', {
  name:   'Alice',
  color:  '#f97316',
  cursor: { index: 42 },
})

// React to others joining, leaving, or moving cursors
provider.awareness.on('change', () => {
  const states = [...provider.awareness.getStates().values()]
  const online = states.flatMap(s => s.user ? [s.user] : [])
  console.log('Online:', online.map(u => u.name))
})
```

### Offline Support

Add `y-indexeddb` for local persistence in the browser:

```bash
pnpm add y-indexeddb
```

```ts
import { IndexeddbPersistence } from 'y-indexeddb'

const local = new IndexeddbPersistence('my-document', doc)
local.on('synced', () => console.log('Local content loaded'))
```

Edits made offline are merged back automatically when the connection restores.

## Live Facade

The `Live` facade provides server-side access to ydoc operations without needing to import Yjs directly. Used by `@pilotiq/panels` for versioning.

```ts
import { Live } from '@rudderjs/live'

// Seed a ydoc with initial field data (idempotent — only sets fields not already in the map)
await Live.seed('panel:articles:abc123', { title: 'Hello', excerpt: 'World' })

// Snapshot the current ydoc state as a Uint8Array
const snapshot = Live.snapshot('panel:articles:abc123')

// Read all key-value pairs from a named Y.Map
const fields = Live.readMap('panel:articles:abc123', 'fields')
// => { title: 'Hello', excerpt: 'World' }

// Get the configured persistence adapter
const persistence = Live.persistence()
```

The facade resolves the persistence adapter from:
1. DI container (`'live.persistence'` binding) — set by `live()` provider
2. Global key (`__rudderjs_live_persistence__`) — fallback

## Rudder Commands

| Command | Description |
|---|---|
| `live:docs` | List active documents and connected client count |
| `live:clear <doc>` | Clear a document from memory and persistence |

## How It Works

`@rudderjs/live` implements the [y-websocket](https://github.com/yjs/y-websocket) binary sync protocol directly:

1. Client connects → server sends **SyncStep1** (server state vector)
2. Client replies with **SyncStep2** (diff of what it has that the server doesn't)
3. Client sends its own **SyncStep1** → server replies with diff
4. Both sides are now in sync
5. Subsequent edits flow as **Update** messages, broadcast to all room clients
6. **Awareness** messages are broadcast as-is (no persistence)

The server maintains one in-memory `Y.Doc` per document name (room). Updates are also written to the configured persistence adapter so new clients receive the full document state on connect.
