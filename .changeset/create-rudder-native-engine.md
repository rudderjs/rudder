---
"create-rudder": minor
---

feat(create-rudder): add the built-in native engine as a Database option (now the default)

The scaffolder's **Database** prompt now offers **Native** — the zero-dependency built-in engine (`@rudderjs/orm/native`) — alongside Prisma and Drizzle, and it's the pre-highlighted default. Selecting it:

- pins the driver to SQLite (the native engine's only supported driver today; the driver prompt is skipped) and adds `@rudderjs/orm` + `better-sqlite3` instead of a `@rudderjs/orm-*` adapter package;
- writes a `config/database.ts` that opts in with `engine: 'native'` (the auto-discovered `NativeDatabaseProvider` boots from it);
- when auth is selected, scaffolds a working `database/migrations/0001_01_01_000000_create_users_table.ts` so the app is fully migrated and typed out of the box;
- runs `rudder migrate` in the post-install cascade (instead of the Prisma/Drizzle-only `db:generate` / `db:push`), creating `dev.db`, applying the migration, and generating the typed schema registry.

`--orm=native` works in non-interactive/JSON mode too (Prisma stays the implicit recipe default there). Prisma/Drizzle remain the path to Postgres/MySQL.
