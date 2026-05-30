// ─── Driver seam (per-platform) ────────────────────────────
//
// The `Driver` is the ONLY part of the native engine that differs across
// platforms. It executes already-compiled SQL + bindings and returns rows.
// The compiler and `NativeQueryBuilder` talk to this interface and never to a
// concrete driver — so a React Native (`op-sqlite`/`expo-sqlite`) or browser
// (WASM) driver drops in later without touching the SQL layer.
//
// This module is PURE: type-only. No `node:` import, no I/O. Concrete drivers
// (e.g. `drivers/better-sqlite3.ts`) live in their own node-only modules and
// lazy-load their package.

/** A single result row — column name → value, as returned by the driver. */
export type Row = Record<string, unknown>

/**
 * Executes parameterized SQL against the underlying database.
 *
 * Every value flows through `bindings` (`?` / `$n` placeholders in `sql`) —
 * the engine never string-interpolates values into `sql`. `execute` is the
 * single I/O primitive the read path needs; the write path (Phase 2) reuses
 * the same shape.
 *
 * Async by contract even though `better-sqlite3` is synchronous — RN/WASM
 * drivers are async, and the ORM's terminals are already `Promise<T>`, so a
 * uniform async signature lets every driver implement it the natural way.
 */
export interface Driver {
  /**
   * Run `sql` with positional `bindings` and resolve to the result rows.
   * SELECTs resolve to the matched rows; statements with no result set
   * (Phase 2+) resolve to an empty array.
   */
  execute(sql: string, bindings: readonly unknown[]): Promise<Row[]>

  /** Release the underlying connection/handle. Idempotent. */
  close(): Promise<void>
}
