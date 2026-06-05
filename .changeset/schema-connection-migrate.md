---
'@rudderjs/database': minor
'@rudderjs/orm': minor
---

Multi-database migrations on the native engine (Laravel `--database` / `Schema::connection` parity). `migrate`, `migrate:status`, `migrate:rollback`, `migrate:reset`, `migrate:refresh`, and `migrate:fresh` take `--connection=<name>` — the suite runs against the named connection with its `migrations` state table on that connection — plus `--path=<dir>` to keep per-database migration sets apart. Works even when the app's default engine is prisma/drizzle, as long as the named connection is `engine: 'native'`. Inside migrations (or anywhere the app has booted), `Schema.connection('reporting').create(…)` scopes one DDL operation to a named native connection through the same resolver seam as `DB.connection()`; non-native connections throw a clear error, and the call refuses under `migrate --pretend` (the dry run can't record a second connection). Cross-connection DDL runs outside the migrator's batch transaction — documented boundary.
