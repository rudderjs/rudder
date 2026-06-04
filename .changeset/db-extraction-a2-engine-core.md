---
'@rudderjs/database': minor
'@rudderjs/orm': minor
---

Phase-2 engine relocation, step 2: the native engine's core moves to `@rudderjs/database/native`.

The SQL compiler, the three dialects (sqlite/pg/mysql), the driver seam (`Driver`/`AffectingExecutor`), the concrete drivers (`BetterSqlite3Driver`/`PostgresDriver`/`MysqlDriver`), `NativeQueryBuilder`, the engine errors, and the schema column definitions relocate from `packages/orm/src/native/` to `@rudderjs/database`'s new node-only `./native` subpath. `@rudderjs/database` now declares the driver packages (`better-sqlite3`/`postgres`/`mysql2`) as optional peers, mirroring `@rudderjs/orm`.

**No public surface changes.** `@rudderjs/orm/native` re-exports every relocated name from `@rudderjs/database/native`, byte-compatible with the previous barrel — app migration files, `NativeAdapter` wiring, and standalone-Node consumers are unaffected. The dev-HMR driver cache key (`__rudderjs_native_client__`) and its signature format are unchanged, so a dev re-boot across this upgrade reuses (or cleanly disposes) live connections instead of leaking them.

`NativeAdapter`, the schema builder + migrator, and `NativeDatabaseProvider` still live in `@rudderjs/orm` and follow in the next step (PR-A3). Part of `docs/plans/2026-06-04-database-extraction-phase-2.md`.
