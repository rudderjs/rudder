---
"@rudderjs/orm": minor
---

feat(orm): native `Schema.table` column `change()` via the SQLite table-rebuild (Phase 7.4b)

Completes `Schema.table` for the native engine: `t.<type>('col').change()` now changes an existing column's type/nullability/default. SQLite can't alter a column in place, so this runs the canonical 12-step rebuild — introspect the live table, create a shadow table with the new column set, copy the data across, drop the original, rename the shadow into place, and recreate the user indexes — preserving every non-changed column, the primary key (including `INTEGER PRIMARY KEY AUTOINCREMENT`), and unique/regular indexes.

v1 scope: `change()` must be the only operation in its `Schema.table()` call (split adds/drops/renames/index changes into a separate call); changing a primary-key column isn't supported. New `rebuildTable` + SQLite introspection helpers (`readColumns` / `readIndexSql` / `isAutoincrement`) are exported from `@rudderjs/orm/native`. Atomicity comes from the migrator's per-batch transaction. SQLite only.
