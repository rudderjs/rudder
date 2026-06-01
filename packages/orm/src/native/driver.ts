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

export type { Row, Executor, Transaction, Connection } from '@rudderjs/contracts'

import type { Connection } from '@rudderjs/contracts'

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
