---
'@rudderjs/contracts': minor
'@rudderjs/database': minor
'@rudderjs/orm': minor
'@rudderjs/orm-drizzle': minor
'@rudderjs/orm-prisma': minor
---

feat: transaction isolation levels — `transaction(fn, { isolationLevel })` / `DB.transaction(fn, { isolationLevel })` / `Model.transaction(fn, { isolationLevel })` with `'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'`. The native engine emits `SET TRANSACTION ISOLATION LEVEL …` at transaction start on Postgres/MySQL; the Drizzle adapter passes the level through to Drizzle's transaction config; the Prisma adapter maps it to `$transaction`'s `isolationLevel` option. SQLite throws a clear unsupported error (no isolation levels — single-writer is already serializable), and a nested `transaction()` call (savepoint) rejects the option on every adapter.
