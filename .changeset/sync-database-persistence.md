---
"@rudderjs/sync": minor
---

New `syncDatabase()` persistence driver — stores the Yjs update log through the app's active ORM adapter (`app().make('db')`), making durable sync a first-party option on the native engine (and working unchanged on the Prisma/Drizzle adapters). Shares the adapter's existing connection, defaults to the same `syncDocument` table layout as `syncPrisma()`, wraps updates as Buffers for driver compatibility, keeps a bounded LRU doc cache, and tolerates a missing table on reads so `rudder migrate` can boot the app before the table exists. A ready-made native migration ships under the existing `sync-schema` vendor:publish tag.

Also fixes `sync:clear <doc>` / `sync:inspect <doc>` reading their `<doc>` argument from the wrong shape — both commands operated on `undefined` (sync:clear deleted nothing while printing success).
