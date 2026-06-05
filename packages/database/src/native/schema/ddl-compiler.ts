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

import { Expression } from '@rudderjs/contracts'
import { quoteSqlString, type Dialect } from '../dialect.js'
import type { CompiledQuery } from '../compiler.js'
import { NativeOrmError, NativeNotImplementedError } from '../errors.js'
import type { Blueprint, IndexDefinition } from './blueprint.js'
import type { AlterBlueprint } from './alter-blueprint.js'
import type { ColumnDefinition, ForeignKeyAction, ForeignKeyDefinition } from './column.js'

/** Render a column's DEFAULT value as a SQL literal (DDL can't bind). Only the
 *  literal-able types are allowed; a Date/object/function default throws so the
 *  failure is at migrate time, not a silent `[object Object]` in the schema. An
 *  `Expression` (`raw('…')`) is spliced verbatim — the escape hatch for function
 *  defaults like `raw('gen_random_uuid()')`. */
function defaultLiteral(value: unknown, dialect: Dialect): string {
  if (value === null) return 'NULL'
  // raw(...) default — splice the literal fragment, no quoting (it carries no
  // bindings; DDL can't bind anyway).
  if (value instanceof Expression) return String(value.getValue())
  switch (typeof value) {
    case 'boolean': return dialect.booleanLiteral(value)
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
    parts.push(`DEFAULT ${defaultLiteral(column.default, dialect)}`)
  }

  // `ON UPDATE CURRENT_TIMESTAMP` is MySQL-only grammar; pg/sqlite have no inline
  // form, so the modifier is silently dropped there (Laravel does the same).
  if (dialect.name === 'mysql' && column.useCurrentOnUpdate) parts.push('ON UPDATE CURRENT_TIMESTAMP')

  if (inlinePrimary) parts.push('PRIMARY KEY')

  // MySQL takes an inline column COMMENT (last). pg comments out-of-line (a
  // separate COMMENT ON COLUMN statement, emitted by the table compiler); sqlite
  // has no column comments at all.
  if (dialect.name === 'mysql' && column.comment !== undefined) parts.push(`COMMENT ${quoteSqlString(column.comment)}`)

  return parts.join(' ')
}

/** Postgres `COMMENT ON COLUMN "table"."col" IS '…'` statement for a column that
 *  carries a `.comment(...)`, or null when the dialect comments inline (mysql) or
 *  not at all (sqlite), or the column has no comment. */
function compileColumnComment(table: string, column: ColumnDefinition, dialect: Dialect): CompiledQuery | null {
  if (dialect.name !== 'pg' || column.comment === undefined) return null
  return {
    sql: `COMMENT ON COLUMN ${dialect.quoteId(table)}.${dialect.quoteId(column.name)} IS ${quoteSqlString(column.comment)}`,
    bindings: [],
  }
}

/** A column's `"name" TYPE [NOT NULL] [DEFAULT …]` spec, no inline primary key.
 *  Exported for the table-rebuild path (7.4b), which assembles a shadow
 *  `CREATE TABLE` from a mix of changed columns and preserved (introspected) ones. */
export function compileColumnSpec(column: ColumnDefinition, dialect: Dialect): string {
  return compileColumn(column, dialect, false)
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

/** Default FK constraint name, Laravel-style: `{table}_{col[_col…]}_foreign`. */
function foreignKeyName(table: string, fk: ForeignKeyDefinition): string {
  return fk.name ?? `${table}_${fk.columns.join('_')}_foreign`
}

/** Render a normalized referential action to its SQL keyword (`set null` →
 *  `SET NULL`). The value is allowlisted at record time, so this is a pure map. */
function foreignKeyActionSql(action: ForeignKeyAction): string {
  return action.toUpperCase()
}

/** Collect every foreign key to emit: per-column `constrained()` intents plus
 *  table-level `foreign()` ones, in declaration order (columns first). */
function collectForeignKeys(blueprint: Blueprint): ForeignKeyDefinition[] {
  const out: ForeignKeyDefinition[] = []
  for (const col of blueprint.columns) {
    if (col.foreignKey) out.push(col.foreignKey)
  }
  out.push(...blueprint.foreignKeys)
  return out
}

/** Render one FK as a `CONSTRAINT … FOREIGN KEY (…) REFERENCES "tbl" (…)
 *  [ON DELETE …] [ON UPDATE …]` table-constraint line. Every identifier is
 *  quoted+validated via the dialect; the referenced table/columns must be set. */
function compileForeignKey(table: string, fk: ForeignKeyDefinition, dialect: Dialect): string {
  if (!fk.on) {
    throw new NativeOrmError(
      'NATIVE_DDL_FK_NO_TABLE',
      `[RudderJS ORM native] Foreign key on (${fk.columns.join(', ')}) in "${table}" is missing its ` +
      `referenced table — call \`.on('<table>')\` or use \`.constrained()\`.`,
    )
  }
  if (fk.references.length === 0) {
    throw new NativeOrmError(
      'NATIVE_DDL_FK_NO_REFERENCES',
      `[RudderJS ORM native] Foreign key on (${fk.columns.join(', ')}) in "${table}" references no ` +
      `columns — call \`.references('<column>')\` (defaults to "id" via \`.constrained()\`).`,
    )
  }
  const cols    = fk.columns.map(c => dialect.quoteId(c)).join(', ')
  const refCols = fk.references.map(c => dialect.quoteId(c)).join(', ')
  let sql =
    `CONSTRAINT ${dialect.quoteId(foreignKeyName(table, fk))} ` +
    `FOREIGN KEY (${cols}) REFERENCES ${dialect.quoteId(fk.on)} (${refCols})`
  if (fk.onDelete) sql += ` ON DELETE ${foreignKeyActionSql(fk.onDelete)}`
  if (fk.onUpdate) sql += ` ON UPDATE ${foreignKeyActionSql(fk.onUpdate)}`
  return sql
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
  // Foreign keys come after the column lines / primary key, as table constraints.
  for (const fk of collectForeignKeys(blueprint)) {
    lines.push(`  ${compileForeignKey(blueprint.table, fk, dialect)}`)
  }

  const create: CompiledQuery = {
    sql: `CREATE TABLE ${dialect.quoteId(blueprint.table)} (\n${lines.join(',\n')}\n)`,
    bindings: [],
  }

  const indexes = collectIndexes(blueprint).map(idx => compileCreateIndex(blueprint.table, idx, dialect))

  // Postgres column comments are separate statements (pg has no inline COMMENT).
  const comments = blueprint.columns
    .map(c => compileColumnComment(blueprint.table, c, dialect))
    .filter((c): c is CompiledQuery => c !== null)

  return [create, ...indexes, ...comments]
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

  // SQLite can neither ADD nor DROP a foreign key in place (no such ALTER form),
  // so reject any FK touched on an existing table with a pointer to the
  // supported paths. (FK-on-alter via the table-rebuild dance is a follow-up.)
  if (dialect.name === 'sqlite') {
    const addsFk = blueprint.foreignKeys.length > 0 || blueprint.columns.some(c => c.foreignKey)
    if (addsFk) {
      throw new NativeNotImplementedError(
        `Schema.table foreign key add on "${blueprint.table}" (SQLite)`,
        'a later phase — SQLite can\'t ADD a foreign key in place; create the table with the FK, or use a column change()/rebuild',
      )
    }
    if (blueprint.droppedForeignKeys.length > 0) {
      throw new NativeNotImplementedError(
        `Schema.table dropForeign on "${blueprint.table}" (SQLite)`,
        'a later phase — SQLite can\'t DROP a foreign key in place; recreate the table without the FK, or use a column change()/rebuild',
      )
    }
  }

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
    let addSql = `ALTER TABLE ${t} ADD COLUMN ${compileColumn(col, dialect, false)}`
    // Positional ADD (MySQL only): FIRST wins over AFTER. pg/sqlite have no
    // positional ADD COLUMN, so these are silently ignored there (Laravel too).
    if (dialect.name === 'mysql') {
      if (col.first)      addSql += ' FIRST'
      else if (col.after) addSql += ` AFTER ${dialect.quoteId(col.after)}`
    }
    out.push({ sql: addSql, bindings: [] })
    // pg out-of-line comment for the added column.
    const comment = compileColumnComment(blueprint.table, col, dialect)
    if (comment) out.push(comment)
  }

  // 3. New indexes (table-level + per-column unique()/index() on added columns).
  for (const idx of collectIndexes(blueprint)) {
    out.push(compileCreateIndex(blueprint.table, idx, dialect))
  }

  // 3b. New foreign keys (pg/mysql only — the sqlite guard above already
  // rejected them): `ADD CONSTRAINT … FOREIGN KEY … REFERENCES …`, reusing
  // the create-table constraint renderer. Historically these were silently
  // dropped on alter — a migration "succeeded" without its FK.
  if (dialect.name !== 'sqlite') {
    for (const fk of collectForeignKeys(blueprint)) {
      out.push({ sql: `ALTER TABLE ${t} ADD ${compileForeignKey(blueprint.table, fk, dialect)}`, bindings: [] })
    }
    // Dropped FKs — by constraint name, or by the column list they cover
    // (derived via the same default-name convention used at creation).
    // mysql spells it DROP FOREIGN KEY; pg DROP CONSTRAINT.
    for (const dropped of blueprint.droppedForeignKeys) {
      const name = typeof dropped === 'string'
        ? dropped
        : `${blueprint.table}_${dropped.join('_')}_foreign`
      const clause = dialect.name === 'mysql' ? 'DROP FOREIGN KEY' : 'DROP CONSTRAINT'
      out.push({ sql: `ALTER TABLE ${t} ${clause} ${dialect.quoteId(name)}`, bindings: [] })
    }
  }

  // 4. Drop indexes (by name). SQLite and pg address an index as a standalone
  // schema object; MySQL scopes it to its table (`DROP INDEX … ON <table>`).
  for (const name of blueprint.droppedIndexes) {
    const onTable = dialect.name === 'mysql' ? ` ON ${t}` : ''
    out.push({ sql: `DROP INDEX ${dialect.quoteId(name)}${onTable}`, bindings: [] })
  }

  // 5. Drop columns last.
  for (const name of blueprint.droppedColumns) {
    out.push({ sql: `ALTER TABLE ${t} DROP COLUMN ${dialect.quoteId(name)}`, bindings: [] })
  }

  return out
}
