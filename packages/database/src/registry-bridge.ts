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

import type { OrmAdapter, TransactionOptions } from '@rudderjs/contracts'

/**
 * Runs `fn` inside a database transaction, returning its result. Pushed in by
 * `@rudderjs/orm` (its `transaction()` free function) so `DB.transaction()` reuses
 * the ORM's `AsyncLocalStorage` transaction scoping — every `Model.*` AND `DB.*`
 * call inside `fn` joins the *same* open transaction (one connection, not two).
 * `@rudderjs/database` can't import `@rudderjs/orm`, so the runner is injected the
 * same way the adapter resolver is. `opts` (e.g. `isolationLevel`) flows through
 * to the adapter untouched.
 */
export type TransactionRunner = <T>(fn: () => Promise<T>, opts?: TransactionOptions) => Promise<T>

/**
 * Resolves the adapter for a NAMED connection (`DB.connection('reporting')`),
 * opening it lazily on first use. Pushed in by `@rudderjs/orm`'s `db-bridge`
 * (it closes over the ConnectionManager + the transaction-scope lookup, so a
 * `DB.connection(name).select()` inside a `transaction(fn, { connection:
 * name })` callback joins that open transaction). Async because the first
 * access may open the connection (driver import + connect).
 */
export type ConnectionResolver = (name: string) => Promise<OrmAdapter>

/** Runs `fn` inside a transaction on a NAMED connection — the named
 *  counterpart of {@link TransactionRunner}, same injection rationale. */
export type NamedTransactionRunner = <T>(name: string, fn: () => Promise<T>, opts?: TransactionOptions) => Promise<T>

let resolver: (() => OrmAdapter) | null = null
let txRunner: TransactionRunner | null = null
let connectionResolver: ConnectionResolver | null = null
let namedTxRunner: NamedTransactionRunner | null = null

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

/**
 * Register the function that resolves a named connection's adapter. Called by
 * `@rudderjs/orm`'s `db-bridge` module alongside {@link registerAdapterResolver}.
 * Idempotent — last registration wins (dev HMR re-boot re-installs it).
 */
export function registerConnectionResolver(fn: ConnectionResolver): void {
  connectionResolver = fn
}

/**
 * Resolve the named-connection resolver. Throws a clear error when none has
 * been registered — i.e. `@rudderjs/orm` (and a database provider) wasn't
 * loaded, or the installed `@rudderjs/orm` predates named-connection support.
 */
export function resolveConnectionResolver(): ConnectionResolver {
  if (!connectionResolver) {
    throw new Error(
      '[RudderJS DB] No connection resolver is available. DB.connection(name) ' +
        'resolves named connections through @rudderjs/orm — make sure a database ' +
        'provider is registered (and @rudderjs/orm installed) before calling ' +
        'DB.connection().',
    )
  }
  return connectionResolver
}

/**
 * Register the function that runs work inside a transaction on a named
 * connection. Called by `@rudderjs/orm`'s `db-bridge` module. Idempotent —
 * last registration wins.
 */
export function registerNamedTransactionRunner(fn: NamedTransactionRunner): void {
  namedTxRunner = fn
}

/** Resolve the named transaction runner. Throws a clear error when none has
 *  been registered. */
export function resolveNamedTransactionRunner(): NamedTransactionRunner {
  if (!namedTxRunner) {
    throw new Error(
      '[RudderJS DB] No named transaction runner is available. ' +
        'DB.connection(name).transaction() runs through @rudderjs/orm — make sure ' +
        'a database provider is registered (and @rudderjs/orm installed) first.',
    )
  }
  return namedTxRunner
}

/** @internal — test-only reset of the registered resolvers + transaction runners. */
export function __resetAdapterResolver(): void {
  resolver = null
  txRunner = null
  connectionResolver = null
  namedTxRunner = null
}
