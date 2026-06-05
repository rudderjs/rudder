---
"@rudderjs/orm": minor
---

feat: optimistic locking — `static version` on a Model (`true` → integer column `version`, string → custom column name). `create()` stamps the column with 1; `save()` and `Model.update()` with a version baseline write conditionally (`UPDATE ... SET version = v + 1 WHERE pk = ? AND version = v`) and throw the new `OptimisticLockError` (stable `code: 'OPTIMISTIC_LOCK'`, `expectedVersion`/`actualVersion`, duck-typed `httpStatus = 409`) when another writer got there first — nothing is written on a stale save. Updates without a baseline bump the column atomically with no stale check. Built on the `where().updateAll()` / `increment` contract primitives, so it works identically on the native engine, Drizzle, and Prisma with no adapter changes. The version column survives a `fillable` list that omits it (lock metadata, not data) and `replicate()` strips it so clones restart at version 1.
