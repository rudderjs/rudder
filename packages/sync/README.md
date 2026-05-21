# @rudderjs/sync

Real-time collaborative document sync engine for RudderJS — [Yjs](https://yjs.dev) CRDT over WebSocket. Editor-agnostic core with adapters under subpath exports.

Works alongside `@rudderjs/broadcast` — the sync engine uses the same port and process, no separate server needed.

## Installation

```bash
pnpm add @rudderjs/sync
```

## Setup

`SyncProvider` is auto-discovered. Install the package, run `pnpm rudder providers:discover`, and configure via `config/sync.ts`:

```ts
// config/sync.ts
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: '/ws-sync',
} satisfies SyncConfig
```

```ts
// bootstrap/providers.ts
import { defaultProviders } from '@rudderjs/core'

export default [...(await defaultProviders())]
```

```ts
// bootstrap/app.ts (optional — only if you broadcast over channels too)
.withRouting({
  channels: () => import('../routes/channels.ts'),
})
```

Both `/ws` (broadcast) and `/ws-sync` (sync) share the same port — no proxy, no extra process. Register `BroadcastingProvider` before `SyncProvider` if you use both — `defaultProviders()` orders them correctly out of the box.

To opt out of auto-discovery, import `SyncProvider` from `@rudderjs/sync` and list it explicitly.

---

## Editor Adapters

Yjs is editor-agnostic; the core package handles document sync. For server-side mutations against editor-specific document shapes, use the relevant adapter under a subpath import:

| Adapter | Subpath | Status |
|---|---|---|
| Lexical | `@rudderjs/sync/lexical` | Available |
| Tiptap  | _planned_                | Coming in a future release |

```ts
import { Sync }                    from '@rudderjs/sync'
import { editBlock, insertBlock }  from '@rudderjs/sync/lexical'

const doc = Sync.document('panel:articles:42:richcontent:body')
insertBlock(doc, 'callToAction', { title: 'Subscribe' })
editBlock(doc, 'callToAction', 0, 'buttonText', 'Learn More')
```

---

## Persistence Drivers

All driver selection happens in `config/sync.ts` — the `SyncProvider` reads it on boot.

### Memory (default)

Zero config. Documents live in RAM and reset on server restart. Good for development and ephemeral sessions.

```ts
// config/sync.ts
export default {} satisfies SyncConfig
```

### Prisma

Documents persist in your database. Add a model to your Prisma schema:

```prisma
model SyncDocument {
  id        String   @id @default(cuid())
  docName   String
  update    Bytes
  createdAt DateTime @default(now())

  @@index([docName])
}
```

Then wire the adapter:

```ts
// config/sync.ts
import { syncPrisma } from '@rudderjs/sync'

export default {
  persistence: syncPrisma({ model: 'syncDocument' }),
} satisfies SyncConfig
```

### Redis

Documents cached in Redis. Supports multiple server instances behind a load balancer.

```bash
pnpm add ioredis
```

```ts
// config/sync.ts
import { syncRedis } from '@rudderjs/sync'

export default {
  persistence: syncRedis({ url: process.env.REDIS_URL }),
} satisfies SyncConfig
```

---

## Auth

Protect documents with an `onAuth` callback. Return `true` to allow, `false` to deny.

```ts
// config/sync.ts
export default {
  onAuth: async (req, docName) => {
    const token = req.token ?? req.headers['authorization']
    return verifyToken(token)
  },
} satisfies SyncConfig
```

The `req` object contains:
- `req.headers` — upgrade request headers (cookies, Authorization, etc.)
- `req.url` — full upgrade URL
- `req.token` — token passed by the client as a query parameter

---

## onChange

Called (with the raw Yjs update) whenever a document changes. Useful for indexing, webhooks, or audit logs.

```ts
// config/sync.ts
export default {
  onChange: async (docName, update) => {
    console.log(`Document "${docName}" updated`)
    await searchIndex.update(docName, update)
  },
} satisfies SyncConfig
```

---

## Custom Path

```ts
// config/sync.ts
export default { path: '/ws-collab' } satisfies SyncConfig
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
const provider = new WebsocketProvider('ws://localhost:3000/ws-sync', 'my-document', doc)

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

### React hooks

For React apps, `@rudderjs/sync/react` exports `useCollabRoom` + `useCollabSeed` so you don't have to hand-roll the Y.Doc + provider + IndexedDB lifecycle in every editor component:

```bash
pnpm add y-websocket y-indexeddb        # optional peers — install when using the hooks
```

```tsx
import { useCollabRoom, useCollabSeed } from '@rudderjs/sync/react'

function Editor({ id, defaultValue }) {
  const room   = useCollabRoom(`doc:${id}`, { offline: true })
  const seeded = useCollabSeed(room, 'content', (doc, fragment) => {
    const initial = new Y.XmlText()
    initial.insert(0, defaultValue)
    fragment.insert(0, [initial])
  })

  if (!room || !seeded) return <Placeholder />
  // …bind your editor to room.ydoc / room.provider…
}
```

- `useCollabRoom(roomKey, options)` — connects + returns the live room; `null` on SSR and while the WebSocket handshake is in flight. Re-keys cleanly when `roomKey` changes.
- `useCollabSeed(room, fragmentKey, seedFn)` — seeds an empty `Y.XmlFragment` on first sync; idempotent across peers. `seedFn` is captured via ref — no `useCallback` needed.

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
pnpm rudder sync:docs          # List active documents and client counts
pnpm rudder sync:clear <doc>   # Clear a document from persistence
pnpm rudder sync:inspect <doc> # Inspect the Y.Doc tree structure
```

---

## Document Names

The document name is extracted from the WebSocket URL path:

```
ws://localhost:3000/ws-sync/my-document  →  docName = "my-document"
ws://localhost:3000/ws-sync/report-2026  →  docName = "report-2026"
```

Multiple clients connecting to the same document name automatically share state.

---

## Persistence Drivers Comparison

| Driver | Persistence | Scales | Use case |
|---|---|---|---|
| `MemoryPersistence` (default) | Resets on restart | Single instance | Dev, demos, ephemeral |
| `syncPrisma()`                | Database          | Single instance | Most production apps |
| `syncRedis()`                 | Redis             | Multi-instance  | High-traffic, horizontal scale |

For very large scale (millions of users), run [yhub](https://github.com/yjs/yhub) as a separate service — it's y-websocket compatible so clients work without any changes.

---

## Custom Persistence Adapter

Implement the `SyncPersistence` interface to use any storage backend:

```ts
import type { SyncPersistence } from '@rudderjs/sync'
import * as Y from 'yjs'

class MyAdapter implements SyncPersistence {
  async getYDoc(docName: string): Promise<Y.Doc> { ... }
  async storeUpdate(docName: string, update: Uint8Array): Promise<void> { ... }
  async getStateVector(docName: string): Promise<Uint8Array> { ... }
  async getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array> { ... }
  async clearDocument(docName: string): Promise<void> { ... }
  async destroy(): Promise<void> { ... }
}

// config/sync.ts
export default { persistence: new MyAdapter() } satisfies SyncConfig
```

---

## How It Works

1. Client connects via WebSocket to `/ws-sync/document-name`
2. Server sends its state vector (what it knows)
3. Client replies with a diff (what the server is missing)
4. Client receives a diff back (what the client is missing)
5. Both sides are now in sync — subsequent updates broadcast to all connected clients
6. Updates are persisted via the configured adapter

This is the standard [Yjs sync protocol](https://docs.yjs.dev/api/y.doc#syncing-clients) — compatible with any y-websocket client.

---

## Migration from `@rudderjs/live`

This package was previously named `@rudderjs/live`. Renamed in `0.1.0` to better reflect its purpose (sync engine, not just "live updates"). Lexical-specific helpers moved to `@rudderjs/sync/lexical`.

| Before | After |
|---|---|
| `@rudderjs/live`          | `@rudderjs/sync` |
| `Live` facade             | `Sync` facade |
| `LiveProvider`            | `SyncProvider` |
| `LiveConfig`              | `SyncConfig` |
| `LivePersistence`         | `SyncPersistence` |
| `livePrisma`, `liveRedis` | `syncPrisma`, `syncRedis` |
| `LIVE_UPGRADE_KEY`        | `SYNC_UPGRADE_KEY` |
| `/ws-live`                | `/ws-sync` |
| `config/live.ts`          | `config/sync.ts` |
| `'liveDocument'` (Prisma model default) | `'syncDocument'` |
| `'rudderjs:live:'` (Redis prefix)       | `'rudderjs:sync:'` |
| `pnpm rudder live:docs`   | `pnpm rudder sync:docs` |
| `Live.editBlock`, `Live.insertBlock`, etc. | Imported from `@rudderjs/sync/lexical` |
