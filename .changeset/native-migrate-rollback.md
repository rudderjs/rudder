---
"@rudderjs/orm": minor
"@rudderjs/cli": patch
---

feat(orm): native `migrate:rollback` / `migrate:refresh` / `migrate:fresh` + transactional batches

The native SQLite engine can now reverse migrations, not just apply them:

- **`migrate:rollback`** reverts the last batch — each migration's `down()` runs in reverse apply order and its `migrations` row is deleted.
- **`migrate:refresh`** rolls every migration back and re-runs them all.
- **`migrate:fresh`** drops all tables and re-applies from scratch (now wired for native; prisma/drizzle keep shelling out).
- On prisma/drizzle apps, `migrate:rollback` / `migrate:refresh` print a clear "forward-only — use `migrate:fresh`" message instead of shelling out.

Each batch (the `up()`s in a `run()`, the `down()`s in a rollback) now executes inside a **single transaction**, so a failure mid-batch rolls the whole batch back atomically — the DDL and the `migrations` state-table writes commit or roll back together. The `Migrator` gains `rollback()`, `rollbackAll()`, `lastBatch()`, `migrationsInBatch()`, and `dropAllTables()`; `MigratorAdapter` now requires `transaction()` (already implemented by `NativeAdapter`).
