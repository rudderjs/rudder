# @rudderjs/sync needs a native-engine persistence driver (syncDatabase)

**Status:** RESOLVED 2026-06-06 — `syncDatabase()` shipped in `@rudderjs/sync`
(this PR): adapter resolved from `app().make('db')` (native/Prisma/Drizzle),
`syncDocument` table shared with `syncPrisma()`'s delegate, publishable native
migration via `vendor:publish --tag=sync-schema` (vendor:publish learned to
detect the native engine), LRU doc cache, missing-table tolerance on reads.
All five implementation notes below are honored — except #2: the driver
deliberately does NOT stamp `createdAt` app-side; the shipped migration gives
the column a database-side default (`useCurrent()`), which sidesteps the
Date-binding problem portably across sqlite/pg/mysql. #4 doesn't apply inside
the framework (`@rudderjs/sync` hard-deps `@rudderjs/core`). The playground
now runs `syncDatabase()` (see `playground/config/sync.ts`).

Originally filed from the pilotiq-pro native-engine migration (2026-06-05).

## Problem

`@rudderjs/sync@1.4.0` ships three `SyncPersistence` drivers: memory (default), `syncPrisma()`,
and `syncRedis()`. An app on the native database engine (`@rudderjs/database`, `engine: 'native'`)
has no first-party option:

- `syncPrisma()` resolves `app().make('prisma')` and falls back to `new PrismaClient()` — both
  dead ends in a native-engine app (no `'prisma'` binding, `@prisma/client` not installed).
- Y.Doc persistence is exactly the kind of infra the framework should own next to the engine.

## Interim

`@pilotiq-pro/collab/server` now exports `syncDatabase(config?)` (pilotiq-pro
`packages/collab/src/syncDatabase.ts`) — a `SyncPersistence` over the duck-typed ORM adapter
(`app().make('db')` → `query(table)`), mirroring `syncPrisma`'s shape: `syncDocument` update-log
table (`id` TEXT PK, `docName` TEXT indexed, `update` BLOB, `createdAt` DATETIME), 256-entry LRU
doc cache, `sync.error` observer emission. Lift it (or an equivalent) into `@rudderjs/sync`.

## Implementation notes (all learned the hard way)

1. **Buffer, not Uint8Array** — better-sqlite3 binds Buffers only; wrap updates in
   `Buffer.from(u.buffer, u.byteOffset, u.byteLength)` before insert.
2. **ISO strings, not Dates** — better-sqlite3 can't bind Date objects; stamp `createdAt`
   app-side with `new Date().toISOString()`.
3. **Missing-table tolerance on reads** — `rudder migrate` boots the FULL app; `getYDoc` must
   return an empty doc (and NOT cache it) when the table doesn't exist yet, else migrate can
   never create it. Probe: sqlite `no such table` message + pg `42P01` + mysql errno 1146,
   recursing into `.cause`.
4. **Resolution from a library package** — the `'db'` lookup needs `@rudderjs/core` resolvable
   from the *adapter's* package at runtime. A variable-specifier dynamic import keeps the dep
   soft and hides the edge from Vite's client import-analysis, but the package must still
   declare `@rudderjs/core` as a peer or every WS connection closes 1011 "persistence load
   failed" (each y-websocket client then retries in a ~1s loop — the failure mode looks like
   "collab silently broken", not like a missing dep).
5. A `table` config option (default `'syncDocument'`) keeps parity with `syncPrisma({ model })`.
