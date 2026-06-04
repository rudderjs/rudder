---
'@rudderjs/contracts': minor
'@rudderjs/database': minor
'@rudderjs/orm-drizzle': minor
---

feat: lock wait-behavior options — `lockForUpdate(opts?)` / `sharedLock(opts?)` accept `{ skipLocked?: boolean }` (skip rows another transaction holds — `FOR UPDATE SKIP LOCKED`, the concurrent job-reservation pattern) or `{ noWait?: boolean }` (fail immediately instead of blocking — `NOWAIT`). Mutually exclusive — both set throws at the call site. The native engine emits the clauses via `Dialect.lockSql(mode, opts)` on Postgres/MySQL 8 (SQLite stays a no-op, options included); the Drizzle adapter maps to `.for(strength, { skipLocked | noWait })` on pg/mysql. Prisma keeps throwing on the lock methods (no `FOR UPDATE` in its query API).
