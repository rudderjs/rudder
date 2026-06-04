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

// Engine core (compiler, dialects, driver seam, concrete drivers, query
// builder, errors, column definitions) — relocated to `@rudderjs/database`
// (Phase-2 PR-A2, docs/plans/2026-06-04-database-extraction-phase-2.md).
// Re-exported here so the `@rudderjs/orm/native` surface is unchanged; the
// adapter + schema builder below follow in PR-A3, after which this barrel
// becomes a pure shim of `@rudderjs/database/native`.

export { NativeAdapter, native } from './adapter.js'
export type { NativeConfig, NativeDriverName } from './adapter.js'
export { NativeQueryBuilder } from '@rudderjs/database/native'

// NOTE: the framework provider (`NativeDatabaseProvider` / `nativeDatabase`) is
// deliberately NOT re-exported here. It `extends ServiceProvider` from
// `@rudderjs/core` (an optional peer), so re-exporting it would make this engine
// barrel eagerly import `@rudderjs/core` — breaking a standalone-Node consumer
// that installs only `@rudderjs/orm` + a driver. It lives on its own subpath,
// `@rudderjs/orm/native/provider` (loaded via `rudderjs.providerSubpath`), so
// importing the engine never drags the framework in.

// Seams — exported so RN/browser drivers and alternate dialects can plug in.
export { SqliteDialect, validateIdentifier } from '@rudderjs/database/native'
export { PgDialect } from '@rudderjs/database/native'
export type { Dialect } from '@rudderjs/database/native'
export type { Driver, Executor, Transaction, Row } from '@rudderjs/database/native'
export { BetterSqlite3Driver } from '@rudderjs/database/native'
export type { BetterSqlite3DriverConfig } from '@rudderjs/database/native'
export { PostgresDriver } from '@rudderjs/database/native'
export type { PostgresDriverConfig } from '@rudderjs/database/native'

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
} from '@rudderjs/database/native'
export type { CompiledQuery, NativeQueryState, ConditionNode, Bindings } from '@rudderjs/database/native'

// Schema builder (DDL) — Laravel-style `Blueprint` + per-dialect DDL compiler
// (7.1) plus the migration runner: `Migration` base, static `Schema` facade, and
// `Migrator` + `discoverMigrations` (7.2). SQLite only; pg/mysql in 7.7/7.8.
export { SchemaBuilder } from './schema/schema-builder.js'
export { Blueprint } from './schema/blueprint.js'
export { AlterBlueprint } from './schema/alter-blueprint.js'
export type { RenameColumn } from './schema/alter-blueprint.js'
export { ColumnBuilder, makeColumn } from '@rudderjs/database/native'
export type { ColumnDefinition, ColumnType } from '@rudderjs/database/native'
export type { IndexDefinition } from './schema/blueprint.js'
export { compileCreateTable, compileDropTable, compileAlterTable, compileRenameTable, compileColumnSpec } from './schema/ddl-compiler.js'
export { rebuildTable } from './schema/rebuild.js'
export { readColumns, readIndexSql, isAutoincrement, readTables } from './schema/introspect.js'
export type { RawColumn } from './schema/introspect.js'
// Schema → TypeScript types generator (GATE 7-types).
export { sqliteTypeToTs, pgTypeToTs, castToTs, resolveColumnType, buildTableTypes, emitRegistryDts } from './schema/types-generator.js'
export type { GeneratedColumnType, TableTypes } from './schema/types-generator.js'
export { collectSchemaTypes, generateSchemaTypes, registryDtsPath } from './schema/schema-types.js'
export type { ModelCastInfo } from './schema/schema-types.js'
export { Migration } from './schema/migration.js'
export { Schema, withSchema } from './schema/schema-facade.js'
export { Migrator, discoverMigrations } from './schema/migrator.js'
export type {
  MigratorAdapter, LoadedMigration, MigrationStatus,
  RunResult, RunOptions, RollbackResult, RollbackOptions, PretendedMigration,
} from './schema/migrator.js'

// Errors.
export {
  NativeOrmError,
  NativeNotImplementedError,
  NativeIdentifierError,
  NativeDriverError,
} from '@rudderjs/database/native'
