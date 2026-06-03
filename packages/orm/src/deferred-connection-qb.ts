// ─── Deferred query builder for lazily-opened named connections ──
//
// `Model.query()` obtains its adapter QueryBuilder SYNCHRONOUSLY, but a named
// connection (`static connection` / `Model.on('reporting')`) only materializes
// via `await ConnectionManager.ensure(name)` — the open may import a driver
// package and connect. This bridges the gap with record-and-replay:
//
//   - Before the first terminal, every method call is QUEUED (chainables on
//     the adapter-QB contract all return `this`, so the recorder just returns
//     itself) — no adapter needed yet.
//   - The first TERMINAL (`get`/`first`/`create`/…, all Promise-returning)
//     awaits the connection, builds the real adapter QB, replays the queue in
//     call order, memoizes the real QB, and runs the terminal on it.
//   - After materialization the proxy is a thin forwarder — stateful
//     interaction patterns (the Model layer's `chunk`/`lazy` mutate
//     `limit`/`offset` between `get()` passes) hit the real builder directly.
//
// Only the FIRST query per process on a connection pays the recorder: once
// `ensure()` has memoized the adapter, `ConnectionManager.peek()` hits in the
// Model layer and queries build directly on the real adapter QB.
//
// Client-bundle safe: no `node:` imports, no `process.env`.

import type { OrmAdapter, OrmAdapterQueryOpts, QueryBuilder } from '@rudderjs/contracts'

/** Promise-returning members of the adapter `QueryBuilder` contract — the
 *  points where the connection must actually exist. Everything else on the
 *  contract returns `this` and is safely recordable. (Model-layer sugar like
 *  `pluck`/`chunk`/`whereIn` lives ABOVE this builder in the hydrating proxy
 *  and composes these primitives, so it needs no entries here.) */
const TERMINALS = new Set<PropertyKey>([
  'first', 'find', 'get', 'all', 'count', 'paginate',
  'create', 'update', 'delete', 'insertMany', 'upsert',
  'deleteAll', 'updateAll', 'restore', 'forceDelete',
  'increment', 'decrement', '_aggregate',
])

/**
 * Build a `QueryBuilder` for a connection that may not be open yet.
 *
 * @param ensure resolves the connection's adapter, opening it on first use
 *   (single-flighted by the ConnectionManager).
 *
 * Known limits (both self-diagnosing, not silent):
 * - A recorded method missing on the materialized adapter QB throws a clear
 *   error naming the method and adapter (e.g. builder-SQL methods recorded
 *   against a connection whose adapter doesn't implement them).
 * - `union()` members must come from an already-open connection — a deferred
 *   member fails the native engine's "members must be native builders" check.
 */
export function deferredQuery<T>(
  ensure: () => Promise<OrmAdapter>,
  table: string,
  opts?: OrmAdapterQueryOpts,
): QueryBuilder<T> {
  const queued: Array<{ method: PropertyKey; args: unknown[] }> = []
  let real: QueryBuilder<T> | null = null
  let materializing: Promise<QueryBuilder<T>> | null = null

  const materialize = (): Promise<QueryBuilder<T>> => {
    if (materializing) return materializing
    materializing = ensure().then((adapter) => {
      const qb = adapter.query<T>(table, opts)
      for (const { method, args } of queued) {
        const fn = (qb as unknown as Record<PropertyKey, unknown>)[method]
        if (typeof fn !== 'function') {
          throw new Error(
            `[RudderJS ORM] ${String(method)}() was queued against a deferred connection, but ` +
              `${adapter.constructor?.name ?? 'the adapter'} for this connection does not implement it.`,
          )
        }
        ;(fn as (...a: unknown[]) => unknown).apply(qb, args)
      }
      queued.length = 0
      real = qb
      return qb
    })
    // A failed open must not wedge the builder — let a retry re-materialize.
    materializing = materializing.catch((err: unknown) => {
      materializing = null
      throw err
    })
    return materializing
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxy: any = new Proxy(Object.create(null), {
    get(_target, prop) {
      // Already materialized → thin forwarder; chainables keep returning the
      // proxy so caller-held references stay valid.
      if (real) {
        const value = (real as unknown as Record<PropertyKey, unknown>)[prop]
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(real, args)
          return result === real ? proxy : result
        }
      }
      // Pre-materialization: never look like a thenable (an accidental `await`
      // on the builder must not trigger a connection open), and answer no
      // symbols (inspect/toStringTag probes are reads, not queries).
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      if (TERMINALS.has(prop)) {
        return async (...args: unknown[]) => {
          const qb = await materialize()
          const terminal = (qb as unknown as Record<PropertyKey, unknown>)[prop]
          if (typeof terminal !== 'function') {
            // Optional contract members (e.g. `upsert`) the adapter omits.
            throw new Error(
              `[RudderJS ORM] ${String(prop)}() is not implemented by this connection's adapter.`,
            )
          }
          return (terminal as (...a: unknown[]) => unknown).apply(qb, args)
        }
      }
      // Anything else is a chainable (contract chainables, adapter extras like
      // joins/date-helpers, `_enableSoftDeletes`) — record and self-return.
      return (...args: unknown[]) => {
        queued.push({ method: prop, args })
        return proxy
      }
    },
  })

  return proxy as QueryBuilder<T>
}
