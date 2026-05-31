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
import { NativeOrmError } from '../errors.js'
import type { Blueprint, IndexDefinition } from './blueprint.js'
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

  const indexes = collectIndexes(blueprint).map<CompiledQuery>(idx => ({
    sql:
      `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${dialect.quoteId(indexName(blueprint.table, idx))} ` +
      `ON ${dialect.quoteId(blueprint.table)} (${idx.columns.map(c => dialect.quoteId(c)).join(', ')})`,
    bindings: [],
  }))

  return [create, ...indexes]
}

/** Compile `Schema.drop(...)` / `Schema.dropIfExists(...)`. */
export function compileDropTable(table: string, opts: { ifExists?: boolean }, dialect: Dialect): CompiledQuery {
  return {
    sql: `DROP TABLE ${opts.ifExists ? 'IF EXISTS ' : ''}${dialect.quoteId(table)}`,
    bindings: [],
  }
}
