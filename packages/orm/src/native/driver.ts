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
 * A transaction scope: an {@link Executor} that can itself open a *nested*
 * transaction (mapped to a SAVEPOINT). This is what `transaction()` hands its
 * callback — the inner work executes on the scope, and a nested
 * `scope.transaction(...)` rolls back only its own savepoint on failure,
 * leaving the outer transaction intact.
 *
 * The query builder only needs {@link Executor}, so it runs unchanged whether
 * driving the top-level connection or a transaction scope. Nesting support
 * lives here (not on the bare `Executor`) so `Model.transaction()` can be called
 * recursively and map to savepoints.
 */
export interface Transaction extends Executor {
  /**
   * Open a nested transaction (SAVEPOINT) on this scope. Commits/releases when
   * `fn` resolves; rolls back to the savepoint and re-throws if it rejects.
   */
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
}

/**
 * A database connection the native engine drives. A {@link Transaction} (so it
 * can open a top-level transaction) plus connection lifecycle.
 *
 * Async by contract even though `better-sqlite3` is synchronous — RN/WASM
 * drivers are async, and the ORM's terminals are already `Promise<T>`, so a
 * uniform async signature lets every driver implement it the natural way.
 *
 * `transaction()` was defined in Phase 2 so the write path was transaction-aware
 * by construction; Phase 4 wires the public `Model.transaction()` API to it.
 */
export interface Driver extends Transaction {
  /** Release the underlying connection/handle. Idempotent. */
  close(): Promise<void>
}
