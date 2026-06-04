// ─── Database/table inspection (db:show / db:table) ────────
//
// Catalog readers behind the `rudder db:show` / `rudder db:table` CLI commands
// (Laravel's `db:show` / `db:table` analogs). Node-capable, reads via an
// {@link Executor} + {@link Dialect} pair — same seam as `introspect.ts`, whose
// `readColumns` this reuses for the per-table column listing.
//
// Unlike `readTables` (which feeds the types generator and so excludes the
// `migrations` bookkeeping table), inspection lists EVERY user table —
// `migrations` is a real table and an inspection tool shouldn't hide it.
//
// Per-dialect notes:
//   - sqlite: PRAGMAs can't take bound params — table names interpolate via
//     `quoteId` AFTER an existence check against the catalog (so `db:table` only
//     ever splices a name the catalog itself reported). Per-table sizes come
//     from the `dbstat` virtual table when the build ships it (try/catch — many
//     don't); the whole-DB size from `page_count * page_size` always works.
//   - pg: `information_schema` for tables/views, `pg_total_relation_size` for
//     sizes, `pg_index`/`pg_constraint` for indexes/FKs (information_schema
//     can't pair composite-FK columns reliably; `unnest WITH ORDINALITY` can).
//   - mysql: `information_schema` throughout (`statistics` for indexes,
//     `key_column_usage` + `referential_constraints` for FKs).

import type { Executor } from '../driver.js'
import type { Dialect } from '../dialect.js'
import { readColumns, type RawColumn } from './introspect.js'

/** One table in the `db:show` overview. */
export interface TableSummary {
  name: string
  /** On-disk size in bytes, or null when the dialect can't report it (sqlite
   *  without the `dbstat` module). */
  sizeBytes: number | null
  /** `COUNT(*)` — only populated when `db:show --counts` asks for it. */
  rows?: number
}

/** The `db:show` payload. */
export interface DatabaseInfo {
  dialect:  'sqlite' | 'pg' | 'mysql'
  /** Server/library version (`sqlite_version()`, pg `server_version`, mysql `VERSION()`). */
  version:  string | null
  /** Current database name — pg/mysql catalog name, sqlite main file path
   *  (`:memory:` shows as null). */
  database: string | null
  tables:   TableSummary[]
  /** View names — only populated when `db:show --views` asks for them. */
  views?:   string[]
}

/** One index in the `db:table` detail. */
export interface IndexInfo {
  name:    string
  columns: string[]
  unique:  boolean
  primary: boolean
}

/** One foreign key in the `db:table` detail. `columns[i]` references
 *  `foreignColumns[i]`. */
export interface ForeignKeyInfo {
  /** Constraint name — null on sqlite (PRAGMA reports an ordinal, not a name). */
  name:           string | null
  columns:        string[]
  foreignTable:   string
  foreignColumns: string[]
  onUpdate:       string | null
  onDelete:       string | null
}

/** The `db:table <name>` payload. */
export interface TableInfo {
  name:        string
  columns:     RawColumn[]
  indexes:     IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
  rows:        number
  sizeBytes:   number | null
}

// ─── Shared catalog reads ──────────────────────────────────

/** Every user table including `migrations` (the types-generator exclusion in
 *  `readTables` doesn't apply to inspection). */
async function listTables(executor: Executor, dialect: Dialect): Promise<string[]> {
  if (dialect.name === 'pg') {
    const rows = await executor.execute(
      `SELECT table_name AS name FROM information_schema.tables ` +
      `WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [],
    )
    return rows.map((r) => String(r['name']))
  }
  if (dialect.name === 'mysql') {
    const rows = await executor.execute(
      `SELECT table_name AS name FROM information_schema.tables ` +
      `WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`,
      [],
    )
    return rows.map((r) => String(r['name'] ?? r['NAME'] ?? r['TABLE_NAME']))
  }
  const rows = await executor.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    [],
  )
  return rows.map((r) => String(r['name']))
}

async function scalar(executor: Executor, sql: string, bindings: unknown[] = []): Promise<unknown> {
  const rows = await executor.execute(sql, bindings)
  const first = rows[0]
  if (!first) return null
  const key = Object.keys(first)[0]
  return key === undefined ? null : first[key]
}

async function countRows(executor: Executor, dialect: Dialect, table: string): Promise<number> {
  return Number(await scalar(executor, `SELECT COUNT(*) AS c FROM ${dialect.quoteId(table)}`))
}

/** Per-table sizes keyed by table name; empty map when the dialect can't say. */
async function readSizes(executor: Executor, dialect: Dialect): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  if (dialect.name === 'pg') {
    const rows = await executor.execute(
      `SELECT table_name AS name, pg_total_relation_size(format('%I.%I', table_schema, table_name)) AS size ` +
      `FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
      [],
    )
    for (const r of rows) sizes.set(String(r['name']), Number(r['size']))
    return sizes
  }
  if (dialect.name === 'mysql') {
    const rows = await executor.execute(
      `SELECT table_name AS name, data_length + index_length AS size ` +
      `FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
      [],
    )
    for (const r of rows) sizes.set(String(r['name'] ?? r['NAME'] ?? r['TABLE_NAME']), Number(r['size'] ?? r['SIZE']))
    return sizes
  }
  // sqlite: dbstat is an optional compile-time module — absent on many builds.
  try {
    const rows = await executor.execute(`SELECT name, SUM(pgsize) AS size FROM dbstat GROUP BY name`, [])
    for (const r of rows) sizes.set(String(r['name']), Number(r['size']))
  } catch { /* no dbstat — sizes stay null */ }
  return sizes
}

// ─── db:show ───────────────────────────────────────────────

export async function inspectDatabase(
  executor: Executor,
  dialect: Dialect,
  opts: { counts?: boolean; views?: boolean } = {},
): Promise<DatabaseInfo> {
  const names = await listTables(executor, dialect)
  const sizes = await readSizes(executor, dialect)

  let version: string | null
  let database: string | null
  if (dialect.name === 'pg') {
    version  = String(await scalar(executor, `SELECT current_setting('server_version') AS v`) ?? '') || null
    database = String(await scalar(executor, `SELECT current_database() AS db`) ?? '') || null
  } else if (dialect.name === 'mysql') {
    version  = String(await scalar(executor, `SELECT VERSION() AS v`) ?? '') || null
    database = String(await scalar(executor, `SELECT DATABASE() AS db`) ?? '') || null
  } else {
    version = String(await scalar(executor, `SELECT sqlite_version() AS v`) ?? '') || null
    const list = await executor.execute(`PRAGMA database_list`, [])
    const main = list.find((r) => String(r['name']) === 'main')
    const file = main ? String(main['file'] ?? '') : ''
    database = file === '' ? null : file
  }

  const tables: TableSummary[] = []
  for (const name of names) {
    const summary: TableSummary = { name, sizeBytes: sizes.get(name) ?? null }
    if (opts.counts) {
      // Per-table COUNT(*) races concurrent DDL on a shared database — a table
      // the catalog just listed can be dropped before its count runs (a
      // migration mid-`db:show`, or parallel live-test suites on one CI
      // database). A vanished/unreadable table keeps `rows` undefined instead
      // of failing the whole overview; the renderer shows `—`.
      try { summary.rows = await countRows(executor, dialect, name) } catch { /* dropped mid-scan */ }
    }
    tables.push(summary)
  }

  const info: DatabaseInfo = { dialect: dialect.name, version, database, tables }
  if (opts.views) info.views = await listViews(executor, dialect)
  return info
}

async function listViews(executor: Executor, dialect: Dialect): Promise<string[]> {
  if (dialect.name === 'pg') {
    const rows = await executor.execute(
      `SELECT table_name AS name FROM information_schema.views WHERE table_schema = current_schema() ORDER BY table_name`,
      [],
    )
    return rows.map((r) => String(r['name']))
  }
  if (dialect.name === 'mysql') {
    const rows = await executor.execute(
      `SELECT table_name AS name FROM information_schema.views WHERE table_schema = DATABASE() ORDER BY table_name`,
      [],
    )
    return rows.map((r) => String(r['name'] ?? r['NAME'] ?? r['TABLE_NAME']))
  }
  const rows = await executor.execute(`SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name`, [])
  return rows.map((r) => String(r['name']))
}

// ─── db:table ──────────────────────────────────────────────

/** Inspect one table — null when the table doesn't exist (the caller renders
 *  the available-tables hint). The existence check doubles as the injection
 *  gate: PRAGMA/`COUNT(*)` interpolation only ever sees the catalog's own
 *  spelling of the name, never the raw CLI argument. */
export async function inspectTable(
  executor: Executor,
  dialect: Dialect,
  table: string,
): Promise<TableInfo | null> {
  const names = await listTables(executor, dialect)
  const name  = names.find((n) => n === table)
  if (name === undefined) return null

  const [columns, indexes, foreignKeys, rows, sizes] = [
    await readColumns(executor, dialect, name),
    await readIndexes(executor, dialect, name),
    await readForeignKeys(executor, dialect, name),
    await countRows(executor, dialect, name),
    await readSizes(executor, dialect),
  ]
  return { name, columns, indexes, foreignKeys, rows, sizeBytes: sizes.get(name) ?? null }
}

/** A table's indexes. On sqlite an INTEGER PRIMARY KEY is the rowid — no index
 *  row exists for it, so a `PRIMARY` pseudo-entry is synthesized from the
 *  column PK ordinals (mirrors Laravel's SQLite schema reader). */
export async function readIndexes(executor: Executor, dialect: Dialect, table: string): Promise<IndexInfo[]> {
  if (dialect.name === 'pg') {
    const rows = await executor.execute(
      `SELECT i.relname AS name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary, ` +
      `a.attname AS col, array_position(ix.indkey::int2[], a.attnum) AS pos ` +
      `FROM pg_index ix ` +
      `JOIN pg_class i ON i.oid = ix.indexrelid ` +
      `JOIN pg_class t ON t.oid = ix.indrelid ` +
      `JOIN pg_namespace n ON n.oid = t.relnamespace ` +
      `JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) ` +
      `WHERE t.relname = ${dialect.placeholder(0)} AND n.nspname = current_schema() ` +
      `ORDER BY i.relname, pos`,
      [table],
    )
    return groupIndexRows(rows.map((r) => ({
      name:    String(r['name']),
      col:     String(r['col']),
      unique:  r['is_unique'] === true || r['is_unique'] === 't',
      primary: r['is_primary'] === true || r['is_primary'] === 't',
    })))
  }
  if (dialect.name === 'mysql') {
    const rows = await executor.execute(
      `SELECT index_name AS name, non_unique, column_name AS col ` +
      `FROM information_schema.statistics ` +
      `WHERE table_schema = DATABASE() AND table_name = ${dialect.placeholder(0)} ` +
      `ORDER BY index_name, seq_in_index`,
      [table],
    )
    return groupIndexRows(rows.map((r) => {
      const name = String(r['name'] ?? r['NAME'] ?? r['INDEX_NAME'])
      return {
        name,
        col:     String(r['col'] ?? r['COL'] ?? r['COLUMN_NAME']),
        unique:  Number(r['non_unique'] ?? r['NON_UNIQUE']) === 0,
        primary: name === 'PRIMARY',
      }
    }))
  }

  const indexes: IndexInfo[] = []
  const list = await executor.execute(`PRAGMA index_list(${dialect.quoteId(table)})`, [])
  for (const ix of list) {
    const ixName = String(ix['name'])
    const info   = await executor.execute(`PRAGMA index_info(${dialect.quoteId(ixName)})`, [])
    indexes.push({
      name:    ixName,
      columns: info.map((r) => String(r['name'])),
      unique:  Number(ix['unique']) === 1,
      primary: String(ix['origin']) === 'pk',
    })
  }
  if (!indexes.some((ix) => ix.primary)) {
    const pkCols = (await readColumns(executor, dialect, table))
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    if (pkCols.length > 0) indexes.unshift({ name: 'PRIMARY', columns: pkCols, unique: true, primary: true })
  }
  return indexes
}

/** Fold per-column index rows (already ordered by index then position) into
 *  one entry per index. */
function groupIndexRows(rows: Array<{ name: string; col: string; unique: boolean; primary: boolean }>): IndexInfo[] {
  const byName = new Map<string, IndexInfo>()
  for (const r of rows) {
    const entry = byName.get(r.name)
    if (entry) entry.columns.push(r.col)
    else byName.set(r.name, { name: r.name, columns: [r.col], unique: r.unique, primary: r.primary })
  }
  return [...byName.values()]
}

/** pg `pg_constraint` action codes → SQL keywords. */
const PG_FK_ACTIONS: Record<string, string> = {
  a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT',
}

/** A table's outbound foreign keys, composite columns paired in order. */
export async function readForeignKeys(executor: Executor, dialect: Dialect, table: string): Promise<ForeignKeyInfo[]> {
  if (dialect.name === 'pg') {
    // information_schema can't pair composite-FK columns; unnest the conkey /
    // confkey arrays WITH ORDINALITY so columns[i] ↔ foreignColumns[i] holds.
    const rows = await executor.execute(
      `SELECT c.conname AS name, ft.relname AS foreign_table, ` +
      `(SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ` +
      ` JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols, ` +
      `(SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord) ` +
      ` JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS foreign_cols, ` +
      `c.confupdtype AS upd, c.confdeltype AS del ` +
      `FROM pg_constraint c ` +
      `JOIN pg_class t ON t.oid = c.conrelid ` +
      `JOIN pg_class ft ON ft.oid = c.confrelid ` +
      `JOIN pg_namespace n ON n.oid = t.relnamespace ` +
      `WHERE c.contype = 'f' AND t.relname = ${dialect.placeholder(0)} AND n.nspname = current_schema() ` +
      `ORDER BY c.conname`,
      [table],
    )
    return rows.map((r) => ({
      name:           String(r['name']),
      columns:        String(r['cols'] ?? '').split(',').filter(Boolean),
      foreignTable:   String(r['foreign_table']),
      foreignColumns: String(r['foreign_cols'] ?? '').split(',').filter(Boolean),
      onUpdate:       PG_FK_ACTIONS[String(r['upd'])] ?? null,
      onDelete:       PG_FK_ACTIONS[String(r['del'])] ?? null,
    }))
  }
  if (dialect.name === 'mysql') {
    const rows = await executor.execute(
      `SELECT kcu.constraint_name AS name, kcu.column_name AS col, ` +
      `kcu.referenced_table_name AS foreign_table, kcu.referenced_column_name AS foreign_col, ` +
      `rc.update_rule AS upd, rc.delete_rule AS del ` +
      `FROM information_schema.key_column_usage kcu ` +
      `JOIN information_schema.referential_constraints rc ` +
      `ON rc.constraint_schema = kcu.constraint_schema AND rc.constraint_name = kcu.constraint_name ` +
      `WHERE kcu.table_schema = DATABASE() AND kcu.table_name = ${dialect.placeholder(0)} ` +
      `AND kcu.referenced_table_name IS NOT NULL ` +
      `ORDER BY kcu.constraint_name, kcu.ordinal_position`,
      [table],
    )
    const byName = new Map<string, ForeignKeyInfo>()
    for (const r of rows) {
      const name  = String(r['name'] ?? r['NAME'] ?? r['CONSTRAINT_NAME'])
      const entry = byName.get(name)
      const col        = String(r['col'] ?? r['COL'] ?? r['COLUMN_NAME'])
      const foreignCol = String(r['foreign_col'] ?? r['FOREIGN_COL'] ?? r['REFERENCED_COLUMN_NAME'])
      if (entry) {
        entry.columns.push(col)
        entry.foreignColumns.push(foreignCol)
      } else {
        byName.set(name, {
          name,
          columns:        [col],
          foreignTable:   String(r['foreign_table'] ?? r['FOREIGN_TABLE'] ?? r['REFERENCED_TABLE_NAME']),
          foreignColumns: [foreignCol],
          onUpdate:       String(r['upd'] ?? r['UPD'] ?? r['UPDATE_RULE'] ?? '') || null,
          onDelete:       String(r['del'] ?? r['DEL'] ?? r['DELETE_RULE'] ?? '') || null,
        })
      }
    }
    return [...byName.values()]
  }

  // sqlite: PRAGMA rows are one-per-column-pair, grouped by `id`. `to` is null
  // when the FK references the parent's implicit primary key.
  const rows = await executor.execute(`PRAGMA foreign_key_list(${dialect.quoteId(table)})`, [])
  const byId = new Map<number, ForeignKeyInfo>()
  for (const r of rows) {
    const id    = Number(r['id'])
    const entry = byId.get(id)
    const col        = String(r['from'])
    const foreignCol = r['to'] == null ? null : String(r['to'])
    if (entry) {
      entry.columns.push(col)
      if (foreignCol !== null) entry.foreignColumns.push(foreignCol)
    } else {
      byId.set(id, {
        name:           null,
        columns:        [col],
        foreignTable:   String(r['table']),
        foreignColumns: foreignCol === null ? [] : [foreignCol],
        onUpdate:       String(r['on_update'] ?? '') || null,
        onDelete:       String(r['on_delete'] ?? '') || null,
      })
    }
  }
  return [...byId.values()]
}
