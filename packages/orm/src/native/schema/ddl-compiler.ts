// ─── DDL compiler (pure) ───────────────────────────────────
//
// PURE: turns a {@link Blueprint} into `CREATE TABLE` (+ `CREATE INDEX`)
// statements through a {@link Dialect}. No driver, no `node:`, no I/O — the
// portable half of the schema builder, the DDL counterpart to the read/write
// query compiler. The dialect owns per-flavor column *types*
// (`dialect.columnTypeSql`); this module owns statement *structure* (column
// lists, shared modifiers, table constraints, indexes) so it's identical across
// SQLite / Postgres / MySQL.
//
// Identifiers (table / column / index names) are validated + quoted by the
// dialect — the security gate (parent plan rule 2). DDL `DEFAULT` values are the
// one exception to "always bind": most databases reject bound parameters in DDL,
// so defaults are rendered as escaped literals. That's safe here because
// migration authors — not end users — write them.

import type { Dialect } from '../dialect.js'
import type { CompiledQuery } from '../compiler.js'
import { NativeOrmError, NativeNotImplementedError } from '../errors.js'
import type { Blueprint, IndexDefinition } from './blueprint.js'
import type { AlterBlueprint } from './alter-blueprint.js'
import type { ColumnDefinition } from './column.js'

/** Render a column's DEFAULT value as a SQL literal (DDL can't bind). Only the
 *  literal-able types are allowed; a Date/object/function default throws so the
 *  failure is at migrate time, not a silent `[object Object]` in the schema. */
function defaultLiteral(value: unknown): string {
  if (value === null) return 'NULL'
  switch (typeof value) {
    case 'boolean': return value ? '1' : '0'
    case 'bigint':  return value.toString()
    case 'number':
      if (!Number.isFinite(value)) {
        throw new NativeOrmError('NATIVE_DDL_BAD_DEFAULT', `[RudderJS ORM native] Non-finite numeric default ${String(value)} is not a valid column default.`)
      }
      return String(value)
    case 'string': return `'${value.replace(/'/g, "''")}'`
    default:
      throw new NativeOrmError(
        'NATIVE_DDL_BAD_DEFAULT',
        `[RudderJS ORM native] Unsupported column default of type "${typeof value}". ` +
        `Column defaults must be a string, number, bigint, boolean, or null ` +
        `(use \`useCurrent()\` for a timestamp default).`,
      )
  }
}

/** Render one column to its `CREATE TABLE` line (sans leading indent). */
function compileColumn(column: ColumnDefinition, dialect: Dialect, inlinePrimary: boolean): string {
  const parts = [dialect.quoteId(column.name), dialect.columnTypeSql(column)]

  // Auto-increment columns carry their full spec (incl. PRIMARY KEY) from the
  // dialect — appending NOT NULL / DEFAULT / PRIMARY KEY would be redundant or
  // invalid, so stop here.
  if (column.autoIncrement) return parts.join(' ')

  if (!column.nullable) parts.push('NOT NULL')

  if (column.useCurrent) {
    parts.push('DEFAULT CURRENT_TIMESTAMP')
  } else if (column.hasDefault) {
    parts.push(`DEFAULT ${defaultLiteral(column.default)}`)
  }

  if (inlinePrimary) parts.push('PRIMARY KEY')

  return parts.join(' ')
}

/** Default index name, Laravel-style: `{table}_{col[_col…]}_{index|unique}`. */
function indexName(table: string, idx: IndexDefinition): string {
  return idx.name ?? `${table}_${idx.columns.join('_')}_${idx.unique ? 'unique' : 'index'}`
}

/** Collect every index to create: table-level ones plus the per-column
 *  `.unique()` / `.index()` modifiers, normalized to {@link IndexDefinition}s. */
function collectIndexes(blueprint: Blueprint): IndexDefinition[] {
  const out: IndexDefinition[] = [...blueprint.indexes]
  for (const col of blueprint.columns) {
    if (col.unique) out.push({ columns: [col.name], unique: true })
    if (col.index)  out.push({ columns: [col.name], unique: false })
  }
  return out
}

/** `CREATE [UNIQUE] INDEX "name" ON "table" ("c1", …)` — shared by create + alter. */
function compileCreateIndex(table: string, idx: IndexDefinition, dialect: Dialect): CompiledQuery {
  return {
    sql:
      `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${dialect.quoteId(indexName(table, idx))} ` +
      `ON ${dialect.quoteId(table)} (${idx.columns.map(c => dialect.quoteId(c)).join(', ')})`,
    bindings: [],
  }
}

/**
 * Compile `Schema.create(...)` to a `CREATE TABLE` plus any `CREATE INDEX`
 * statements (in that order). Each is a {@link CompiledQuery} with empty
 * bindings — DDL carries no bound parameters.
 */
export function compileCreateTable(blueprint: Blueprint, dialect: Dialect): CompiledQuery[] {
  if (blueprint.columns.length === 0) {
    throw new NativeOrmError('NATIVE_DDL_EMPTY_TABLE', `[RudderJS ORM native] Cannot create table "${blueprint.table}" with no columns.`)
  }

  // Resolve the primary key. An explicit composite PK (Blueprint.primary) wins
  // and becomes a table constraint. Otherwise, column-level `.primary()` flags
  // (excluding the auto-increment column, which owns its own inline PK) become
  // an inline PK if there's exactly one, or a table constraint if several.
  const autoPk     = blueprint.columns.some(c => c.autoIncrement)
  const flagged    = blueprint.columns.filter(c => c.primary && !c.autoIncrement).map(c => c.name)
  let   tablePk: string[] | null = null
  let   inlinePk:  string | null = null
  if (blueprint.primaryColumns && !autoPk) {
    tablePk = blueprint.primaryColumns
  } else if (!autoPk && flagged.length === 1) {
    inlinePk = flagged[0] ?? null
  } else if (!autoPk && flagged.length > 1) {
    tablePk = flagged
  }

  const lines = blueprint.columns.map(c => `  ${compileColumn(c, dialect, c.name === inlinePk)}`)
  if (tablePk) {
    lines.push(`  PRIMARY KEY (${tablePk.map(c => dialect.quoteId(c)).join(', ')})`)
  }

  const create: CompiledQuery = {
    sql: `CREATE TABLE ${dialect.quoteId(blueprint.table)} (\n${lines.join(',\n')}\n)`,
    bindings: [],
  }

  const indexes = collectIndexes(blueprint).map(idx => compileCreateIndex(blueprint.table, idx, dialect))

  return [create, ...indexes]
}

/** Compile `Schema.drop(...)` / `Schema.dropIfExists(...)`. */
export function compileDropTable(table: string, opts: { ifExists?: boolean }, dialect: Dialect): CompiledQuery {
  return {
    sql: `DROP TABLE ${opts.ifExists ? 'IF EXISTS ' : ''}${dialect.quoteId(table)}`,
    bindings: [],
  }
}

/** Compile `Schema.rename(from, to)`. */
export function compileRenameTable(from: string, to: string, dialect: Dialect): CompiledQuery {
  return { sql: `ALTER TABLE ${dialect.quoteId(from)} RENAME TO ${dialect.quoteId(to)}`, bindings: [] }
}

/**
 * Compile `Schema.table(...)` to the `ALTER TABLE` / `CREATE INDEX` / `DROP
 * INDEX` statements its intents require, in dependency order: rename columns →
 * add columns → add indexes → drop indexes → drop columns. Each is emitted as a
 * separate statement (SQLite has no multi-clause `ALTER TABLE`).
 *
 * SQLite ADD COLUMN can't add a PRIMARY KEY column, and a NOT NULL column must
 * carry a default — both are rejected here with a clear message rather than
 * letting SQLite throw a cryptic one. Changing an existing column's type
 * (`.change()`) needs the table-rebuild dance and is deferred to 7.4b.
 */
export function compileAlterTable(blueprint: AlterBlueprint, dialect: Dialect): CompiledQuery[] {
  const t = dialect.quoteId(blueprint.table)
  const out: CompiledQuery[] = []

  // 1. Renames first, so any later op refers to the new name.
  for (const r of blueprint.renamedColumns) {
    out.push({ sql: `ALTER TABLE ${t} RENAME COLUMN ${dialect.quoteId(r.from)} TO ${dialect.quoteId(r.to)}`, bindings: [] })
  }

  // 2. Add columns (one ALTER ... ADD COLUMN each), with SQLite's restrictions.
  for (const col of blueprint.columns) {
    if (col.change) {
      throw new NativeNotImplementedError(`Schema.table column change() on "${blueprint.table}.${col.name}"`, 'a later phase (7.4b — the SQLite table-rebuild path)')
    }
    if (col.autoIncrement || col.primary) {
      throw new NativeOrmError('NATIVE_DDL_ADD_PRIMARY', `[RudderJS ORM native] Cannot ADD a primary-key column ("${col.name}") to an existing table on SQLite. Create the table with its primary key, or rebuild it.`)
    }
    if (!col.nullable && !col.hasDefault && !col.useCurrent) {
      throw new NativeOrmError('NATIVE_DDL_ADD_NOT_NULL', `[RudderJS ORM native] Adding a NOT NULL column ("${col.name}") to an existing table requires a default — chain \`.default(...)\` or \`.nullable()\`.`)
    }
    out.push({ sql: `ALTER TABLE ${t} ADD COLUMN ${compileColumn(col, dialect, false)}`, bindings: [] })
  }

  // 3. New indexes (table-level + per-column unique()/index() on added columns).
  for (const idx of collectIndexes(blueprint)) {
    out.push(compileCreateIndex(blueprint.table, idx, dialect))
  }

  // 4. Drop indexes (by name — independent of the table identifier on SQLite).
  for (const name of blueprint.droppedIndexes) {
    out.push({ sql: `DROP INDEX ${dialect.quoteId(name)}`, bindings: [] })
  }

  // 5. Drop columns last.
  for (const name of blueprint.droppedColumns) {
    out.push({ sql: `ALTER TABLE ${t} DROP COLUMN ${dialect.quoteId(name)}`, bindings: [] })
  }

  return out
}
