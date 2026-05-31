// ─── Schema introspection (catalog reads) ──────────────────
//
// Node-capable (reads via an {@link Executor}). Two consumers:
//   1. The SQLite table REBUILD — SQLite can't change/drop a column's type in
//      place, so a `.change()` triggers a 12-step rebuild (create shadow → copy
//      → drop → rename → reindex); to build the shadow faithfully we read the
//      live column set, the primary key, autoincrement-ness, and user indexes.
//   2. The schema→types generator (`collectSchemaTypes`) — `readTables` +
//      `readColumns` feed the `.d.ts` emitter on every dialect.
//
// `readTables` / `readColumns` branch on `dialect.name`: SQLite via PRAGMA +
// `sqlite_master`, Postgres via `information_schema` (7.7). The rebuild-only
// helpers below (`readIndexSql`, `isAutoincrement`) stay SQLite-specific — the
// rebuild dance is a SQLite workaround pg/mysql don't need. MySQL: 7.8.

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

/** Every user table name, excluding the framework's own `migrations` bookkeeping
 *  table (and SQLite internal `sqlite_*`) — neither belongs in generated model
 *  types. Postgres reads the current schema's base tables; SQLite reads
 *  `sqlite_master`. */
export async function readTables(executor: Executor, dialect: Dialect): Promise<string[]> {
  if (dialect.name === 'pg') {
    const rows = await executor.execute(
      `SELECT table_name AS name FROM information_schema.tables ` +
      `WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name != 'migrations' ` +
      `ORDER BY table_name`,
      [],
    )
    return rows.map((r) => String(r['name']))
  }
  const rows = await executor.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations' ORDER BY name`,
    [],
  )
  return rows.map((r) => String(r['name']))
}

/** Read a table's columns — Postgres via `information_schema.columns`, SQLite via
 *  `PRAGMA table_info`. The `pk` ordinal is only meaningful on SQLite (the
 *  rebuild path); on Postgres it's left 0 because PK columns are `NOT NULL`, so
 *  `notNull` already drives the type generator's nullability rule. */
export async function readColumns(executor: Executor, dialect: Dialect, table: string): Promise<RawColumn[]> {
  if (dialect.name === 'pg') {
    const rows = await executor.execute(
      `SELECT column_name, data_type, is_nullable, column_default ` +
      `FROM information_schema.columns ` +
      `WHERE table_schema = current_schema() AND table_name = ${dialect.placeholder(0)} ` +
      `ORDER BY ordinal_position`,
      [table],
    )
    return rows.map((r) => ({
      name:    String(r['column_name']),
      type:    String(r['data_type'] ?? ''),
      notNull: String(r['is_nullable']).toUpperCase() === 'NO',
      dflt:    r['column_default'] == null ? null : String(r['column_default']),
      pk:      0,
    }))
  }
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
