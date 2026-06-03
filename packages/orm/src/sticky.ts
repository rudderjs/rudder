// ─── Sticky-read scope for read/write-split connections ────
//
// Laravel parity: with `sticky: true` on a split connection, a read issued
// AFTER a write *within the same request cycle* routes to the write
// connection — the just-written row may not have replicated yet. The "request
// cycle" is an AsyncLocalStorage scope entered per request by
// {@link databaseContextMiddleware} (the native provider appends it to both
// the `web` and `api` groups when a sticky split connection is configured).
//
// Outside a scope (queue jobs, rudder commands, scripts) the flag is a no-op
// and reads go to the replicas. That divergence is deliberate: Laravel's
// per-connection `$recordsModified` flag resets per request because PHP's
// process dies with the request — a long-lived Node process would otherwise
// go sticky-forever after its first write.
//
// Node-only module (top-level `node:async_hooks` import) — exported via the
// `@rudderjs/orm/sticky` subpath, NEVER re-exported from the main entry (the
// main entry is client-bundle-reachable).

import { AsyncLocalStorage } from 'node:async_hooks'
import type { MiddlewareHandler } from '@rudderjs/contracts'

// Shared via globalThis for the same dual-load reason as the ORM registry:
// the adapter package and a bundled copy of @rudderjs/orm must see one scope.
const STICKY_KEY = '__rudderjs_orm_sticky__'
const _g = globalThis as Record<string, unknown>
if (!_g[STICKY_KEY]) {
  _g[STICKY_KEY] = new AsyncLocalStorage<Set<string>>()
}
const _als = _g[STICKY_KEY] as AsyncLocalStorage<Set<string>>

/** Run `fn` inside a fresh database context — the unit sticky reads scope to.
 *  The middleware wraps each request in one; wrap queue-job/command bodies
 *  manually if they need read-your-writes on a sticky connection. */
export function runWithDatabaseContext<T>(fn: () => T): T {
  return _als.run(new Set(), fn)
}

/** Whether a database context (request scope) is active. */
export function hasDatabaseContext(): boolean {
  return _als.getStore() !== undefined
}

/** Record that `connection` performed a write in the current context.
 *  No-op outside a context. Called by split adapters' write paths. */
export function markWrote(connection: string): void {
  _als.getStore()?.add(connection)
}

/** Whether `connection` wrote in the current context — when true (and the
 *  connection is `sticky`), reads route to the write connection. Always
 *  `false` outside a context. */
export function stickyWrote(connection: string): boolean {
  return _als.getStore()?.has(connection) ?? false
}

/**
 * Request middleware entering a database context, so sticky reads scope to
 * the request. Auto-installed on the `web` + `api` groups by the native
 * provider when any configured connection sets `sticky: true` with a `read`
 * pool; harmless to install twice (an inner scope simply shadows the outer).
 */
export function databaseContextMiddleware(): MiddlewareHandler {
  return (_req, _res, next) => runWithDatabaseContext(() => next())
}
