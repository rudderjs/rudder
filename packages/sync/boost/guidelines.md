# @rudderjs/sync

## Overview

Real-time collaborative document sync engine via [Yjs](https://yjs.dev) CRDT. Every connected client always sees the same shared state with conflict-free merging — even after going offline and reconnecting. Works alongside `@rudderjs/broadcast` on the same port. Server-side only — clients use standard Yjs packages (`yjs`, `y-websocket`) directly.

Editor-specific helpers (block/text mutations) live under subpath exports: `@rudderjs/sync/lexical` is available; a Tiptap adapter is planned for a future release.

## Key Patterns

### Setup

`SyncProvider` is auto-discovered via `defaultProviders()`. Configure via `config/sync.ts`:

```ts
// config/sync.ts
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: '/ws-sync',  // default
} satisfies SyncConfig
```

```ts
// bootstrap/providers.ts
import { defaultProviders } from '@rudderjs/core'

export default [...(await defaultProviders())]
```

`/ws` (broadcast) and `/ws-sync` (sync) share the same port. `defaultProviders()` orders `BroadcastingProvider` before `SyncProvider` automatically; if you list providers manually, keep that order.

### Persistence drivers

```ts
// config/sync.ts
import { syncRedis, syncPrisma } from '@rudderjs/sync'
import type { SyncConfig } from '@rudderjs/sync'

// Memory (default) — resets on restart, good for dev
export default {} satisfies SyncConfig

// Redis — updates append-only per document, fast writes, full history
export default { persistence: syncRedis({ url: process.env.REDIS_URL }) } satisfies SyncConfig

// Prisma — durable, queryable from SQL
export default { persistence: syncPrisma({ model: 'syncDocument' }) } satisfies SyncConfig
```

For Prisma, add the `SyncDocument` model to your schema:

```prisma
model SyncDocument {
  id        String   @id @default(cuid())
  docName   String
  update    Bytes
  createdAt DateTime @default(now())
}
```

### Auth + onChange

```ts
// config/sync.ts
export default {
  path:        '/ws-sync',
  persistence: syncRedis({ ... }),
  onAuth: async (req, docName) => {
    return verifyToken(req.headers['authorization']?.split(' ')[1])
  },
  onChange: async (docName, update) => {
    console.log(`"${docName}" updated (${update.length} bytes)`)
  },
} satisfies SyncConfig
```

### Client usage

```ts
// Client side — plain Yjs + y-websocket
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc = new Y.Doc()
const provider = new WebsocketProvider(
  `ws://${window.location.host}/ws-sync`,
  'room-name',
  doc,
)

const text = doc.getText('content')
text.observe(() => console.log(text.toString()))
doc.transact(() => text.insert(0, 'Hello'))
```

### Awareness (presence, cursors)

```ts
provider.awareness.setLocalStateField('user', {
  name:  'Alice',
  color: '#f97316',
  cursor: { index: 42 },
})

provider.awareness.on('change', () => {
  const online = [...provider.awareness.getStates().values()]
    .flatMap(s => s.user ? [s.user] : [])
})
```

### Offline support

```bash
pnpm add y-indexeddb
```

```ts
import { IndexeddbPersistence } from 'y-indexeddb'
const local = new IndexeddbPersistence('room-name', doc)
```

Edits made offline merge back automatically when the connection restores — CRDTs handle reconciliation.

### Sync facade (server-side ydoc access)

```ts
import { Sync } from '@rudderjs/sync'

await Sync.seed('panel:articles:abc123', { title: 'Hello', excerpt: 'World' })
const snapshot = Sync.snapshot('panel:articles:abc123')
const fields = Sync.readMap('panel:articles:abc123', 'fields')
```

Useful for server-driven document edits, versioning, and migrations. Resolves persistence via DI (`'sync.persistence'` binding) or the `__rudderjs_sync_persistence__` globalThis fallback.

### Editor adapters

For server-side mutations against editor-specific document shapes, import from the relevant adapter subpath:

```ts
import { Sync }                              from '@rudderjs/sync'
import { editBlock, insertBlock, editText }  from '@rudderjs/sync/lexical'

const doc = Sync.document('panel:articles:abc123:richcontent:body')
insertBlock(doc, 'callToAction', { title: 'Subscribe' })
editText(doc, { from: 0, to: 5, insert: 'Hi' })
```

A Tiptap adapter is planned for a future release.

### Observability

If `@rudderjs/telescope` is installed, document opens/closes, updates applied, awareness changes (throttled by `liveAwarenessSampleMs` — default 500ms), persistence writes, and sync errors record under the **Sync** tab. No config needed.

## Common Pitfalls

- **Provider order — broadcast before sync.** Sync shares the WS upgrade handler with broadcast. `defaultProviders()` orders this correctly; if you list providers manually, register `BroadcastingProvider` before `SyncProvider`.
- **Awareness without throttling.** Mouse movement triggers awareness updates at ~60fps. Without throttling, the telescope entry count explodes on high-traffic rooms. `liveAwarenessSampleMs` in telescope config throttles collection side; y-awareness itself doesn't throttle client-side.
- **Forgetting `ioredis` for Redis persistence.** Optional peer — install: `pnpm add ioredis`.
- **Custom persistence adapter — implement all 6 methods.** `getYDoc`, `storeUpdate`, `getStateVector`, `getDiff`, `clearDocument`, `destroy`. Missing any throws at first use.
- **`Sync.seed()` on already-seeded docs.** Idempotent — only sets fields not already in the map. Won't overwrite existing data. For full replacement, use `Sync.clearDocument()` first.
- **`Sync.document()` is synchronous.** Returns a `Y.Doc` directly — no `await`. The doc is a live in-memory handle, not an async resolver.
- **Client using standard y-websocket over plain WS.** Works in dev. In production behind a reverse proxy, ensure the proxy supports WS upgrades (nginx `proxy_set_header Upgrade $http_upgrade` + `Connection "upgrade"`).
- **Editor block ops on the core facade.** `Sync.editBlock`/`insertBlock`/`removeBlock` (formerly on the `Live` facade) moved to `@rudderjs/sync/lexical` as standalone functions taking a `Y.Doc`. Use `Sync.document(name)` to get the handle.

## Key Imports

```ts
import { Sync, SyncProvider, syncRedis, syncPrisma, MemoryPersistence } from '@rudderjs/sync'

import type { SyncConfig, SyncPersistence, YDoc } from '@rudderjs/sync'

// Editor-specific helpers (Lexical)
import { editBlock, insertBlock, removeBlock, editText } from '@rudderjs/sync/lexical'
```
