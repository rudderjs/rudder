// ─── SQLite schema introspection ───────────────────────────
//
// Node-capable (reads via an {@link Executor}): the catalog reads the table
// REBUILD needs. SQLite can't change/drop a column's type in place, so a
// `.change()` triggers a 12-step rebuild (create shadow → copy → drop → rename
// → reindex); to build the shadow faithfully we must read the live column set,
// the primary key, autoincrement-ness, and the user-created indexes.
//
// SQLite-specific (PRAGMA + sqlite_master). pg/mysql introspection lands with
// their dialects (7.7/7.8); this module is only reached on the SQLite rebuild.

import type { Executor } from '../driver.js'
import type { Dialect } from '../dialect.js'

/** One column as reported by `PRAGMA table_info`. */
export interface RawColumn {
  name:    string
  /** Declared type string, e.g. `TEXT`, `INTEGER`, `NUMERIC`. */
  type:    string
  notNull: boolean
  /** Default as a raw SQL literal string (`0`, `'x'`, `CURRENT_TIMESTAMP`) or
   *  null when the column has no default. Re-emitted verbatim — it's already
   *  valid SQL from the catalog. */
  dflt:    string | null
  /** 1-based position in the primary key, or 0 if not part of it. */
  pk:      number
}

/** Read a table's columns via `PRAGMA table_info`. */
export async function readColumns(executor: Executor, dialect: Dialect, table: string): Promise<RawColumn[]> {
  const rows = await executor.execute(`PRAGMA table_info(${dialect.quoteId(table)})`, [])
  return rows.map((r) => ({
    name:    String(r['name']),
    type:    String(r['type'] ?? ''),
    notNull: Number(r['notnull']) === 1,
    dflt:    r['dflt_value'] == null ? null : String(r['dflt_value']),
    pk:      Number(r['pk'] ?? 0),
  }))
}

/** The `CREATE INDEX` statements for a table's user-created indexes (auto-indexes
 *  from PRIMARY KEY / UNIQUE constraints have a null `sql` and are excluded — the
 *  rebuilt table re-derives those from its own definition). */
export async function readIndexSql(executor: Executor, table: string): Promise<string[]> {
  const rows = await executor.execute(
    `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`,
    [table],
  )
  return rows.map((r) => String(r['sql']))
}

/** Whether `table` uses `AUTOINCREMENT` (registered in `sqlite_sequence`). The
 *  `sqlite_sequence` table only exists once some table declares AUTOINCREMENT,
 *  so a missing-table error means "no". */
export async function isAutoincrement(executor: Executor, table: string): Promise<boolean> {
  try {
    const rows = await executor.execute(`SELECT 1 FROM sqlite_sequence WHERE name = ?`, [table])
    return rows.length > 0
  } catch {
    return false
  }
}
