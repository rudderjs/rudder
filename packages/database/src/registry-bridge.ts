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

let resolver: (() => OrmAdapter) | null = null

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

/** @internal — test-only reset of the registered resolver. */
export function __resetAdapterResolver(): void {
  resolver = null
}
