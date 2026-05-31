---
"@rudderjs/orm": minor
---

feat(orm): `make:migration <name>` now generates a native migration stub for native-engine apps

For an app on the native SQLite engine (no `@rudderjs/orm-prisma` / `@rudderjs/orm-drizzle` installed), `rudder make:migration <name>` writes a timestamped, hand-authored up/down stub to `database/migrations/<timestamp>_<name>.ts` instead of shelling out to an external migration tool. Laravel-style name inference scaffolds the common case: a `create_<table>_table` name produces an `up()` with `Schema.create('<table>', …)` (`t.id()` + `t.timestamps()`) and a `down()` that drops the table; any other name yields a generic empty stub with `// TODO` markers. Prisma/Drizzle apps and the `--vector` flag path are unchanged.
