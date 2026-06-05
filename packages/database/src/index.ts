// @rudderjs/database — the SQL data-layer foundation.
//
// The `DB` facade + registry bridge (Phase 1, #823) and — since the Phase-2
// relocation (docs/plans/2026-06-04-database-extraction-phase-2.md) — the
// native SQL engine's home. The full engine surface lives on the node-only
// `./native` subpath; the headline API apps touch (`Migration`, `Schema`,
// `NativeAdapter`, the drivers) is re-exported below so
// `import { Migration, Schema } from '@rudderjs/database'` is the canonical
// migration-file form going forward (`@rudderjs/orm/native` keeps working as a
// back-compat shim).

export { DB } from './db.js'
export type { DBConnection } from './db.js'
export { Expression, raw } from './expression.js'
export {
  registerAdapterResolver,
  resolveAdapter,
  registerTransactionRunner,
  resolveTransactionRunner,
  registerConnectionResolver,
  resolveConnectionResolver,
  registerNamedTransactionRunner,
  resolveNamedTransactionRunner,
  registerAfterCommitRunner,
  resolveAfterCommitRunner,
  __resetAdapterResolver,
} from './registry-bridge.js'
export type { TransactionRunner, ConnectionResolver, NamedTransactionRunner, AfterCommitRunner } from './registry-bridge.js'
export type { Row, Executor, Transaction, Connection } from './execution.js'
export type { QueryEvent, QueryListener } from '@rudderjs/contracts'

// ─── Native engine — headline API ──────────────────────────
// The full engine surface (compiler, dialects, schema internals, …) is on the
// `./native` subpath; these are the names apps write daily. Node-only — this
// main entry is not client-bundle-reachable (the orm-side `db-bridge` is only
// imported from adapter providers).
export { Migration } from './native/schema/migration.js'
export { Schema, withSchema } from './native/schema/schema-facade.js'
export { Migrator, discoverMigrations } from './native/schema/migrator.js'
export { SchemaBuilder } from './native/schema/schema-builder.js'
export { Blueprint } from './native/schema/blueprint.js'
export { NativeAdapter, native } from './native/adapter.js'
export type { NativeConfig, NativeDriverName } from './native/adapter.js'
export { BetterSqlite3Driver } from './native/drivers/better-sqlite3.js'
export { PostgresDriver } from './native/drivers/postgres.js'
export { MysqlDriver } from './native/drivers/mysql.js'
export type { Dialect } from './native/dialect.js'
export type { Driver } from './native/driver.js'
