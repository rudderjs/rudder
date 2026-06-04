// ─── @rudderjs/database/native ─────────────────────────────
//
// The native SQL engine's home since the Phase-2 relocation
// (docs/plans/2026-06-04-database-extraction-phase-2.md). This subpath holds
// the engine internals that moved out of `@rudderjs/orm/native` — the compiler,
// dialects, driver seam, concrete drivers, `NativeQueryBuilder`, and (as the
// relocation completes in PR-A3) the adapter + schema builder. `@rudderjs/orm`'s
// `./native` subpath re-exports this barrel, so every historical import keeps
// working; new code should import from here.
//
// Node-only: the concrete drivers lazy-load `better-sqlite3` / `postgres` /
// `mysql2` (optional peers). Never import this from a client-bundle-reachable
// entry.
//
// PR-A2 (transitional): full star-exports per moved module — `@rudderjs/orm`'s
// remaining engine files (adapter, schema builder) and the Model-coupled test
// suites import internals (`quoteSqlString`, `normalizeForeignKeyAction`,
// `AffectingExecutor`, …) that the curated orm barrel never surfaced. PR-A3
// finishes the move and curates the public surface.

export * from './errors.js'
export * from './driver.js'
export * from './dialect.js'
export * from './dialect-pg.js'
export * from './dialect-mysql.js'
export * from './compiler.js'
export * from './query-builder.js'
export * from './drivers/better-sqlite3.js'
export * from './drivers/postgres.js'
export * from './drivers/mysql.js'
export * from './schema/column.js'
