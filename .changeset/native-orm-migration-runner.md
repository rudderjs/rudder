---
"@rudderjs/orm": minor
"@rudderjs/cli": patch
---

feat(orm): native migration runner — `Migration` + `Schema` facade + `migrate` / `migrate:status` (Phase 7.2)

Builds the migration runner on top of the 7.1 schema builder, so the native SQLite engine now runs Laravel-style migrations in-process (no external tool):

- **`Migration`** base class (`up()` / `down()`) and the static **`Schema`** facade (`Schema.create` / `drop` / `dropIfExists` / `hasTable` / `hasColumn`) that migration files call — exported from `@rudderjs/orm/native`.
- **`Migrator`** — tracks applied migrations in a `migrations` table (`id`, `migration`, `batch`, mirroring Laravel), applies pending ones in a new batch, and reports status. Plus **`discoverMigrations(dir)`** which loads `database/migrations/*.{ts,js,mts,mjs}` files sorted by name.
- **`NativeAdapter.schemaBuilder()`** — exposes a connection-bound `SchemaBuilder` for the runner.
- **CLI**: `rudder migrate` and `rudder migrate:status` now detect a native-engine app (no prisma/drizzle adapter package installed) and run the in-process `Migrator` against the booted adapter, instead of shelling out. Prisma/Drizzle apps are unchanged. The CLI boots the app on demand for the native path (`migrate*` otherwise skip boot).

`migrate:rollback` / `migrate:refresh` (which reverse a batch via `down()`) and transactional batches land in 7.5; the `batch` column is recorded now so rollback has the grouping it needs. `make:migration` for native (the stub generator) is 7.3 — for now, author migration files by hand. SQLite only; additive and opt-in.
