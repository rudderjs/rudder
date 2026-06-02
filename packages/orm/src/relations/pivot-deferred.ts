import type { QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../index.js'
import type {
  BelongsToManyDef,
  BelongsToManyMeta,
  MorphParentDef,
  MorphToManyDef,
  MorphToManyMeta,
  MorphedByManyDef,
  MorphedByManyMeta,
} from './pivot-meta.js'
import type { HasThroughMeta } from './has-through.js'

// ─── morphMany / morphOne read query ───────────────────────

/**
 * Build a non-deferred QueryBuilder that fetches the polymorphic children
 * of `self` for `morphMany` / `morphOne` declarations. Direct fetch — no
 * pivot table — so no Proxy/deferred wrapping needed.
 */
export function morphParentQuery(
  self: Model,
  ctor: typeof Model,
  def:  MorphParentDef,
  name: string,
): QueryBuilder<Model> {
  const Related  = def.model() as typeof Model
  const idCol    = `${def.morphName}Id`
  const typeCol  = `${def.morphName}Type`
  const localCol = def.localKey ?? ctor.primaryKey
  const localVal = (self as unknown as Record<string, unknown>)[localCol]
  const typeVal  = def.morphType ?? ctor.morphAlias ?? ctor.name
  if (localVal === undefined || localVal === null) {
    throw new Error(`[RudderJS ORM] Cannot resolve "${name}" on ${ctor.name} — ${localCol} is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.`)
  }
  return Related.where(idCol, localVal).where(typeCol, typeVal) as QueryBuilder<Model>
}

// ─── Deferred Proxy machinery ──────────────────────────────

const CHAIN_METHODS = new Set([
  'where', 'orWhere', 'orderBy', 'limit', 'offset', 'with', 'withTrashed', 'onlyTrashed',
])
const TERMINAL_METHODS = new Set([
  'first', 'find', 'get', 'all', 'count', 'paginate',
])
const UNSUPPORTED_TERMINALS = new Set([
  'create', 'update', 'delete', 'restore', 'forceDelete', 'increment', 'decrement', 'insertMany', 'deleteAll', 'updateAll',
])

type QbAsDict = Record<string, ((...a: unknown[]) => unknown) | undefined>

function replayChain(q: QueryBuilder<Model>, recorded: ReadonlyArray<[string, unknown[]]>): QueryBuilder<Model> {
  let cur = q
  for (const [m, args] of recorded) {
    const fn = (cur as unknown as QbAsDict)[m]
    if (fn) cur = fn.apply(cur, args) as QueryBuilder<Model>
  }
  return cur
}

/** What `buildResolved` resolves to — both the replay-ready QueryBuilder
 *  and the pivot rows fetched for *this* terminal call. Returning them
 *  together means concurrent terminals don't share state (the prior
 *  closure-captured `lastPivotRows` was a race; see Phase 5 in
 *  `docs/plans/2026-05-21-framework-orm-correctness.md`). */
type ResolvedQuery = {
  q:         QueryBuilder<Model>
  pivotRows: ReadonlyArray<Record<string, unknown>>
}

interface DeferredProxyHooks {
  /** Called when `withPivot(...cols)` is invoked. Throws when no cols are
   *  provided (mirrors the contract). The implementation captures the column
   *  list into the deferred-QB closure for post-terminal stamping. */
  onWithPivot?(columns: string[]): void
  /** Called after a terminal returns a result. Receives the pivot rows
   *  resolved for *this* call (not closure-captured) so concurrent
   *  terminals on the same builder don't read each other's pivot data. */
  postProcess?<R>(result: R, terminal: string, pivotRows: ReadonlyArray<Record<string, unknown>>): R
}

/** Methods we know exist on the QueryBuilder / ModelQuery surface but the
 *  deferred pivot proxy doesn't record. Throwing on these surfaces the
 *  silent no-op users hit when they chained `.whereHas(...)` /
 *  `.withCount(...)` / `.whereGroup(...)` etc. onto a pivot relation. */
function looksLikeUnsupportedChainMethod(name: string): boolean {
  if (CHAIN_METHODS.has(name) || TERMINAL_METHODS.has(name) || UNSUPPORTED_TERMINALS.has(name)) return false
  if (name === 'withPivot') return false
  // `where*` (whereHas, whereDoesntHave, whereGroup, whereBelongsTo, …),
  // `with*` (withCount, withSum, withWhereHas, withAggregate, …),
  // `load*` (loadCount, loadSum, …), and `or<X>` variants (orWhereGroup, …).
  // We bound this to method-shaped names so symbol props and runtime-internal
  // accesses (`then`, `toString`, `Symbol.iterator`) keep silently returning
  // undefined.
  return /^(where|with|load|or[A-Z])/.test(name)
}

/**
 * Build a deferred QueryBuilder that runs the pivot lookup on terminal
 * evaluation. Chain methods (where/orderBy/etc.) are recorded and replayed
 * against `Related.where(relatedKey, 'IN', ids)` once ids are resolved.
 *
 * Mutations (`create`/`update`/`delete`/`insertMany`/`deleteAll`) throw —
 * write the pivot via `belongsToMany().attach/detach/sync` and write the
 * related rows via the related model directly.
 *
 * Unsupported chain methods (`whereHas`, `withCount`, `whereGroup`, etc.)
 * also throw — previously they silently no-oped because the proxy returned
 * `undefined` for unknown props, which made the entire call chain fall off
 * the deferred lookup.
 */
function makeDeferredProxy(
  buildResolved: () => Promise<ResolvedQuery>,
  recorded:      Array<[string, unknown[]]>,
  relationKind:  'belongsToMany' | 'morphToMany' | 'morphedByMany' | 'hasOneThrough' | 'hasManyThrough',
  hooks:         DeferredProxyHooks = {},
): QueryBuilder<Model> {
  const proxy: QueryBuilder<Model> = new Proxy({} as QueryBuilder<Model>, {
    get(_t, prop): unknown {
      // Non-string props (Symbol.iterator, Symbol.toPrimitive, etc.) are
      // accessed by the JS runtime; returning undefined keeps the proxy a
      // plain object as far as `await`, spreads, and comparisons are
      // concerned. We never throw on these.
      if (typeof prop !== 'string') return undefined
      const name = prop
      if (name === 'withPivot') {
        return (...cols: string[]) => {
          if (cols.length === 0) {
            throw new Error('[RudderJS ORM] withPivot() requires at least one column name.')
          }
          hooks.onWithPivot?.(cols)
          return proxy
        }
      }
      if (CHAIN_METHODS.has(name)) {
        return (...args: unknown[]) => {
          recorded.push([name, args])
          return proxy
        }
      }
      if (TERMINAL_METHODS.has(name)) {
        return async (...args: unknown[]) => {
          const { q, pivotRows } = await buildResolved()
          const fn = (q as unknown as QbAsDict)[name]
          const raw = fn ? await fn.apply(q, args) : undefined
          return hooks.postProcess ? hooks.postProcess(raw, name, pivotRows) : raw
        }
      }
      if (UNSUPPORTED_TERMINALS.has(name)) {
        return () => {
          throw new Error(
            `[RudderJS ORM] "${name}" is not supported on a ${relationKind} lazy-fetch query. ` +
            `Use Model.${relationKind}(parent, name) for pivot mutations or call methods on the related Model directly.`,
          )
        }
      }
      if (looksLikeUnsupportedChainMethod(name)) {
        return () => {
          throw new Error(
            `[RudderJS ORM] "${name}()" is not supported on a ${relationKind} lazy-fetch query — ` +
            `the deferred proxy can only record the chain methods it knows about (` +
            `${[...CHAIN_METHODS].join(', ')}). ` +
            `To filter the related rows, terminate first (e.g. \`await parent.related(...).get()\`) ` +
            `then query the related model with the desired predicates, or use \`Model.${relationKind}(parent, name)\` for direct access to the QueryBuilder primitive.`,
          )
        }
      }
      return undefined
    },
  })
  return proxy
}

// ─── Pivot stamping (read-side) ────────────────────────────

/**
 * Stamp `row.pivot = { col: value, ... }` for every row in `rows` whose
 * `relatedKey` matches a pivot row. Used by the three deferred QBs after the
 * second-step `Related` query resolves. Mutates rows in place; rows whose
 * pivot row is absent are left untouched (`pivot` stays undefined).
 */
function stampPivotOnRows(
  rows:               ReadonlyArray<Record<string, unknown>>,
  relatedKey:         string,
  pivotRows:          ReadonlyArray<Record<string, unknown>>,
  relatedPivotKey:    string,
  pivotColumns:       ReadonlyArray<string>,
): void {
  if (pivotColumns.length === 0) return
  const byId = new Map<unknown, Record<string, unknown>>()
  for (const p of pivotRows) byId.set(p[relatedPivotKey], p)
  for (const row of rows) {
    if (row === null || row === undefined) continue
    const pivot = byId.get(row[relatedKey])
    if (!pivot) continue
    const projected: Record<string, unknown> = {}
    for (const col of pivotColumns) projected[col] = pivot[col]
    ;(row as Record<string, unknown>)['pivot'] = projected
  }
}

/**
 * Stamp `pivot` onto a single result (object or array). Used by the deferred
 * proxy's `postProcess` hook — the terminal name (`first` / `find` / `get` /
 * `all` / `paginate`) determines whether to walk the result.
 */
function stampPivotOnResult(
  result:          unknown,
  terminal:        string,
  relatedKey:      string,
  pivotRows:       ReadonlyArray<Record<string, unknown>>,
  relatedPivotKey: string,
  pivotColumns:    ReadonlyArray<string>,
): unknown {
  if (pivotColumns.length === 0) return result
  if (result === null || result === undefined) return result
  if (terminal === 'first' || terminal === 'find') {
    stampPivotOnRows([result as Record<string, unknown>], relatedKey, pivotRows, relatedPivotKey, pivotColumns)
    return result
  }
  if (terminal === 'get' || terminal === 'all') {
    stampPivotOnRows(result as ReadonlyArray<Record<string, unknown>>, relatedKey, pivotRows, relatedPivotKey, pivotColumns)
    return result
  }
  if (terminal === 'paginate') {
    const page = result as { data: ReadonlyArray<Record<string, unknown>> }
    stampPivotOnRows(page.data, relatedKey, pivotRows, relatedPivotKey, pivotColumns)
    return result
  }
  return result
}

// ─── Public deferred-QB builders ───────────────────────────

export function belongsToManyDeferredQb(
  Related:   typeof Model,
  _def:      BelongsToManyDef,
  meta:      BelongsToManyMeta,
  parentVal: unknown,
): QueryBuilder<Model> {
  const recorded:     Array<[string, unknown[]]> = []
  const pivotColumns: string[] = []

  const buildResolved = async (): Promise<ResolvedQuery> => {
    const adapter = ModelRegistry.getAdapter()
    const pivotRows = await adapter
      .query<Record<string, unknown>>(meta.pivotTable)
      .where(meta.foreignPivotKey, parentVal)
      .get()
    const ids = pivotRows.map(r => r[meta.relatedPivotKey])
    // Empty IN list — short-circuit with a guaranteed-empty query so
    // adapters don't have to handle the edge case.
    const q = (Related.query() as unknown as QueryBuilder<Model>)
      .where(meta.relatedKey, 'IN', ids.length === 0 ? [] : ids)
    return { q: replayChain(q, recorded), pivotRows }
  }

  return makeDeferredProxy(buildResolved, recorded, 'belongsToMany', {
    onWithPivot(cols) { pivotColumns.push(...cols) },
    postProcess(result, terminal, pivotRows) {
      return stampPivotOnResult(result, terminal, meta.relatedKey, pivotRows, meta.relatedPivotKey, pivotColumns) as typeof result
    },
  })
}

export function morphToManyDeferredQb(
  Related:   typeof Model,
  _def:      MorphToManyDef,
  meta:      MorphToManyMeta,
  parentVal: unknown,
): QueryBuilder<Model> {
  const recorded:     Array<[string, unknown[]]> = []
  const pivotColumns: string[] = []

  const buildResolved = async (): Promise<ResolvedQuery> => {
    const adapter = ModelRegistry.getAdapter()
    const pivotRows = await adapter
      .query<Record<string, unknown>>(meta.pivotTable)
      .where(meta.foreignPivotKey, parentVal)
      .where(meta.morphTypeKey,    meta.morphTypeValue)
      .get()
    const ids = pivotRows.map(r => r[meta.relatedPivotKey])
    const q = (Related.query() as unknown as QueryBuilder<Model>)
      .where(meta.relatedKey, 'IN', ids.length === 0 ? [] : ids)
    return { q: replayChain(q, recorded), pivotRows }
  }

  return makeDeferredProxy(buildResolved, recorded, 'morphToMany', {
    onWithPivot(cols) { pivotColumns.push(...cols) },
    postProcess(result, terminal, pivotRows) {
      return stampPivotOnResult(result, terminal, meta.relatedKey, pivotRows, meta.relatedPivotKey, pivotColumns) as typeof result
    },
  })
}

export function morphedByManyDeferredQb(
  Related:   typeof Model,
  _def:      MorphedByManyDef,
  meta:      MorphedByManyMeta,
  parentVal: unknown,
): QueryBuilder<Model> {
  const recorded:     Array<[string, unknown[]]> = []
  const pivotColumns: string[] = []

  const buildResolved = async (): Promise<ResolvedQuery> => {
    const adapter = ModelRegistry.getAdapter()
    const pivotRows = await adapter
      .query<Record<string, unknown>>(meta.pivotTable)
      .where(meta.foreignPivotKey, parentVal)
      .where(meta.morphTypeKey,    meta.morphTypeValue)
      .get()
    const ids = pivotRows.map(r => r[meta.relatedPivotKey])
    const q = (Related.query() as unknown as QueryBuilder<Model>)
      .where(meta.relatedKey, 'IN', ids.length === 0 ? [] : ids)
    return { q: replayChain(q, recorded), pivotRows }
  }

  return makeDeferredProxy(buildResolved, recorded, 'morphedByMany', {
    onWithPivot(cols) { pivotColumns.push(...cols) },
    postProcess(result, terminal, pivotRows) {
      return stampPivotOnResult(result, terminal, meta.relatedKey, pivotRows, meta.relatedPivotKey, pivotColumns) as typeof result
    },
  })
}

// ─── hasOneThrough / hasManyThrough ────────────────────────

/**
 * Deferred QB for a `hasOneThrough` / `hasManyThrough` lazy read. Two hops on
 * terminal evaluation: (1) the through rows whose `firstKey` matches the
 * parent, collecting their `secondLocalKey` values; (2) the related rows whose
 * `secondKey` is in that set. Chain methods are replayed against the second-hop
 * query. No pivot columns — through relations don't surface intermediate data.
 */
export function hasThroughDeferredQb(
  meta:      HasThroughMeta,
  parentVal: unknown,
): QueryBuilder<Model> {
  const recorded: Array<[string, unknown[]]> = []

  const buildResolved = async (): Promise<ResolvedQuery> => {
    const throughRows = await (meta.Through.query() as unknown as QueryBuilder<Record<string, unknown>>)
      .where(meta.firstKey, parentVal)
      .get()
    const throughKeys = throughRows.map(r => r[meta.secondLocalKey])
    const q = (meta.Related.query() as unknown as QueryBuilder<Model>)
      .where(meta.secondKey, 'IN', throughKeys.length === 0 ? [] : throughKeys)
    return { q: replayChain(q, recorded), pivotRows: [] }
  }

  return makeDeferredProxy(buildResolved, recorded, meta.one ? 'hasOneThrough' : 'hasManyThrough')
}
