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

/** A single result row — column name → value, as returned by the driver. */
export type Row = Record<string, unknown>

/**
 * Runs parameterized SQL and returns rows. This is the minimal surface the SQL
 * compiler / `NativeQueryBuilder` depend on — deliberately narrower than
 * {@link Driver}.
 *
 * The split exists for **transactions**: a transaction scope (Phase 4) hands the
 * inner work an `Executor` bound to the transaction's connection/handle, while
 * the top-level `Driver` is itself an `Executor` for non-transactional calls.
 * Because the query builder only ever needs `execute`, the *same* builder code
 * runs unchanged whether it's driving the top-level connection or a
 * transaction-scoped one — that's what makes the write path transaction-aware
 * today without exposing a public `transaction()` API yet.
 */
export interface Executor {
  /**
   * Run `sql` with positional `bindings` and resolve to the result rows.
   * SELECTs (and `... RETURNING *`) resolve to the matched/affected rows;
   * statements with no result set resolve to an empty array. Every value flows
   * through `bindings` (`?` / `$n` placeholders in `sql`) — the engine never
   * string-interpolates values into `sql`.
   */
  execute(sql: string, bindings: readonly unknown[]): Promise<Row[]>
}

/**
 * A database connection the native engine drives. Extends {@link Executor} with
 * connection lifecycle + a transaction scope.
 *
 * Async by contract even though `better-sqlite3` is synchronous — RN/WASM
 * drivers are async, and the ORM's terminals are already `Promise<T>`, so a
 * uniform async signature lets every driver implement it the natural way.
 */
export interface Driver extends Executor {
  /**
   * Run `fn` inside a database transaction, passing it an {@link Executor}
   * scoped to that transaction. Commits when `fn` resolves; rolls back and
   * re-throws if it rejects.
   *
   * Defined now (Phase 2) so the write path is transaction-aware by
   * construction — Phase 4 wires the public `transaction()` API to it without
   * touching the query builder. Not yet reachable from app code.
   */
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>

  /** Release the underlying connection/handle. Idempotent. */
  close(): Promise<void>
}
