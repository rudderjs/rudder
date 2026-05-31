---
"@rudderjs/orm": minor
---

feat(orm): native `Schema.table` alters + `Schema.rename` (Phase 7.4)

Adds table-alteration to the native engine's schema builder (`@rudderjs/orm/native`):

- **`Schema.table('users', (t) => …)`** — add columns (any `Blueprint` column method), `t.dropColumn(...)`, `t.renameColumn(from, to)`, add indexes (`t.index` / `t.unique` / per-column `.unique()`/`.index()`), and `t.dropIndex(name)`. Compiled to separate `ALTER TABLE` / `CREATE INDEX` / `DROP INDEX` statements in dependency order (rename → add → add-index → drop-index → drop-column).
- **`Schema.rename(from, to)`** — `ALTER TABLE … RENAME TO …`.
- New `AlterBlueprint` + `compileAlterTable` / `compileRenameTable` + `ColumnBuilder.change()`.

SQLite's ADD COLUMN limits are enforced with clear errors: you can't add a primary-key column to an existing table, and a NOT NULL column must carry a default (`.default(...)` or `.nullable()`). Changing an existing column's *type* (`.change()`) needs the SQLite table-rebuild dance and throws a clear "lands in 7.4b" error for now. SQLite only; additive and opt-in.
