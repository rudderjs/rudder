---
"@rudderjs/orm": minor
---

feat(orm): native schema builder — `Schema.create` + `Blueprint` for the SQLite engine (Phase 7.1)

Adds a Laravel-style schema builder to the native engine at `@rudderjs/orm/native`: a `Blueprint` records column/index/primary-key intents, a pure per-dialect DDL compiler turns them into `CREATE TABLE` / `CREATE INDEX` statements, and `SchemaBuilder` executes them against a driver (plus `drop`/`dropIfExists`/`hasTable`/`hasColumn` introspection).

This is the first slice of native migrations (Phase 7.1) — the schema-definition engine. The static `Schema` facade, `Migration` base class, and the `migrate` / `migrate:rollback` runner land in 7.2+. Column types cover the common set (`id`/`increments`, `string`, `text`, `integer`/`bigInteger`, `boolean`, `dateTime`/`timestamp`, `json`, `uuid`, `decimal`, `float`, `binary`, `foreignId`) with `nullable`/`default`/`useCurrent`/`unique`/`index`/`primary` modifiers and `timestamps()`/`softDeletes()` clusters. SQLite only for now (the DDL compiler is dialect-pluggable; pg/mysql arrive in 7.7/7.8). Additive and opt-in — Prisma/Drizzle apps are untouched.
