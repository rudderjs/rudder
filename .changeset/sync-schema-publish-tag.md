---
"@rudderjs/sync": minor
---

`SyncProvider` now registers a `sync-schema` publish group: `pnpm rudder vendor:publish --tag=sync-schema` drops the `SyncDocument` Prisma model into `prisma/schema/` (then `pnpm rudder migrate`). The model name is load-bearing — the delegate must be `syncDocument`, `syncPrisma()`'s default. Prisma-only: redis/in-memory persistence need no schema. Previously the docs referenced this tag but nothing registered it, so the documented one-command setup errored with "No publishable assets found".
