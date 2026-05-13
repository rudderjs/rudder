import type {
  AggregateFn,
  AggregateRequest,
  AggregateJoinShape,
  WhereClause,
  WhereOperator,
  QueryBuilder,
} from '@rudderjs/contracts'
import type { Model, RelationDefinition } from './index.js'
import { camelHead, capitalize } from './utils.js'

// ─── Public types ──────────────────────────────────────────

/**
 * Constraint callback for the map form of `withCount` / `withExists`. Receives
 * an {@link AggregateConstraintBuilder} for narrow `where`/`as` recording.
 * Larger surface (`orWhere`, `orderBy`, `limit`, terminals) is intentionally
 * out of scope — those have ambiguous semantics in an aggregate context.
 */
export type AggregateConstraint = (q: AggregateConstraintBuilder) => AggregateConstraintBuilder

/**
 * `where`/`as` recorder passed to {@link AggregateConstraint} callbacks.
 * Captures clauses for the adapter to AND into the aggregate subquery, plus
 * an optional alias prefix override (`.as('publishedPosts')`).
 *
 * **OR semantics are not supported.** Multiple `.where(...)` calls compose
 * with AND. To branch, split the aggregate into separate `withCount` calls
 * with distinct `.as(...)` aliases and combine in app code.
 */
export class AggregateConstraintBuilder {
  /** @internal */
  readonly _wheres: WhereClause[] = []
  /** @internal — alias prefix override; falls back to the relation name. */
  _aliasPrefix?: string

  where(column: string, valueOrOperator: unknown, maybeValue?: unknown): this {
    if (maybeValue === undefined) {
      this._wheres.push({ column, operator: '=', value: valueOrOperator })
    } else {
      this._wheres.push({ column, operator: valueOrOperator as WhereOperator, value: maybeValue })
    }
    return this
  }

  /**
   * Not supported — aggregate constraints AND together. Documented as a
   * throw rather than silently dropping the OR semantics (which the
   * underlying {@link WhereClause} can't carry).
   */
  orWhere(_column: string, _valueOrOperator: unknown, _maybeValue?: unknown): this {
    throw new Error(
      '[RudderJS ORM] orWhere is not supported inside a withCount/withSum/withExists constraint — ' +
      'aggregate predicates compose with AND. Split into separate aggregates with distinct .as(...) ' +
      'aliases and combine in app code.'
    )
  }

  /**
   * Override the alias prefix used to stamp the aggregate column onto the
   * result row. Default = relation name. The verb suffix (`Count`/`SumX`/etc.)
   * is preserved, so `.as('publishedPosts')` on a `withCount` call yields
   * `publishedPostsCount`.
   *
   * Required when calling the same `withCount` / `withSum` twice on different
   * constraints — distinct aliases prevent the second from clobbering the first.
   */
  as(alias: string): this {
    this._aliasPrefix = alias
    return this
  }
}

/** Map-form spec for `withSum` / `withMin` / `withMax` / `withAvg`. */
export interface AggregateSumSpec {
  column:      string
  constraint?: AggregateConstraint
}

// ─── Symbol tag for hydration ──────────────────────────────

/**
 * Per-instance set of attribute keys that came from an aggregate eager-load,
 * not from the underlying schema. Read by `Model._toData()` to skip these
 * keys on writes and by callers that need to distinguish injected columns.
 *
 * Cross-realm-safe via `Symbol.for(...)` — distinct copies of `@rudderjs/orm`
 * loaded by different module graphs share the same tag.
 */
export const AGGREGATES_SYMBOL = Symbol.for('rudderjs.orm.aggregates')

/** @internal — read or initialise the aggregate-key set on a Model instance. */
export function aggregateKeysOf(instance: object): Set<string> {
  const obj = instance as Record<symbol, Set<string> | undefined>
  let set = obj[AGGREGATES_SYMBOL]
  if (!set) {
    set = new Set<string>()
    Object.defineProperty(instance, AGGREGATES_SYMBOL, {
      value:        set,
      writable:     true,
      configurable: true,
      enumerable:   false,
    })
  }
  return set
}

// ─── Alias suffix ──────────────────────────────────────────

/**
 * The verb suffix that distinguishes which aggregate is stamped on the parent.
 * Combined with the relation name (or `.as(...)` override) to produce the
 * final alias key — e.g. `posts` + `count` → `postsCount`,
 * `posts` + sum of `views` → `postsSumViews`.
 */
export function aggregateSuffix(fn: AggregateFn, column?: string): string {
  switch (fn) {
    case 'count':  return 'Count'
    case 'exists': return 'Exists'
    case 'sum':    return 'Sum' + capitalize(column ?? '')
    case 'min':    return 'Min' + capitalize(column ?? '')
    case 'max':    return 'Max' + capitalize(column ?? '')
    case 'avg':    return 'Avg' + capitalize(column ?? '')
  }
}

export function aggregateAlias(fn: AggregateFn, baseAlias: string, column?: string): string {
  return baseAlias + aggregateSuffix(fn, column)
}

// ─── Join-shape resolution ─────────────────────────────────

/**
 * Build the {@link AggregateJoinShape} for a relation declared on `Parent`.
 * Mirrors `_buildRelationPredicate` but emits the join-shape subset rather
 * than the full {@link RelationExistencePredicate}. `morphTo` and `belongsTo`
 * are rejected by the caller before reaching this function; everything else
 * routes through.
 */
export function buildAggregateJoinShape(
  Parent:   typeof Model,
  relation: string,
  def:      Exclude<RelationDefinition, { type: 'morphTo' | 'belongsTo' }>,
): AggregateJoinShape {
  const Related = def.model() as typeof Model
  const softDeletes = Related.softDeletes

  if (def.type === 'belongsToMany') {
    const parentKey       = def.parentKey       ?? Parent.primaryKey
    const relatedKey      = def.relatedKey      ?? Related.primaryKey
    const foreignPivotKey = def.foreignPivotKey ?? `${camelHead(Parent.name)}Id`
    const relatedPivotKey = def.relatedPivotKey ?? `${camelHead(Related.name)}Id`
    return {
      relatedTable:  Related.getTable(),
      parentColumn:  parentKey,
      relatedColumn: relatedKey,
      through: {
        pivotTable:  def.pivotTable,
        foreignPivotKey,
        relatedPivotKey,
      },
      ...(softDeletes && { softDeletes: true }),
    }
  }

  if (def.type === 'morphToMany') {
    const parentKey       = def.parentKey       ?? Parent.primaryKey
    const relatedKey      = def.relatedKey      ?? Related.primaryKey
    const foreignPivotKey = `${def.morphName}Id`
    const morphTypeKey    = `${def.morphName}Type`
    const morphTypeValue  = def.morphType ?? Parent.morphAlias ?? Parent.name
    const relatedPivotKey = def.relatedPivotKey ?? `${camelHead(Related.name)}Id`
    return {
      relatedTable:  Related.getTable(),
      parentColumn:  parentKey,
      relatedColumn: relatedKey,
      extraEquals:   { [morphTypeKey]: morphTypeValue },
      through: {
        pivotTable:  def.pivotTable,
        foreignPivotKey,
        relatedPivotKey,
      },
      ...(softDeletes && { softDeletes: true }),
    }
  }

  if (def.type === 'morphedByMany') {
    const parentKey       = def.parentKey       ?? Parent.primaryKey
    const relatedKey      = def.relatedKey      ?? Related.primaryKey
    const foreignPivotKey = def.foreignPivotKey ?? `${camelHead(Parent.name)}Id`
    const morphTypeKey    = `${def.morphName}Type`
    const morphTypeValue  = def.morphType ?? Related.morphAlias ?? Related.name
    const relatedPivotKey = `${def.morphName}Id`
    return {
      relatedTable:  Related.getTable(),
      parentColumn:  parentKey,
      relatedColumn: relatedKey,
      extraEquals:   { [morphTypeKey]: morphTypeValue },
      through: {
        pivotTable:  def.pivotTable,
        foreignPivotKey,
        relatedPivotKey,
      },
      ...(softDeletes && { softDeletes: true }),
    }
  }

  if (def.type === 'morphMany' || def.type === 'morphOne') {
    const idCol    = `${def.morphName}Id`
    const typeCol  = `${def.morphName}Type`
    const localCol = def.localKey ?? Parent.primaryKey
    const typeVal  = def.morphType ?? Parent.morphAlias ?? Parent.name
    return {
      relatedTable:  Related.getTable(),
      parentColumn:  localCol,
      relatedColumn: idCol,
      extraEquals:   { [typeCol]: typeVal },
      ...(softDeletes && { softDeletes: true }),
    }
  }

  // hasOne / hasMany — related table holds the FK pointing back to Parent.
  const fk       = def.foreignKey ?? `${camelHead(Parent.name)}Id`
  const localCol = def.localKey   ?? Parent.primaryKey
  return {
    relatedTable:  Related.getTable(),
    parentColumn:  localCol,
    relatedColumn: fk,
    ...(softDeletes && { softDeletes: true }),
  }
}

// ─── Normalization helpers ─────────────────────────────────

type RelationsMapEntry = AggregateConstraint
type RelationsMap = Record<string, RelationsMapEntry>

/**
 * Run a constraint callback against a fresh {@link AggregateConstraintBuilder}
 * and return the recorded clauses + alias override. Keeps the construction
 * side-effect-free on the parent QB.
 */
function _runConstraint(constraint: AggregateConstraint): { wheres: WhereClause[]; aliasPrefix?: string } {
  const builder = new AggregateConstraintBuilder()
  constraint(builder)
  const out: { wheres: WhereClause[]; aliasPrefix?: string } = { wheres: builder._wheres }
  if (builder._aliasPrefix !== undefined) out.aliasPrefix = builder._aliasPrefix
  return out
}

function _resolveDef(
  Parent:   typeof Model,
  relation: string,
): Exclude<RelationDefinition, { type: 'morphTo' | 'belongsTo' }> {
  const def = Parent.relations[relation]
  if (!def) {
    throw new Error(`[RudderJS ORM] Relation "${relation}" is not defined on ${Parent.name}.`)
  }
  if (def.type === 'morphTo') {
    throw new Error(
      `[RudderJS ORM] withCount() on morphTo "${relation}" is not supported — the related table is dynamic. ` +
      `Aggregate per-target by querying each target class separately.`,
    )
  }
  if (def.type === 'belongsTo') {
    throw new Error(
      `[RudderJS ORM] withCount on belongsTo "${relation}" is ambiguous — every parent matches exactly one. ` +
      `Use withExists("${relation}") to test presence or query the inverse hasMany side.`,
    )
  }
  return def
}

function _buildRequest(
  Parent:    typeof Model,
  relation:  string,
  fn:        AggregateFn,
  column:    string | undefined,
  constraint: AggregateConstraint | undefined,
): AggregateRequest {
  const def       = _resolveDef(Parent, relation)
  const joinShape = buildAggregateJoinShape(Parent, relation, def)
  const captured  = constraint ? _runConstraint(constraint) : undefined
  const baseAlias = captured?.aliasPrefix ?? relation
  const req: AggregateRequest = {
    relation,
    fn,
    alias:            aggregateAlias(fn, baseAlias, column),
    joinShape,
    constraintWheres: captured?.wheres ?? [],
  }
  if (column !== undefined) req.column = column
  return req
}

function _normalizeRelationsMap(
  Parent:    typeof Model,
  relations: RelationsMap,
  fn:        'count' | 'exists',
): AggregateRequest[] {
  return Object.entries(relations).map(([relation, constraint]) =>
    _buildRequest(Parent, relation, fn, undefined, constraint),
  )
}

function _normalizeStringList(
  Parent:    typeof Model,
  relations: readonly string[],
  fn:        'count' | 'exists',
): AggregateRequest[] {
  return relations.map(r => _buildRequest(Parent, r, fn, undefined, undefined))
}

/** Public entrypoint: normalize all `withCount(...)` overloads. */
export function normalizeWithCount(
  Parent: typeof Model,
  arg:    string | readonly string[] | RelationsMap,
): AggregateRequest[] {
  if (typeof arg === 'string') return [_buildRequest(Parent, arg, 'count', undefined, undefined)]
  if (Array.isArray(arg))      return _normalizeStringList(Parent, arg, 'count')
  return _normalizeRelationsMap(Parent, arg as RelationsMap, 'count')
}

/** Public entrypoint: normalize all `withExists(...)` overloads. */
export function normalizeWithExists(
  Parent: typeof Model,
  arg:    string | readonly string[],
): AggregateRequest[] {
  if (typeof arg === 'string') return [_buildRequest(Parent, arg, 'exists', undefined, undefined)]
  return _normalizeStringList(Parent, arg, 'exists')
}

/** Public entrypoint: normalize all `withSum/withMin/withMax/withAvg(...)` overloads. */
export function normalizeWithNumericAggregate(
  Parent: typeof Model,
  fn:     'sum' | 'min' | 'max' | 'avg',
  arg1:   string | Record<string, AggregateSumSpec>,
  arg2?:  string,
): AggregateRequest[] {
  if (typeof arg1 === 'string') {
    if (arg2 === undefined) {
      throw new Error(`[RudderJS ORM] with${capitalize(fn)}("${arg1}") requires a column argument.`)
    }
    return [_buildRequest(Parent, arg1, fn, arg2, undefined)]
  }
  return Object.entries(arg1).map(([relation, spec]) =>
    _buildRequest(Parent, relation, fn, spec.column, spec.constraint),
  )
}

// ─── Instance load path ────────────────────────────────────

/**
 * Resolve the related Model class for `relation` on `Parent`. Throws on
 * unknown relations and (for the aggregate path) on `morphTo` — the related
 * class is dynamic, no scalar aggregate possible.
 */
function _relatedClassFor(Parent: typeof Model, relation: string): typeof Model {
  const def = Parent.relations[relation]
  if (!def) {
    throw new Error(`[RudderJS ORM] Relation "${relation}" is not defined on ${Parent.name}.`)
  }
  if (def.type === 'morphTo') {
    throw new Error(
      `[RudderJS ORM] loadCount() on morphTo "${relation}" is not supported — the related table is dynamic.`,
    )
  }
  return def.model() as typeof Model
}

/**
 * Build a chainable QB on `Related` filtered to `instance` for the given
 * relation, with `constraintWheres` already AND-merged. Returns the QB ready
 * for a terminal call (`count()`, `_aggregate(fn, column)`, etc.).
 *
 * Reuses `instance.related(name)` so the whole pivot/morph plumbing stays in
 * one place — for `belongsTo`/`hasOne`/`hasMany`/`morph*` it's a direct
 * single-step query; for `belongsToMany`/`morphToMany`/`morphedByMany` it's a
 * deferred Proxy that resolves the pivot lookup on terminal call.
 */
function _instanceRelatedQb(
  instance:         Model,
  relation:         string,
  constraintWheres: WhereClause[],
): QueryBuilder<Model> {
  // The deferred pivot Proxy doesn't expose `_aggregate` directly; for
  // pivot-mediated relations we need to wait for the inner Related QB to be
  // resolved. The simplest portable path: lazily call `.where(...).count()`
  // (or `_aggregate(...)`) and trust the Proxy to forward terminal calls.
  // The deferred Proxy in index.ts whitelists known terminals via
  // `_TERMINAL_METHODS`, which doesn't include `_aggregate`. To keep the
  // public deferred shape stable, the load path here only uses public
  // terminal forms (`count`/`get`) — see _scalarAggregateOnQb below.
  let qb = instance.related(relation)
  for (const w of constraintWheres) {
    qb = qb.where(w.column, w.operator, w.value) as QueryBuilder<Model>
  }
  return qb
}

/**
 * Run a single-scalar aggregate on `qb`. Prefers the contract's `_aggregate`
 * terminal (Prisma + Drizzle adapters) when available; falls back to
 * portable `count()` / `get()` for the deferred pivot Proxy and any
 * future adapter that hasn't implemented `_aggregate`.
 */
async function _scalarAggregateOnQb(
  qb:     QueryBuilder<Model>,
  fn:     AggregateFn,
  column: string | undefined,
): Promise<unknown> {
  const direct = (qb as unknown as { _aggregate?: (f: AggregateFn, c?: string) => Promise<unknown> })._aggregate
  if (typeof direct === 'function') {
    return direct.call(qb, fn, column)
  }
  // Fallback for the deferred pivot Proxy: use whatever public terminal we have.
  if (fn === 'count' || fn === 'exists') {
    const n = await qb.count()
    return fn === 'exists' ? n > 0 : n
  }
  // sum/min/max/avg can't be expressed without `_aggregate` — load the rows
  // and compute in JS. Acceptable for instance-level loads; the parent QB
  // path uses the adapter's native aggregate selector.
  const rows = await qb.get() as unknown as Array<Record<string, unknown>>
  return _jsAggregate(fn, column!, rows)
}

function _jsAggregate(fn: 'sum' | 'min' | 'max' | 'avg', column: string, rows: Array<Record<string, unknown>>): unknown {
  if (rows.length === 0) {
    if (fn === 'sum') return 0
    return null
  }
  const nums = rows.map(r => Number(r[column])).filter(n => !Number.isNaN(n))
  if (nums.length === 0) {
    if (fn === 'sum') return 0
    return null
  }
  switch (fn) {
    case 'sum': return nums.reduce((a, b) => a + b, 0)
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length
  }
}

/**
 * Apply a single aggregate request against `instance`, stamping the result
 * onto `instance[req.alias]` and tagging the alias on the aggregates Symbol.
 */
async function _applyInstanceAggregate(instance: Model, req: AggregateRequest): Promise<void> {
  const qb    = _instanceRelatedQb(instance, req.relation, req.constraintWheres)
  const value = await _scalarAggregateOnQb(qb, req.fn, req.column)
  ;(instance as unknown as Record<string, unknown>)[req.alias] = value
  aggregateKeysOf(instance).add(req.alias)
}

/**
 * Implementation of `Model#loadCount` / `loadExists`. Mutates the instance
 * in place; returns it for chaining at the call site.
 */
export async function loadCountOrExists(
  instance: Model,
  fn:       'count' | 'exists',
  arg:      string | readonly string[] | RelationsMap,
): Promise<void> {
  const ctor = instance.constructor as typeof Model
  const reqs = fn === 'count' ? normalizeWithCount(ctor, arg) : normalizeWithExists(ctor, arg as string | readonly string[])
  for (const r of reqs) await _applyInstanceAggregate(instance, r)
}

/**
 * Implementation of `Model#loadSum` / `loadMin` / `loadMax` / `loadAvg`.
 */
export async function loadNumericAggregate(
  instance: Model,
  fn:       'sum' | 'min' | 'max' | 'avg',
  relation: string | Record<string, AggregateSumSpec>,
  column?:  string,
): Promise<void> {
  const ctor = instance.constructor as typeof Model
  const reqs = normalizeWithNumericAggregate(ctor, fn, relation, column)
  for (const r of reqs) await _applyInstanceAggregate(instance, r)
}

/**
 * Implementation of `Model#loadMissing`. Loads each named relation onto the
 * instance only when the property is currently `null` / `undefined`.
 *
 * Always uses `instance.related(name).get()` (the chainable QB form) — for
 * `hasOne` / `belongsTo` / `morphOne` semantics the caller can `[0]` the
 * resulting array if they know the relation is single-valued, or call
 * `loadMissing` only on the *array* relations they care about.
 */
export async function loadMissingRelations(instance: Model, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const cur = (instance as unknown as Record<string, unknown>)[name]
    if (cur !== undefined && cur !== null) continue
    const rows = await instance.related(name).get()
    ;(instance as unknown as Record<string, unknown>)[name] = rows
  }
}
