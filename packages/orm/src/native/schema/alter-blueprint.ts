// ─── AlterBlueprint (Schema.table) ─────────────────────────
//
// PURE: records the intents of a `Schema.table('users', (t) => …)` ALTER. It
// extends {@link Blueprint} so every column factory (`t.string`, `t.integer`, …)
// and `t.index` / `t.unique` are reused verbatim — on an alter they mean "ADD
// this column / index". On top of that it records the alter-only operations:
// drop column, rename column, drop index.
//
// SQLite supports ADD COLUMN, RENAME COLUMN, DROP COLUMN, and table RENAME
// natively (modern SQLite, which better-sqlite3 ships); the DDL compiler emits
// those directly. Changing an existing column's type (`t.string('x').change()`)
// needs the table-rebuild dance and is deferred to 7.4b — the compiler throws a
// clear error until then.

import { Blueprint } from './blueprint.js'

/** A `renameColumn(from, to)` intent. */
export interface RenameColumn {
  from: string
  to:   string
}

export class AlterBlueprint extends Blueprint {
  /** Columns to drop (`t.dropColumn('votes')`). */
  readonly droppedColumns: string[] = []
  /** Column renames (`t.renameColumn('from', 'to')`). */
  readonly renamedColumns: RenameColumn[] = []
  /** Indexes to drop by name (`t.dropIndex('users_email_unique')`). */
  readonly droppedIndexes: string[] = []

  /** Drop an existing column. */
  dropColumn(...names: string[]): void {
    this.droppedColumns.push(...names)
  }

  /** Rename an existing column. */
  renameColumn(from: string, to: string): void {
    this.renamedColumns.push({ from, to })
  }

  /** Drop an index by name. */
  dropIndex(name: string): void {
    this.droppedIndexes.push(name)
  }
}
