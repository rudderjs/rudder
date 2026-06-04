---
"@rudderjs/database": minor
"@rudderjs/orm": minor
"@rudderjs/cli": minor
---

feat: `db:show` / `db:table` CLI commands — Laravel-parity database inspection over the native engine. `db:show` lists every table with on-disk sizes (`--counts` adds row counts, `--views` adds the view list); `db:table <name>` shows columns, indexes (incl. a synthesized PRIMARY entry on SQLite rowid tables), and foreign keys with update/delete rules. Both support `--json`. New `@rudderjs/database` exports: `inspectDatabase`/`inspectTable`/`readIndexes`/`readForeignKeys` (+ `NativeAdapter.inspectDatabase()`/`.inspectTable()`). Prisma/Drizzle apps get a friendly pointer to `prisma studio` / `drizzle-kit studio`.
