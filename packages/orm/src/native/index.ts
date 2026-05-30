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

// Seams — exported so RN/browser drivers and alternate dialects can plug in.
export { SqliteDialect, validateIdentifier } from './dialect.js'
export type { Dialect } from './dialect.js'
export type { Driver, Row } from './driver.js'
export { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
export type { BetterSqlite3DriverConfig } from './drivers/better-sqlite3.js'

// Compiler (pure) — exported for unit testing and advanced reuse.
export { compileSelect, compileCount } from './compiler.js'
export type { CompiledQuery, NativeQueryState, ConditionNode } from './compiler.js'

// Errors.
export {
  NativeOrmError,
  NativeNotImplementedError,
  NativeIdentifierError,
  NativeDriverError,
} from './errors.js'
