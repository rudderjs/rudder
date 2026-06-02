// ─── Adapter-resolver bridge (orm → database) ──────────────
//
// `@rudderjs/database` must NOT import `@rudderjs/orm` (the dependency direction
// is orm → database). But the DB facade needs the *same* active adapter the
// Models use — opening a second connection would violate the one-connection
// rule. So `@rudderjs/orm` PUSHES its `ModelRegistry.getAdapter` accessor into
// this module via {@link registerAdapterResolver}; the facade pulls it via
// {@link resolveAdapter}.
//
// Resolving through the accessor (not a cached adapter) means `DB.*` inside a
// `Model.transaction()` callback transparently joins the open transaction —
// `ModelRegistry.getAdapter()` already returns the transaction-scoped adapter.

import type { OrmAdapter } from '@rudderjs/contracts'

/**
 * Runs `fn` inside a database transaction, returning its result. Pushed in by
 * `@rudderjs/orm` (its `transaction()` free function) so `DB.transaction()` reuses
 * the ORM's `AsyncLocalStorage` transaction scoping — every `Model.*` AND `DB.*`
 * call inside `fn` joins the *same* open transaction (one connection, not two).
 * `@rudderjs/database` can't import `@rudderjs/orm`, so the runner is injected the
 * same way the adapter resolver is.
 */
export type TransactionRunner = <T>(fn: () => Promise<T>) => Promise<T>

let resolver: (() => OrmAdapter) | null = null
let txRunner: TransactionRunner | null = null

/**
 * Register the function that resolves the active ORM adapter. Called once by
 * `@rudderjs/orm`'s `db-bridge` module (imported for side effect from each
 * adapter provider). Idempotent — the last registration wins, which matches a
 * dev HMR re-boot re-installing the same accessor.
 */
export function registerAdapterResolver(fn: () => OrmAdapter): void {
  resolver = fn
}

/**
 * Resolve the active ORM adapter. Throws a clear error when no resolver has been
 * registered — i.e. `@rudderjs/orm` (and a database provider) wasn't loaded, so
 * there is no adapter for the DB facade to run against.
 */
export function resolveAdapter(): OrmAdapter {
  if (!resolver) {
    throw new Error(
      '[RudderJS DB] No ORM adapter is available. The DB facade resolves the ' +
        'active adapter from @rudderjs/orm — make sure a database provider is ' +
        'registered (and @rudderjs/orm installed) before calling DB.*',
    )
  }
  return resolver()
}

/**
 * Register the function that runs work inside a transaction. Called by
 * `@rudderjs/orm`'s `db-bridge` module alongside {@link registerAdapterResolver},
 * passing the ORM's `transaction()` free function (which owns the ALS scoping).
 * Idempotent — last registration wins (a dev HMR re-boot re-installs the same fn).
 */
export function registerTransactionRunner(fn: TransactionRunner): void {
  txRunner = fn
}

/**
 * Resolve the active transaction runner. Throws a clear error when none has been
 * registered — i.e. `@rudderjs/orm` (and a database provider) wasn't loaded.
 */
export function resolveTransactionRunner(): TransactionRunner {
  if (!txRunner) {
    throw new Error(
      '[RudderJS DB] No transaction runner is available. DB.transaction() runs ' +
        'through @rudderjs/orm — make sure a database provider is registered (and ' +
        '@rudderjs/orm installed) before calling DB.transaction().',
    )
  }
  return txRunner
}

/** @internal — test-only reset of the registered resolver + transaction runner. */
export function __resetAdapterResolver(): void {
  resolver = null
  txRunner = null
}
