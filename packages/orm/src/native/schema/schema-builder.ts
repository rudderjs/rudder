// ─── SchemaBuilder (executor-bound) ────────────────────────
//
// Node-capable: the runtime entry point for the schema builder. Holds an
// {@link Executor} (a connection or a transaction scope) plus a {@link Dialect},
// compiles a {@link Blueprint} via the pure DDL compiler, and runs the resulting
// statements. This is what a migration's `up()` / `down()` drives — directly in
// 7.1, and behind the static `Schema` facade once the migration runner (7.2)
// binds a builder to the active connection.
//
// `hasTable` / `hasColumn` introspect the live database — SQLite via the
// PRAGMA/`sqlite_master` catalog, Postgres + MySQL via `information_schema`
// (scoped to `current_schema()` / `DATABASE()` respectively). They branch on
// `dialect.name`.

import type { Executor } from '../driver.js'
import type { Dialect } from '../dialect.js'
import { NativeNotImplementedError } from '../errors.js'
import { Blueprint } from './blueprint.js'
import { AlterBlueprint } from './alter-blueprint.js'
import { compileCreateTable, compileDropTable, compileAlterTable, compileRenameTable } from './ddl-compiler.js'
import { rebuildTable } from './rebuild.js'

export class SchemaBuilder {
  constructor(
    private readonly executor: Executor,
    private readonly dialect:  Dialect,
  ) {}

  /** `CREATE TABLE` (+ any indexes) from a `Blueprint` callback. */
  async create(table: string, build: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(table)
    build(blueprint)
    for (const stmt of compileCreateTable(blueprint, this.dialect)) {
      await this.executor.execute(stmt.sql, stmt.bindings)
    }
  }

  /** `ALTER TABLE` — add/drop/rename columns + add/drop indexes via a callback.
   *  A `.change()` (column type/constraint change) can't be done in place on
   *  SQLite, so it routes through the table-rebuild dance (7.4b) instead of a
   *  plain `ALTER`. */
  async table(table: string, build: (table: AlterBlueprint) => void): Promise<void> {
    const blueprint = new AlterBlueprint(table)
    build(blueprint)
    if (blueprint.columns.some(c => c.change)) {
      this.requireSqlite('Schema.table column change()')
      await rebuildTable(this.executor, this.dialect, blueprint)
      return
    }
    for (const stmt of compileAlterTable(blueprint, this.dialect)) {
      await this.executor.execute(stmt.sql, stmt.bindings)
    }
  }

  /** Rename a table. */
  async rename(from: string, to: string): Promise<void> {
    const stmt = compileRenameTable(from, to, this.dialect)
    await this.executor.execute(stmt.sql, stmt.bindings)
  }

  /** `DROP TABLE`. */
  async drop(table: string): Promise<void> {
    const stmt = compileDropTable(table, {}, this.dialect)
    await this.executor.execute(stmt.sql, stmt.bindings)
  }

  /** `DROP TABLE IF EXISTS`. */
  async dropIfExists(table: string): Promise<void> {
    const stmt = compileDropTable(table, { ifExists: true }, this.dialect)
    await this.executor.execute(stmt.sql, stmt.bindings)
  }

  /** Whether `table` exists (catalog lookup). */
  async hasTable(table: string): Promise<boolean> {
    const schemaFn = this.currentSchemaSql()
    if (schemaFn) {
      const rows = await this.executor.execute(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = ${schemaFn} AND table_name = ${this.dialect.placeholder(0)}`,
        [table],
      )
      return rows.length > 0
    }
    this.requireSqlite('hasTable')
    const rows = await this.executor.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [table],
    )
    return rows.length > 0
  }

  /** Whether `table` has a `column` (catalog lookup). */
  async hasColumn(table: string, column: string): Promise<boolean> {
    const schemaFn = this.currentSchemaSql()
    if (schemaFn) {
      const rows = await this.executor.execute(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = ${schemaFn} AND table_name = ${this.dialect.placeholder(0)} AND column_name = ${this.dialect.placeholder(1)}`,
        [table, column],
      )
      return rows.length > 0
    }
    this.requireSqlite('hasColumn')
    // PRAGMA takes an identifier, not a bound value — quote+validate the name.
    const rows = await this.executor.execute(`PRAGMA table_info(${this.dialect.quoteId(table)})`, [])
    return rows.some(r => r['name'] === column)
  }

  /** The SQL expression naming the active schema/database for dialects that
   *  introspect via `information_schema`, or `null` for the sqlite path. */
  private currentSchemaSql(): string | null {
    if (this.dialect.name === 'pg')    return 'current_schema()'
    if (this.dialect.name === 'mysql') return 'DATABASE()'
    return null
  }

  private requireSqlite(method: string): void {
    if (this.dialect.name !== 'sqlite') {
      throw new NativeNotImplementedError(`SchemaBuilder.${method} on the "${this.dialect.name}" dialect`, 'a later phase')
    }
  }
}
