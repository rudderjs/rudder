// ─── @rudderjs/orm/native ──────────────────────────────────
//
// Node-only subpath: the first-party SQL query engine that talks directly to
// better-sqlite3 (Phase 1 — SQLite read path), exposed alongside the optional
// @rudderjs/orm-prisma and @rudderjs/orm-drizzle adapters.
//
// IMPORTANT: this barrel is NEVER re-exported from the main `@rudderjs/orm`
// entry (src/index.ts). The main entry is client-bundle-reachable; this subpath
// imports a native driver and must stay out of any browser graph. The
// `Client Bundle Smoke` gate enforces it (cross-phase rule 5).

export { NativeAdapter, native } from './adapter.js'
export type { NativeConfig, NativeDriverName } from './adapter.js'
export { NativeQueryBuilder } from './query-builder.js'

// NOTE: the framework provider (`NativeDatabaseProvider` / `nativeDatabase`) is
// deliberately NOT re-exported here. It `extends ServiceProvider` from
// `@rudderjs/core` (an optional peer), so re-exporting it would make this engine
// barrel eagerly import `@rudderjs/core` — breaking a standalone-Node consumer
// that installs only `@rudderjs/orm` + a driver. It lives on its own subpath,
// `@rudderjs/orm/native/provider` (loaded via `rudderjs.providerSubpath`), so
// importing the engine never drags the framework in.

// Seams — exported so RN/browser drivers and alternate dialects can plug in.
export { SqliteDialect, validateIdentifier } from './dialect.js'
export type { Dialect } from './dialect.js'
export type { Driver, Executor, Transaction, Row } from './driver.js'
export { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
export type { BetterSqlite3DriverConfig } from './drivers/better-sqlite3.js'

// Compiler (pure) — exported for unit testing and advanced reuse.
export {
  compileSelect,
  compileCount,
  compileInsert,
  compileUpdate,
  compileIncrement,
  compileDelete,
  compileExists,
  compileAggregateSubselect,
  compileScalarAggregate,
  makeBindings,
} from './compiler.js'
export type { CompiledQuery, NativeQueryState, ConditionNode, Bindings } from './compiler.js'

// Schema builder (DDL) — Laravel-style `Blueprint` + per-dialect DDL compiler
// (7.1) plus the migration runner: `Migration` base, static `Schema` facade, and
// `Migrator` + `discoverMigrations` (7.2). SQLite only; pg/mysql in 7.7/7.8.
export { SchemaBuilder } from './schema/schema-builder.js'
export { Blueprint } from './schema/blueprint.js'
export { ColumnBuilder, makeColumn } from './schema/column.js'
export type { ColumnDefinition, ColumnType } from './schema/column.js'
export type { IndexDefinition } from './schema/blueprint.js'
export { compileCreateTable, compileDropTable } from './schema/ddl-compiler.js'
export { Migration } from './schema/migration.js'
export { Schema, withSchema } from './schema/schema-facade.js'
export { Migrator, discoverMigrations } from './schema/migrator.js'
export type { MigratorAdapter, LoadedMigration, MigrationStatus, RunResult } from './schema/migrator.js'

// Errors.
export {
  NativeOrmError,
  NativeNotImplementedError,
  NativeIdentifierError,
  NativeDriverError,
} from './errors.js'
