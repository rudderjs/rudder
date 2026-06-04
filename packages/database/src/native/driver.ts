// ─── Driver seam (per-platform) ────────────────────────────
//
// The `Driver` is the ONLY part of the native engine that differs across
// platforms. It executes already-compiled SQL + bindings and returns rows.
// The compiler and `NativeQueryBuilder` talk to the {@link Executor} interface
// and never to a concrete driver — so a React Native (`op-sqlite`/`expo-sqlite`)
// or browser (WASM) driver drops in later without touching the SQL layer.
//
// This module is PURE: type-only. No `node:` import, no I/O. Concrete drivers
// (e.g. `drivers/better-sqlite3.ts`) live in their own node-only modules and
// lazy-load their package.
//
// The model-independent execution types (`Row`, `Executor`, `Transaction`,
// `Connection`) are now owned by `@rudderjs/contracts` (the zero-dep foundation)
// and surfaced to apps via `@rudderjs/database`'s `DB` facade. They're re-exported
// here unchanged so every existing `./driver.js` import site keeps working — the
// native engine implements the same contract.

export type {
  Row, Executor, Transaction, Connection,
  TransactionOptions, TransactionIsolationLevel,
} from '@rudderjs/contracts'

import type { Connection } from '@rudderjs/contracts'

/** Result metadata for a write run through {@link AffectingExecutor}. */
export interface AffectingResult {
  /** The auto-increment id the write generated, or `null` when none (a
   *  non-auto-increment key, or an UPDATE/DELETE). */
  insertId:     number | null
  /** Rows the statement affected — the count callers return from
   *  `updateAll` / `deleteAll` and `DB.insert/update/delete`. */
  affectedRows: number
}

/**
 * A write-with-metadata escape hatch for dialects WITHOUT `RETURNING` (MySQL).
 * On SQLite/Postgres the engine reads written rows back via `RETURNING *`
 * (`Executor.execute`), so those drivers don't implement this. The MySQL driver
 * does: the query builder's no-RETURNING path reads `insertId` (for `create`)
 * and `affectedRows` (for `updateAll`/`deleteAll`) from here, then re-SELECTs by
 * primary key for terminals that must return the row. A native-only seam (not in
 * `@rudderjs/contracts`) — accessed by capability check, never on the read path.
 */
export interface AffectingExecutor {
  affectingExecute(sql: string, bindings: readonly unknown[]): Promise<AffectingResult>
}

/**
 * A database connection the native engine drives — the per-platform seam.
 * Structurally identical to the canonical {@link Connection}; the distinct name
 * marks the swappable driver boundary (better-sqlite3 / postgres / RN / WASM).
 *
 * `transaction()` (via `Connection`) was defined in Phase 2 so the write path
 * was transaction-aware by construction; Phase 4 wires the public
 * `Model.transaction()` API to it.
 */
export interface Driver extends Connection {
  /** Release the underlying connection/handle. Idempotent. */
  close(): Promise<void>
}
