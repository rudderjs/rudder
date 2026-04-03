# @rudderjs/live

Real-time collaborative document sync via [Yjs](https://yjs.dev) CRDT. Works alongside `@rudderjs/broadcast` — live uses the same port and process, no separate server needed.

## Installation

```bash
pnpm add @rudderjs/live
```

## Setup

```ts
// bootstrap/providers.ts
import { broadcasting } from '@rudderjs/broadcast'
import { live }         from '@rudderjs/live'

export default [
  broadcasting(),  // /ws  — pub/sub channels
  live(),          // /ws-live — Yjs CRDT sync
]
```

```ts
// bootstrap/app.ts
.withRouting({
  channels: () => import('../routes/channels.ts'),
})
```

That's it. Both `ws` and `live` share the same port — no proxy, no extra process.

---

## Persistence Drivers

### Memory (default)

Zero config. Documents live in RAM and reset on server restart. Good for development and ephemeral sessions.

```ts
live()
```

### Prisma

Documents persist in your database. Add a model to your Prisma schema:

```prisma
model LiveDocument {
  id        String   @id @default(cuid())
  docName   String
  update    Bytes
  createdAt DateTime @default(now())

  @@index([docName])
}
```

Then pass the adapter:

```ts
import { live, livePrisma } from '@rudderjs/live'

live({
  persistence: livePrisma({ model: 'liveDocument' }),
})
```

### Redis

Documents cached in Redis. Supports multiple server instances behind a load balancer.

```bash
pnpm add ioredis
```

```ts
import { live, liveRedis } from '@rudderjs/live'

live({
  persistence: liveRedis({ url: env('REDIS_URL') }),
})
```

---

## Auth

Protect documents with an `onAuth` callback. Return `true` to allow, `false` to deny.

```ts
live({
  onAuth: async (req, docName) => {
    const token = req.token ?? req.headers['authorization']
    return verifyToken(token)
  },
})
```

The `req` object contains:
- `req.headers` — upgrade request headers (cookies, Authorization, etc.)
- `req.url` — full upgrade URL
- `req.token` — token passed by the client as a query parameter

---

## onChange

Called (with the raw Yjs update) whenever a document changes. Useful for indexing, webhooks, or audit logs.

```ts
live({
  onChange: async (docName, update) => {
    console.log(`Document "${docName}" updated`)
    await searchIndex.update(docName, update)
  },
})
```

---

## Custom Path

```ts
live({ path: '/ws-collab' })
```

---

## Client

The client uses standard Yjs — no custom library needed. Install `yjs` and `y-websocket`:

```bash
pnpm add yjs y-websocket
```

```ts
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc      = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:3000/ws-live', 'my-document', doc)

provider.on('status', ({ status }) => {
  console.log(status) // 'connecting' | 'connected' | 'disconnected'
})
```

### Offline support (browser)

Pair with `y-indexeddb` for offline-first editing — documents load from IndexedDB instantly and sync when the connection is restored:

```bash
pnpm add y-indexeddb
```

```ts
import { IndexeddbPersistence } from 'y-indexeddb'

const local = new IndexeddbPersistence('my-document', doc)
local.on('synced', () => console.log('Loaded from local storage'))
```

### Awareness (presence & cursors)

Track who is online and share cursor positions:

```ts
provider.awareness.setLocalStateField('user', {
  name:  'Alice',
  color: '#f5a623',
})

provider.awareness.on('change', () => {
  const users = [...provider.awareness.getStates().values()]
  renderCursors(users)
})
```

### React + Valtio

For a nicer state management experience in React, pair with `valtio-yjs`:

```bash
pnpm add valtio valtio-yjs
```

```ts
import { proxy, useSnapshot } from 'valtio'
import { bind }               from 'valtio-yjs'

const ymap = doc.getMap('state')
const state = proxy({ title: '', content: '' })
bind(state, ymap)

function Editor() {
  const snap = useSnapshot(state)
  return (
    <input
      value={snap.title}
      onChange={e => { state.title = e.target.value }}
    />
  )
}
```

---

## Rudder Commands

```bash
pnpm rudder live:docs          # List active documents and client counts
pnpm rudder live:clear <doc>   # Clear a document from persistence
```

---

## Document Names

The document name is extracted from the WebSocket URL path:

```
ws://localhost:3000/ws-live/my-document  →  docName = "my-document"
ws://localhost:3000/ws-live/report-2026  →  docName = "report-2026"
```

Multiple clients connecting to the same document name automatically share state.

---

## Persistence Drivers Comparison

| Driver | Persistence | Scales | Use case |
|---|---|---|---|
| Memory (default) | ❌ Resets on restart | Single instance | Dev, demos, ephemeral |
| `livePrisma()` | ✅ Database | Single instance | Most production apps |
| `liveRedis()` | ✅ Redis | Multi-instance | High-traffic, horizontal scale |

For very large scale (millions of users), run [yhub](https://github.com/yjs/yhub) as a separate service — it's y-websocket compatible so clients work without any changes.

---

## Custom Persistence Adapter

Implement the `LivePersistence` interface to use any storage backend:

```ts
import type { LivePersistence } from '@rudderjs/live'
import * as Y from 'yjs'

class MyAdapter implements LivePersistence {
  async getYDoc(docName: string): Promise<Y.Doc> { ... }
  async storeUpdate(docName: string, update: Uint8Array): Promise<void> { ... }
  async getStateVector(docName: string): Promise<Uint8Array> { ... }
  async getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array> { ... }
  async clearDocument(docName: string): Promise<void> { ... }
  async destroy(): Promise<void> { ... }
}

live({ persistence: new MyAdapter() })
```

---

## How It Works

1. Client connects via WebSocket to `/ws-live/document-name`
2. Server sends its state vector (what it knows)
3. Client replies with a diff (what the server is missing)
4. Client receives a diff back (what the client is missing)
5. Both sides are now in sync — subsequent updates broadcast to all connected clients
6. Updates are persisted via the configured adapter

This is the standard [Yjs sync protocol](https://docs.yjs.dev/api/y.doc#syncing-clients) — compatible with any y-websocket client.
