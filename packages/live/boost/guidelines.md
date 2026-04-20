# @rudderjs/live

## Overview

Real-time collaborative document sync via [Yjs](https://yjs.dev) CRDT. Every connected client always sees the same shared state with conflict-free merging — even after going offline and reconnecting. Works alongside `@rudderjs/broadcast` on the same port. Server-side only — clients use standard Yjs packages (`yjs`, `y-websocket`) directly.

## Key Patterns

### Setup

```ts
// bootstrap/providers.ts
import { broadcasting } from '@rudderjs/broadcast'
import { live }         from '@rudderjs/live'

export default [
  broadcasting(),   // /ws       pub/sub channels
  live(),           // /ws-live  Yjs CRDT sync (register AFTER broadcasting)
]
```

### Persistence drivers

```ts
// Memory (default) — resets on restart, good for dev
live()

// Redis — updates append-only per document, fast writes, full history
import { live, liveRedis } from '@rudderjs/live'
live({ persistence: liveRedis({ url: process.env.REDIS_URL }) })

// Prisma — durable, queryable from SQL
import { live, livePrisma } from '@rudderjs/live'
live({ persistence: livePrisma({ model: 'liveDocument' }) })
```

For Prisma, add the `LiveDocument` model to your schema:

```prisma
model LiveDocument {
  id        String   @id @default(cuid())
  docName   String
  update    Bytes
  createdAt DateTime @default(now())
}
```

### Config

```ts
live({
  path:       '/ws-live',        // default
  persistence: liveRedis({ ... }),
  onAuth: async (req, docName) => {
    return verifyToken(req.headers['authorization']?.split(' ')[1])
  },
  onChange: async (docName, update) => {
    console.log(`"${docName}" updated (${update.length} bytes)`)
  },
})
```

### Client usage

```ts
// Client side — plain Yjs + y-websocket
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc = new Y.Doc()
const provider = new WebsocketProvider(
  `ws://${window.location.host}/ws-live`,
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

### Live facade (server-side ydoc access)

```ts
import { Live } from '@rudderjs/live'

await Live.seed('panel:articles:abc123', { title: 'Hello', excerpt: 'World' })
const snapshot = Live.snapshot('panel:articles:abc123')
const fields = Live.readMap('panel:articles:abc123', 'fields')
```

Used by `@pilotiq/panels` for versioning. Resolves persistence via DI (`'live.persistence'` binding) or the `__rudderjs_live_persistence__` globalThis fallback.

### Observability

If `@rudderjs/telescope` is installed, document opens/closes, updates applied, awareness changes (throttled by `liveAwarenessSampleMs` — default 500ms), persistence writes, and sync errors record under the **Live** tab. No config needed.

## Common Pitfalls

- **`live()` before `broadcasting()`.** `live` shares the WS upgrade handler with broadcast. Registration order: `broadcasting()` → `live()`.
- **Awareness without throttling.** Mouse movement triggers awareness updates at ~60fps. Without throttling, the telescope entry count explodes on high-traffic rooms. `liveAwarenessSampleMs` in telescope config throttles collection side; y-awareness itself doesn't throttle client-side.
- **Forgetting `ioredis` for Redis persistence.** Optional peer — install: `pnpm add ioredis`.
- **Custom persistence adapter — implement all 6 methods.** `getYDoc`, `storeUpdate`, `getStateVector`, `getDiff`, `clearDocument`, `destroy`. Missing any throws at first use.
- **`Live.seed()` on already-seeded docs.** Idempotent — only sets fields not already in the map. Won't overwrite existing data. For full replacement, use `Live.clearDocument()` first.
- **Client using standard y-websocket over plain WS.** Works in dev. In production behind a reverse proxy, ensure the proxy supports WS upgrades (nginx `proxy_set_header Upgrade $http_upgrade` + `Connection "upgrade"`).

## Key Imports

```ts
import { live, liveRedis, livePrisma, Live } from '@rudderjs/live'

import type { LiveConfig, LivePersistence } from '@rudderjs/live'
```
