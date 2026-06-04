// ─── @rudderjs/database/native ─────────────────────────────
//
// The native SQL engine — fully relocated from `@rudderjs/orm/native` by the
// Phase-2 extraction (docs/plans/2026-06-04-database-extraction-phase-2.md):
// compiler, dialects, driver seam, concrete drivers, `NativeQueryBuilder`,
// `NativeAdapter`, and the schema builder + migrator + type generator.
// `@rudderjs/orm/native` re-exports this barrel verbatim (back-compat shim),
// so every historical import keeps working; this subpath is the canonical
// home, and the headline API (`Migration`, `Schema`, `NativeAdapter`, the
// drivers) is also re-exported from the `@rudderjs/database` main entry.
//
// Node-only: the concrete drivers lazy-load `better-sqlite3` / `postgres` /
// `mysql2` (optional peers). Never import this from a client-bundle-reachable
// entry.
//
// NOTE: the framework provider (`NativeDatabaseProvider` / `nativeDatabase`)
// deliberately lives in `@rudderjs/orm` (`@rudderjs/orm/native/provider`) — it
// wires `ModelRegistry` / `ConnectionManager` / the DB-facade bridge, all
// orm-side state, and `@rudderjs/database` must never depend on `@rudderjs/orm`.
//
// Surface note: full star-exports per module. Engine seams consumed across the
// orm↔database boundary (the Model layer's engine suites, `quoteSqlString`,
// `makeBindings`, …) must NOT carry the JSDoc internal tag — `stripInternal`
// drops tagged declarations from the emitted d.ts and breaks the cross-package
// import. (tsc scans leading comments for the literal tag text, so even
// *mentioning* it spelled out here would strip the statement below.)

// Engine core.
export * from './errors.js'
export * from './driver.js'
export * from './isolation.js'
export * from './dialect.js'
export * from './dialect-pg.js'
export * from './dialect-mysql.js'
export * from './compiler.js'
export * from './query-builder.js'
export * from './adapter.js'
export * from './drivers/better-sqlite3.js'
export * from './drivers/postgres.js'
export * from './drivers/mysql.js'

// Schema builder (DDL), migration runner, and the schema → TS type generator.
export * from './schema/column.js'
export * from './schema/blueprint.js'
export * from './schema/alter-blueprint.js'
export * from './schema/ddl-compiler.js'
export * from './schema/schema-builder.js'
export * from './schema/rebuild.js'
export * from './schema/introspect.js'
export * from './schema/types-generator.js'
export * from './schema/schema-types.js'
export * from './schema/migration.js'
export * from './schema/schema-facade.js'
export * from './schema/migrator.js'
