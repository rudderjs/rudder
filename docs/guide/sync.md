# Sync

`@rudderjs/sync` is the framework's collaborative document layer. It uses [Yjs](https://yjs.dev) — a CRDT — so every client always sees the same shared state, with conflict-free merging even when participants edit offline. The transport is WebSocket on the same port as your HTTP server; the storage is pluggable (memory, your database via the ORM adapter, Redis, or Prisma).

## Setup

```bash
pnpm add @rudderjs/sync
# Client side
pnpm add yjs y-websocket
```

```ts
// bootstrap/providers.ts
import { BroadcastingProvider } from '@rudderjs/broadcast'
import { SyncProvider }         from '@rudderjs/sync'

export default [
  ...(await defaultProviders()),
  BroadcastingProvider,  // /ws       — channel pub/sub (optional, common pairing)
  SyncProvider,           // /ws-sync  — Yjs document sync
]
```

The provider mounts the WebSocket handler at `/ws-sync`. It reuses the HTTP port — no separate process.

## What you get

A `Y.Doc` synchronizes between every connected client and the server. Clients edit locally; updates propagate to all peers within a few hundred milliseconds. When a client disconnects and reconnects, missed updates merge in automatically without conflicts.

The most common building blocks are:

- **`Y.Text`** — collaborative string with character-level CRDT
- **`Y.Array`** — ordered collection of items
- **`Y.Map`** — key/value object
- **`Y.XmlFragment`** — rich-text tree for editor integration
- **Awareness** — ephemeral presence state (cursor positions, who's online), not persisted

These are the same Yjs primitives you'd use without Rudder — the framework handles transport, persistence, and auth.

## Persistence

By default documents live in memory and reset when the server restarts. For production, attach a persistence adapter via `config/sync.ts`:

```ts
// config/sync.ts
import { syncDatabase, syncRedis, syncPrisma } from '@rudderjs/sync'
import type { SyncConfig } from '@rudderjs/sync'

// Database — store updates through the app's ORM adapter (native engine,
// Prisma, or Drizzle). Shares the existing connection — no second pool.
export default {
  persistence: syncDatabase(),
} satisfies SyncConfig

// Or Redis — append-only update log per document
export default {
  persistence: syncRedis({ url: process.env.REDIS_URL }),
} satisfies SyncConfig

// Or Prisma — write through a PrismaClient directly
export default {
  persistence: syncPrisma(),
} satisfies SyncConfig
```

### The `syncDocument` table

Both database-backed adapters store updates in a `syncDocument` table (one binary row per update). Publish the schema for your setup with:

```bash
pnpm rudder vendor:publish --tag=sync-schema
```

On a **native-engine** app this drops a migration into `database/migrations/`; on a **Prisma** app it drops the `SyncDocument` model into `prisma/schema/`. The names are load-bearing — the Prisma model **must** be `SyncDocument` (delegate `syncDocument`, the `syncPrisma()` default) and the native table uses the same literal name (`syncDatabase()`'s default), so an app's Prisma and native twins share one table layout:

```prisma
model SyncDocument {
  id        String   @id @default(cuid())
  docName   String
  update    Bytes
  createdAt DateTime @default(now())

  @@index([docName])
}
```

Then run the migration:

```bash
pnpm rudder migrate
```

On a **Drizzle** app there is no publishable asset — hand-write the table (auto PK, `docName` text indexed, `update` blob/bytea, `createdAt` with a database-side default) and `syncDatabase()` works against the Drizzle adapter unchanged. Note the `createdAt` default is required: the driver never stamps timestamps app-side.

Persistence is append-only: each update is stored as a separate binary row (database/Prisma: one row per update; Redis: `rpush` onto a per-document list). On load, the full update log is replayed — there is no snapshotting or compaction.

`syncDatabase()` tolerates a missing table on reads — `rudder migrate` boots the full app, so the first document load can run before the migration that creates the table; it returns an empty doc and retries on the next read. Writes against a missing table still fail loudly.

## Auth and change hooks

`onAuth` and `onChange` are configured on `SyncConfig` (`config/sync.ts`), not via a runtime call. The provider reads them at boot.

```ts
// config/sync.ts
import { syncRedis } from '@rudderjs/sync'
import type { SyncConfig } from '@rudderjs/sync'

export default {
  persistence: syncRedis({ url: process.env.REDIS_URL }),

  /** Runs at WebSocket upgrade. Return false to reject. */
  onAuth: async (req, docName) => {
    const token = (req.headers['authorization'] as string | undefined)?.split(' ')[1]
    const user  = await verifyToken(token)
    if (!user) return false
    return await canAccess(user, docName)
  },

  /** Fires whenever a document's state advances — index, webhook, side-effect. */
  onChange: async (docName, update) => {
    await reindex(docName)
    await Webhook.dispatch('document.updated', { docName })
  },
} satisfies SyncConfig
```

`update` is the binary CRDT update (a `Uint8Array`). For semantic processing, decode it through the document type — see the editor adapters below.

## Editor adapters

The core `@rudderjs/sync` package handles transport and persistence. For server-side mutations against editor-specific document shapes (rich-text trees, structured documents), import an adapter from the matching subpath:

| Adapter | Subpath | Status |
|---|---|---|
| Lexical | `@rudderjs/sync/lexical` | Available |
| Tiptap  | —                        | Forthcoming (no subpath exported yet) |

```ts
import { Sync } from '@rudderjs/sync'
import { editBlock, insertBlock } from '@rudderjs/sync/lexical'

const doc = Sync.document('article:42:body')
insertBlock(doc, 'callToAction', { title: 'Subscribe' })
```

The adapter operates against the live `Y.Doc`, so connected clients see the change instantly through their own Lexical/Tiptap binding.

`Sync.document()` is synchronous and returns the in-process `Y.Doc` without awaiting persistence — fine for a doc that already has connected clients. When you need the persisted state hydrated first (e.g. mutating a cold document on the server), use `const doc = await Sync.load('article:42:body')`.

## Browser client

The server is `@rudderjs/sync`; the client uses standard Yjs packages:

```ts
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const doc      = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:3000/ws-sync', 'article:42', doc)

const text = doc.getText('content')
text.observe(() => console.log(text.toString()))

// Awareness — cursor, presence
provider.awareness.setLocalStateField('user', { name: 'Alice', color: '#f00' })
provider.awareness.on('change', () => {
  const states = [...provider.awareness.getStates().values()]
  console.log('Online:', states.map(s => s.user?.name))
})
```

The first argument to `WebsocketProvider` is the path; the second is the document name.

## Rudder commands

| Command | Description |
|---|---|
| `pnpm rudder sync:docs` | List active documents and connected client counts |
| `pnpm rudder sync:clear <doc>` | Clear a document from persistence |
| `pnpm rudder sync:inspect <doc>` | Inspect the Y.Doc tree structure |

`sync:inspect` is the fastest way to debug a corrupted-looking document — it prints the live tree shape from the persistence adapter.

## Pitfalls

- **Memory persistence in production.** Documents reset on restart. Either attach `syncDatabase()` / `syncRedis()` / `syncPrisma()` or accept that disconnects + restarts lose state.
- **Auth that doesn't re-check on reconnect.** `onAuth` fires on each WebSocket connection, but if your token can be revoked mid-session you need a separate revalidation path (short token TTL + reconnect, or a server-driven kick).
- **Treating awareness as durable.** Awareness state (cursors, presence) is not persisted — it lives only as long as the client connection does. Use the document content, not awareness, for anything that should survive reconnect.
- **Bypassing the editor adapter.** Hand-edited Y.Doc trees often conflict subtly with editor expectations. Use `@rudderjs/sync/lexical` (or the Tiptap adapter when shipped) for editor-aware mutations.
