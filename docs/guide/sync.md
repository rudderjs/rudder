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

### Composite room ids

The server derives the room (doc) name from the **last non-empty `/`-segment** of the connection URL. So a `/`-joined composite id like `panel/posts/42` silently collapses to `42`, and two resources sharing a record id (`posts/42` and `comments/42`) would end up in the same `Y.Doc`. Build composite ids with `composeRoomId` / `parseRoomId` (a non-slash separator, default `':'`) so the whole id survives as one path segment:

```ts
import { composeRoomId, parseRoomId } from '@rudderjs/sync'

const room = composeRoomId(['default', 'posts', '42'])   // 'default:posts:42'
parseRoomId(room)                                        // ['default', 'posts', '42']
```

`composeRoomId` throws if a segment contains `/` or the separator, so a collision can never slip through silently.

### Reading the signed-in user in `onAuth`

When your app runs under the default server adapter (`@rudderjs/server-hono`), the framework establishes the **same session and auth context on a WebSocket upgrade that an HTTP request gets**, then runs `onAuth` inside it. So you can call `Auth.user()` / `Session` directly — exactly as in a controller — instead of re-parsing the cookie by hand:

```ts
// config/sync.ts
import { Auth } from '@rudderjs/auth'
import type { SyncConfig } from '@rudderjs/sync'

export default {
  // Authorize a collab room by the signed-in user — no manual cookie/token parsing.
  onAuth: async (_req, docName) => {
    const user = await Auth.user()   // resolves from the session cookie, as in a controller
    if (!user) return false          // unauthenticated upgrade → deny
    return canAccess(user, docName)
  },
} satisfies SyncConfig
```

Only the middleware that establish request context — session and auth — run on the upgrade; CSRF, rate-limit, and other `web`-group middleware are skipped (a rate-limiter would otherwise spend a token per upgrade). Standalone `@rudderjs/sync` with no server adapter has no context runner, so there `onAuth` receives only the raw `headers` + `url` (use the token pattern above). Both forms **fail closed** — a thrown error, a rejected promise, or a `false` return all deny and close the socket with code 4401.

### Record-backed rooms: `createCollabRoomAuth`

When each room is one record (`resource:recordId`), the `onAuth` chain is always the same: parse the room, resolve the user, load the record, apply a view policy, deny on every gap. Without it, every `resource:recordId` room is world-open — anyone can read and write any record's `Y.Doc` by guessing the key (an IDOR). `@rudderjs/sync/collab` packages that chain into one builder:

```ts
// config/sync.ts
import { createCollabRoomAuth } from '@rudderjs/sync/collab'
import { Auth } from '@rudderjs/auth'
import { Post } from 'App/Models/Post.js'
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: '/ws-sync',
  onAuth: createCollabRoomAuth({
    // Room `…:posts:42` → Post.find('42'), then Post.canView(user, post).
    resources:   { posts: Post },
    resolveUser: () => Auth.user(),   // resolves from the session cookie, as above
  }),
} satisfies SyncConfig
```

The record contract is **duck-typed** — any object with `find(id)` and `canView(user, record)` qualifies (an ORM model, a repository, or a stub), so there is no hard `@rudderjs/orm` dependency. The builder **fails closed** at every step: room that doesn't parse, no matching resource, record not found, no authenticated user, or `canView` returning anything but `true` (or throwing) all deny.

- **Room parsing** defaults to "last two segments = `[resource, recordId]`", so both `posts:42` and `tenant:posts:42` resolve to `posts` / `42`. To scope by a leading tenant/panel segment, pass your own `parseRoom` and return `null` on a mismatch.
- **`resources`** can be a static map (looked up with own-property semantics, so a room segment like `constructor` never resolves a prototype method) or a function for dynamic routing.
- **Guests** are denied by default. Set `allowGuests: true` (builder-wide) or `allowGuests` on a single resource to forward a `null` user to `canView` for deliberately public surfaces — an admitted guest can read **and** write the doc.

### Seeding rooms from a record: `createCollabRoomSeeder`

A record-backed room usually starts empty and needs its first state populated from the database — the post's title and body, say — so the first client sees content instead of a blank doc. `SyncConfig.onFirstConnect` fires once per room, after persistence has hydrated the `Y.Doc` and before the first client receives the initial state, which is exactly the moment to seed. `createCollabRoomSeeder` is the seeding counterpart to `createCollabRoomAuth`: it parses the room, loads the record, projects it to a field map, and writes it into the doc only if the doc is still empty.

```ts
// config/sync.ts
import { createCollabRoomAuth, createCollabRoomSeeder } from '@rudderjs/sync/collab'
import { Auth } from '@rudderjs/auth'
import { Post } from 'App/Models/Post.js'
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: '/ws-sync',
  onAuth: createCollabRoomAuth({
    resources:   { posts: Post },
    resolveUser: () => Auth.user(),
  }),
  onFirstConnect: createCollabRoomSeeder({
    resources: {
      // Room `…:posts:42` → Post.find('42'), then project to the doc's fields.
      posts: {
        find: (id)   => Post.find(id),
        seed: (post) => ({ title: post.title, body: post.body }),
      },
    },
  }),
} satisfies SyncConfig
```

The seed resource is **duck-typed** — any object with `find(id)` and `seed(record)` qualifies, so there is no hard `@rudderjs/orm` dependency. A single object can satisfy both builders (add a `seed` method alongside `find`/`canView`) so one model drives auth **and** seeding.

- **Idempotent and race-safe** — the write happens in a single `doc.transact`, gated on the target map still being empty. A doc already hydrated from persistence (or seeded by a racing connection) is left untouched.
- **Fail-soft on absence, fail-loud on error** — a room that doesn't parse, an unresolved resource, a missing record, or an empty `seed()` result all **skip** quietly. A `find()` / `seed()` **throw** propagates so the framework leaves the room unfired and retries on the next connection (the error surfaces via observers, never killing the socket).
- **`mapName`** defaults to `'fields'` (the same map `Sync.seed()` and the React `useCollabSeed` helpers use); **`origin`** defaults to `'rudder-sync-seed'` so a client can tell a seed apart from a user edit. Room parsing and the `resources` map/function forms behave exactly as in `createCollabRoomAuth`.

## Form-collab bindings: field ↔ share-type mapping

A flat scalar form seeds fine into one Y.Map. A **structured** form wants more: a rich-text field that merges keystroke-by-keystroke wants a `Y.Text`; a tag list wants a `Y.Array`; a nested object wants its own `Y.Map`. A **field binding** maps each field name to the Y share type that backs it, plus an optional per-field validator — the minimal, duck-typed contract that lets a structured form edit collaboratively without the framework owning a form-schema layer.

Declare bindings as the `fields` property on a seed resource — one resource then declares its share-type layout alongside `find` / `seed`:

```ts
import { createCollabRoomSeeder, type CollabFieldBindings } from '@rudderjs/sync/collab'

const fields: CollabFieldBindings = {
  title:  'text',                                   // collaborative string → Y.Text
  body:   'text',
  tags:   'array',                                  // list → Y.Array
  meta:   'map',                                    // nested object → nested Y.Map
  status: { type: 'scalar', validate: (v) => v === 'draft' || v === 'published' },
}

onFirstConnect: createCollabRoomSeeder({
  resources: {
    posts: {
      find:   (id)   => Post.find(id),
      seed:   (post) => ({ title: post.title, body: post.body, tags: post.tags, meta: post.meta, status: post.status }),
      fields,                                        // route seed values into the right share type
    },
  },
}),
```

| `type`     | Backing share                          | Seeded from                | Default |
|------------|----------------------------------------|----------------------------|---------|
| `'scalar'` | an entry in the shared fields `Y.Map`  | the value, verbatim        | ✓ (unbound fields) |
| `'text'`   | a dedicated `Y.Text` keyed by the field| a string                   | |
| `'array'` | a dedicated `Y.Array` keyed by the field| a JS array                 | |
| `'map'`    | a dedicated `Y.Map` keyed by the field | a plain object             | |

- **Scalars seed as a group**, gated on the shared map still being empty (the same whole-map idempotence as the binding-less seeder). Each `text` / `array` / `map` share gates on **its own** emptiness, so a half-seeded doc fills in the missing shares without clobbering populated ones — all in one origin-tagged transaction.
- **`validate` rejects (skips) a value** both at seed time (fail-soft, like a missing record) and on every client edit.
- Bindings are **optional and per-resource** — omit `fields` and every key seeds as a scalar, exactly as before.

### Binding a form input on the client

`@rudderjs/sync/react` exposes `useCollabField` — the client counterpart to a binding. It two-way binds a form input to its share: reads the current value, re-renders when a peer changes it, and returns a setter that validates then writes.

```tsx
import { useCollabRoom, useCollabField } from '@rudderjs/sync/react'

function PostForm({ id }: { id: string }) {
  const room = useCollabRoom(`posts:${id}`)
  const [status, setStatus] = useCollabField<string>(room, 'status', {
    type: 'scalar',
    validate: (v) => v === 'draft' || v === 'published',
  })
  const [tags, setTags] = useCollabField<string[]>(room, 'tags', 'array')

  return (
    <>
      <select value={status ?? 'draft'} onChange={(e) => setStatus(e.target.value)}>
        <option>draft</option>
        <option>published</option>
      </select>
      <TagInput value={tags ?? []} onChange={setTags} />
    </>
  )
}
```

The setter returns `false` when the validator rejects the value (the write never reaches the CRDT), so a form can surface the rejection. `useCollabField` handles the **value-shaped** share types — `scalar`, `array`, `map`. Collaborative-string (`text`) fields merge per-keystroke and bind through an editor instead (`useCollabSeedText` + a `Y.Text` editor binding); passing a `'text'` binding to `useCollabField` is a compile error.

## Row arrays: repeatable rows with stable identity

The `array` field binding above backs a flat list of **scalars** (a tag list) with one `Y.Array`. An **array of records** (a repeater, an editable table, a list of objects) needs more: each row wants a stable identity that survives concurrent edits, and a clean reorder. Yjs has no native move on `Y.Array`, and the usual delete-then-insert workaround on an array of objects throws away the moved row's per-field merge history. So a **row-array binding** keeps data and order in separate shares:

| Share       | Shape                                                    | Holds |
|-------------|----------------------------------------------------------|-------|
| `row-data`  | `Y.Map<arrayName, Y.Map<rowId, Y.Map<field, value>>>`    | each row's fields, keyed by a stable id |
| `row-order` | `Y.Map<arrayName, Y.Array<rowId>>`                       | the row sequence |

A row's id is a generated UUID for a fresh row, or a DB primary key you pass in. The row map is attached once and **never moves**: a reorder only deletes+inserts the plain `rowId` string in the order array, which is lossless because the row's data stays put. Non-text field values use whole-value LWW. Both shares live in the same `Y.Doc` as your field bindings (under distinct top-level roots), so they persist over the same transport with no schema or server change.

### Server / framework-free primitives

`@rudderjs/sync/collab` exposes the primitives: a plain `Y.Doc` in, plain rows out, no React, no ORM:

```ts
import { addRow, moveRow, removeRow, readRows, seedRows } from '@rudderjs/sync/collab'
import { Sync } from '@rudderjs/sync'

const doc = await Sync.load('invoices:42')

// Seed once (idempotent, gated on the order array still being empty):
seedRows(doc, 'lineItems', [{ id: 'pk-1', sku: 'A', qty: 2 }])

const id = addRow(doc, 'lineItems', { sku: 'B', qty: 1 })  // → stable id (UUID)
moveRow(doc, 'lineItems', id, 0)                           // order-only, lossless
removeRow(doc, 'lineItems', 'pk-1')

readRows(doc, 'lineItems')   // → [{ id, sku, qty }, …] in order
```

Companion primitives: `readRow`, `setRowField` / `updateRow` (whole-value LWW), `observeRows`, and `newRowId`.

### Binding rows on the client

`@rudderjs/sync/react` exposes `useCollabRows`, the row counterpart to `useCollabField`. It reads the rows in order, re-renders when a peer adds / removes / reorders a row or edits any field, and returns a referentially-stable mutation API:

```tsx
import { useCollabRoom, useCollabRows } from '@rudderjs/sync/react'

function LineItems({ id }: { id: string }) {
  const room = useCollabRoom(`invoices:${id}`)
  const [rows, items] = useCollabRows<{ sku: string; qty: number }>(room, 'lineItems')

  return (
    <>
      {rows.map((r) => (
        <tr key={r.id}>
          <td><input value={r.sku} onChange={(e) => items.setField(r.id, 'sku', e.target.value)} /></td>
          <td><input type="number" value={r.qty} onChange={(e) => items.setField(r.id, 'qty', +e.target.value)} /></td>
          <td><button onClick={() => items.remove(r.id)}>×</button></td>
        </tr>
      ))}
      <button onClick={() => items.add({ sku: '', qty: 1 })}>Add row</button>
    </>
  )
}
```

The `key={r.id}` is the point: because the id is stable, React keeps each row's DOM (and its caret / focus) across a reorder, and a peer's concurrent field edit lands on the right row even while another peer is moving it. Until the room resolves, `rows` is `[]` and the mutation API is a set of no-ops.

> **Text inside a row.** `useCollabRows` carries non-text values (whole-value LWW). A per-row rich-text field that should merge keystroke-by-keystroke is a renderer choice: keep its text leaves in a dedicated `Y.Text` keyed by the row id and bind it through an editor adapter, exactly as a top-level `text` field does.

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

### React hooks

`@rudderjs/sync/react` wraps the provider lifecycle in a hook so a component connects to a room without re-implementing it. `useCollabRoom(roomKey, options?)` returns a `CollabRoom | null` (the live `ydoc` + `provider`), reconnecting and tearing down with the component:

```tsx
import { useCollabRoom } from '@rudderjs/sync/react'

function Editor({ id }: { id: string }) {
  const room = useCollabRoom(`doc:${id}`, { offline: true })
  if (!room) return <Spinner />
  // bind room.ydoc / room.provider to your editor...
}
```

If the server's `onAuth` gate rejects the upgrade (WS close 4401/4403), the hook stops reconnecting (y-websocket would otherwise retry ~10x/second) and returns `null`. Pass `onDenied` to tell "denied" apart from "still connecting":

```tsx
const room = useCollabRoom(`doc:${id}`, { onDenied: () => setDenied(true) })
```

### Presence

The presence hooks layer awareness on top of a room. `useCollabPresence` mirrors the local user's `{ name, color }` onto awareness so peers can render carets and chips; `collabColorFromSeed` derives a stable `#rrggbb` color from a seed (hex, because Tiptap's CollaborationCaret rejects `hsl(...)`):

```tsx
import { useCollabPresence, collabColorFromSeed } from '@rudderjs/sync/react'

useCollabPresence(room, { name: user.name, color: collabColorFromSeed(user.email) })
```

`useReportAwarenessField(room, key, value)` writes a value into the local awareness (clearing it on change/unmount); `useAwarenessField(room, key)` reads the remote peers that hold a non-null value for that key (local excluded, deduped, re-rendering only on a real change). `useFieldPresence(room, fieldName)` is the convenience built on top for "who else is editing this field":

```tsx
import { useReportAwarenessField, useFieldPresence } from '@rudderjs/sync/react'

// writer: report the focused field
useReportAwarenessField(room, 'focusField', isFocused ? fieldName : null)

// reader: peers focused on this field
const editors = useFieldPresence(room, fieldName)   // [{ clientId, name, color }]
```

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
