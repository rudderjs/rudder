// ─── SQLite table rebuild (Schema.table column change()) ───
//
// Node-capable (runs via an {@link Executor}). SQLite can't change a column's
// type/constraints in place, so `t.<type>('col').change()` triggers the
// canonical 12-step rebuild: create a shadow table with the new column set, copy
// the data across, drop the original, rename the shadow into its place, then
// recreate the user indexes. This is the single biggest piece of `Schema.table`
// (parent plan Part 4) and the reason it's its own phase (7.4b).
//
// v1 scope — **`change()` must be the only operation in its `Schema.table` call.**
// Mixing it with add/drop/rename/index in one call throws; split those into a
// separate `table()` (the native-ALTER path handles them). That keeps the shadow
// reconstruction faithful: every non-changed column and the primary key are
// preserved exactly, only the changed columns' definitions are swapped, and all
// rows copy 1:1. Changing a primary-key column is rejected (the PK is preserved
// verbatim). Atomicity comes from the migrator's per-batch transaction (7.5);
// run standalone, the steps execute sequentially.

import type { Executor } from '../driver.js'
import type { Dialect } from '../dialect.js'
import { NativeOrmError } from '../errors.js'
import type { AlterBlueprint } from './alter-blueprint.js'
import { compileColumnSpec } from './ddl-compiler.js'
import { readColumns, readIndexSql, isAutoincrement, type RawColumn } from './introspect.js'

/** Render one preserved (introspected) column to its shadow-table spec. The
 *  single INTEGER rowid primary key is re-emitted inline (with AUTOINCREMENT
 *  when the original used it); everything else keeps its type/null/default. */
function preservedColumnSpec(col: RawColumn, dialect: Dialect, singleIntPk: boolean, auto: boolean): string {
  if (singleIntPk && col.pk === 1) {
    return `${dialect.quoteId(col.name)} INTEGER PRIMARY KEY${auto ? ' AUTOINCREMENT' : ''}`
  }
  const parts = [dialect.quoteId(col.name), col.type || 'TEXT']
  if (col.notNull) parts.push('NOT NULL')
  if (col.dflt !== null) parts.push(`DEFAULT ${col.dflt}`)
  return parts.join(' ')
}

/**
 * Rebuild `blueprint.table` applying its `change()` column definitions, via the
 * SQLite shadow-table dance. Assumes `change()` is the only op in the call (the
 * caller routes here only when a change is present; this re-checks and throws on
 * a mixed call).
 */
export async function rebuildTable(executor: Executor, dialect: Dialect, blueprint: AlterBlueprint): Promise<void> {
  const table   = blueprint.table
  const changes = blueprint.columns.filter(c => c.change)
  const others  = blueprint.columns.filter(c => !c.change)

  if (others.length || blueprint.droppedColumns.length || blueprint.renamedColumns.length || blueprint.indexes.length || blueprint.droppedIndexes.length) {
    throw new NativeOrmError(
      'NATIVE_DDL_CHANGE_COMBINED',
      `[RudderJS ORM native] change() must be the only operation in a Schema.table('${table}', …) call (v1). ` +
      `Move adds / drops / renames / index changes into a separate table() call.`,
    )
  }

  const current = await readColumns(executor, dialect, table)
  if (current.length === 0) {
    throw new NativeOrmError('NATIVE_DDL_NO_TABLE', `[RudderJS ORM native] Cannot alter "${table}" — it has no columns or does not exist.`)
  }
  const byName = new Map(current.map(c => [c.name, c]))

  const changeByName = new Map<string, typeof changes[number]>()
  for (const def of changes) {
    const existing = byName.get(def.name)
    if (!existing) {
      throw new NativeOrmError('NATIVE_DDL_CHANGE_MISSING', `[RudderJS ORM native] Cannot change column "${def.name}" — no such column on "${table}".`)
    }
    if (existing.pk > 0) {
      throw new NativeOrmError('NATIVE_DDL_CHANGE_PK', `[RudderJS ORM native] Changing a primary-key column ("${def.name}") is not supported.`)
    }
    if (def.primary || def.autoIncrement) {
      throw new NativeOrmError('NATIVE_DDL_CHANGE_TO_PK', `[RudderJS ORM native] change() cannot turn "${def.name}" into a primary key.`)
    }
    changeByName.set(def.name, def)
  }

  const auto       = await isAutoincrement(executor, table)
  const indexSqls  = await readIndexSql(executor, table)
  const pkCols     = current.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk)
  const singleIntPk = pkCols.length === 1 && (pkCols[0]?.type.toUpperCase() === 'INTEGER')

  // New column set: same order, changed columns swapped for their new spec.
  const colLines = current.map((col) => {
    const changed = changeByName.get(col.name)
    return changed ? compileColumnSpec(changed, dialect) : preservedColumnSpec(col, dialect, singleIntPk, auto)
  })
  if (pkCols.length && !singleIntPk) {
    colLines.push(`PRIMARY KEY (${pkCols.map(c => dialect.quoteId(c.name)).join(', ')})`)
  }

  const shadow   = `__rudder_new_${table}`
  const colNames = current.map(c => dialect.quoteId(c.name)).join(', ')

  // The rebuild dance. (No renames/drops in v1, so the shadow has the same
  // column names as the original — a straight 1:1 copy.)
  await executor.execute(`CREATE TABLE ${dialect.quoteId(shadow)} (\n  ${colLines.join(',\n  ')}\n)`, [])
  await executor.execute(`INSERT INTO ${dialect.quoteId(shadow)} (${colNames}) SELECT ${colNames} FROM ${dialect.quoteId(table)}`, [])
  await executor.execute(`DROP TABLE ${dialect.quoteId(table)}`, [])
  await executor.execute(`ALTER TABLE ${dialect.quoteId(shadow)} RENAME TO ${dialect.quoteId(table)}`, [])
  for (const sql of indexSqls) {
    await executor.execute(sql, [])
  }
}
