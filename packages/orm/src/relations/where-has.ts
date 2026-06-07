import type {
  QueryBuilder,
  RelationExistencePredicate,
  WhereClause,
  WhereOperator,
} from '@rudderjs/contracts'
import type { Model, RelationDefinition } from '../index.js'
import { camelHead } from '../utils.js'
import {
  resolveBelongsToManyMeta,
  resolveMorphToManyMeta,
  resolveMorphedByManyMeta,
} from './pivot-meta.js'
import { resolveHasThroughMeta, type HasThroughDef } from './has-through.js'

/**
 * Variant shape of `RelationDefinition` for `hasOne | hasMany | belongsTo`.
 * Those three live in a single union member with a literal-union `type`
 * field, so `Extract<RelationDefinition, { type: 'belongsTo' }>` evaluates
 * to `never` (the wider literal union doesn't extend the narrower one). We
 * model the merged variant explicitly and runtime-check `type === 'belongsTo'`.
 */
export type HasOrBelongsToDef = Exclude<
  RelationDefinition,
  { type: 'belongsToMany' | 'morphMany' | 'morphOne' | 'morphTo' | 'morphToMany' | 'morphedByMany' | 'hasOneThrough' | 'hasManyThrough' }
>

// ─── Constraint capture ────────────────────────────────────

/**
 * What a `whereHas` constrain callback may call: the adapter `QueryBuilder`
 * surface plus the AND-expressible sugar the capture recorder lowers to flat
 * `WhereClause`s (`whereIn`/`whereNotIn`/`whereNull`/`whereNotNull`/
 * `whereBetween`/`when`/`unless`). Extends `QueryBuilder<Model>` so existing
 * callbacks (and helpers explicitly typed against the contract) keep
 * compiling; `where`'s polymorphic `this` return keeps chains typed.
 */
export interface ConstraintQueryBuilder extends QueryBuilder<Model> {
  whereIn(column: string, values: readonly unknown[]): this
  whereNotIn(column: string, values: readonly unknown[]): this
  whereNull(column: string): this
  whereNotNull(column: string): this
  /** Lowered to its two AND bounds (`>= low` + `<= high`). */
  whereBetween(column: string, range: readonly [unknown, unknown]): this
  when<V>(value: V, cb?: (q: this, value: V) => void, otherwise?: (q: this, value: V) => void): this
  unless<V>(value: V, cb?: (q: this, value: V) => void, otherwise?: (q: this, value: V) => void): this
}

/**
 * Methods that are HARMLESS inside an existence subquery — they can't change
 * which related rows exist, so the recorder accepts and ignores them (Laravel
 * likewise ignores ordering/limits inside `whereHas`).
 */
const RECORDER_NOOP_METHODS = new Set([
  'orderBy', 'orderByRaw', 'latest', 'oldest', 'limit', 'offset',
  'select', 'with', 'withPivot',
])

/** Throwing entries for methods whose semantics CANNOT round-trip through the
 *  flat AND-only `WhereClause[]` the predicate carries. Each maps to the
 *  reason/pointer baked into the error. Silently dropping any of these would
 *  silently widen the filter — worse than the throw. */
const RECORDER_REJECTIONS: Record<string, string> = {
  orWhere:            `the WhereClause contract has no boolean flag, so the OR semantic can't round-trip to the adapter. Compose the predicate with where() (AND), or run two queries and merge in app code.`,
  whereNotBetween:    `its OR shape (< low OR > high) can't round-trip through the flat AND-only constraint list. Use two whereHas calls or filter in app code.`,
  whereGroup:         `grouped sub-conditions can't round-trip through the flat constraint list.`,
  orWhereGroup:       `grouped sub-conditions can't round-trip through the flat constraint list.`,
  whereRaw:           `raw SQL fragments can't round-trip through the structured constraint list. Use DB.select(...) for raw-SQL relation filters.`,
  orWhereRaw:         `raw SQL fragments can't round-trip through the structured constraint list. Use DB.select(...) for raw-SQL relation filters.`,
  whereColumn:        `column-vs-column comparisons can't round-trip through the value-shaped constraint list.`,
  orWhereColumn:      `column-vs-column comparisons can't round-trip through the value-shaped constraint list.`,
  whereDate:          `date-part extraction needs adapter SQL the constraint list can't carry.`,
  whereTime:          `date-part extraction needs adapter SQL the constraint list can't carry.`,
  whereDay:           `date-part extraction needs adapter SQL the constraint list can't carry.`,
  whereMonth:         `date-part extraction needs adapter SQL the constraint list can't carry.`,
  whereYear:          `date-part extraction needs adapter SQL the constraint list can't carry.`,
  whereJsonContains:      `JSON containment needs adapter SQL the constraint list can't carry. Plain arrow-path where('meta->key', v) DOES work.`,
  whereJsonDoesntContain: `JSON containment needs adapter SQL the constraint list can't carry. Plain arrow-path where('meta->key', v) DOES work.`,
  whereJsonLength:        `JSON length needs adapter SQL the constraint list can't carry.`,
  whereExists:        `subquery predicates can't round-trip through the constraint list.`,
  whereNotExists:     `subquery predicates can't round-trip through the constraint list.`,
  whereBelongsTo:     `relation shorthands aren't resolvable inside the callback. Use where('<fk>', parent.id) directly.`,
  whereRelation:      `relation predicates inside the callback aren't supported in v1.`,
  orWhereRelation:    `relation predicates inside the callback aren't supported in v1.`,
  has:                `count comparisons inside the callback aren't supported in v1.`,
  orHas:              `count comparisons inside the callback aren't supported in v1.`,
  orWhereHas:         `OR-rooted relation predicates inside the callback aren't supported in v1.`,
  orWhereDoesntHave:  `OR-rooted relation predicates inside the callback aren't supported in v1.`,
  withTrashed:        `soft-delete scoping is the callback's responsibility — relation subqueries include trashed rows by default; filter explicitly with where('deletedAt', null).`,
  onlyTrashed:        `soft-delete scoping is the callback's responsibility — filter explicitly with where('deletedAt', '!=', null).`,
  whereVectorSimilarTo: `vector predicates can't round-trip through the constraint list.`,
}

/**
 * Run the constrain callback against a recording-only QueryBuilder that
 * captures the AND-expressible `where` surface into a flat `WhereClause[]`:
 * `where` (2- and 3-arg), `whereIn` / `whereNotIn`, `whereNull` /
 * `whereNotNull`, `whereBetween` (lowered to `>= low` + `<= high`), and the
 * `when` / `unless` conditionals (their callbacks run against the recorder).
 *
 * Everything that CANNOT round-trip through the flat AND-only list throws a
 * clear error instead of silently widening the filter — historically the
 * recorder no-oped every unknown method, so a `whereIn(...)` inside a
 * callback silently matched MORE rows than intended. Methods that are
 * harmless to an existence test (`orderBy`, `limit`, …) stay accepted-and-
 * ignored. Nested `whereHas` inside the callback still throws — the dot-path
 * form (`whereHas('parent.child', cb)`) covers that semantic (native engine).
 */
export function captureConstraintWheres(
  constrain: (q: ConstraintQueryBuilder) => void,
): WhereClause[] {
  const wheres: WhereClause[] = []
  const recorder: ConstraintQueryBuilder = new Proxy({} as ConstraintQueryBuilder, {
    get(_t, prop): unknown {
      const name = String(prop)
      if (name === 'where') {
        return (col: string, opOrVal: unknown, maybeVal?: unknown): ConstraintQueryBuilder => {
          if (maybeVal === undefined) {
            wheres.push({ column: col, operator: '=', value: opOrVal })
          } else {
            wheres.push({ column: col, operator: opOrVal as WhereOperator, value: maybeVal })
          }
          return recorder
        }
      }
      if (name === 'whereIn' || name === 'whereNotIn') {
        return (col: string, values: unknown[]): ConstraintQueryBuilder => {
          wheres.push({ column: col, operator: name === 'whereIn' ? 'IN' : 'NOT IN', value: values })
          return recorder
        }
      }
      if (name === 'whereNull' || name === 'whereNotNull') {
        return (col: string): ConstraintQueryBuilder => {
          wheres.push({ column: col, operator: name === 'whereNull' ? '=' : '!=', value: null })
          return recorder
        }
      }
      if (name === 'whereBetween') {
        return (col: string, range: [unknown, unknown]): ConstraintQueryBuilder => {
          wheres.push({ column: col, operator: '>=', value: range[0] })
          wheres.push({ column: col, operator: '<=', value: range[1] })
          return recorder
        }
      }
      if (name === 'when' || name === 'unless') {
        return (value: unknown, cb?: (q: ConstraintQueryBuilder, v: unknown) => void, otherwise?: (q: ConstraintQueryBuilder, v: unknown) => void): ConstraintQueryBuilder => {
          const truthy = Boolean(value)
          const active = name === 'when' ? truthy : !truthy
          if (active) cb?.(recorder, value)
          else        otherwise?.(recorder, value)
          return recorder
        }
      }
      if (name === 'whereHas' || name === 'whereDoesntHave' || name === 'withWhereHas') {
        return (): ConstraintQueryBuilder => {
          throw new Error(
            `[RudderJS ORM] Nested ${name} inside a whereHas constrain callback is not supported — ` +
            `use the dot-path form instead: whereHas('parent.child', cb) (native engine).`,
          )
        }
      }
      const rejection = RECORDER_REJECTIONS[name]
      if (rejection !== undefined) {
        return (): ConstraintQueryBuilder => {
          throw new Error(`[RudderJS ORM] ${name}() inside a whereHas constrain callback is not supported — ${rejection}`)
        }
      }
      if (RECORDER_NOOP_METHODS.has(name)) {
        return (): ConstraintQueryBuilder => recorder
      }
      // Unknown methods (incl. terminals like get()/first(), which would
      // execute mid-build) throw rather than silently chaining — the silent
      // catch-all is exactly how dropped constraints went unnoticed.
      return (): ConstraintQueryBuilder => {
        throw new Error(
          `[RudderJS ORM] ${name}() is not available inside a whereHas constrain callback. ` +
          `Supported: where, whereIn/whereNotIn, whereNull/whereNotNull, whereBetween, when/unless ` +
          `(plus ignored ordering/limiting methods).`,
        )
      }
    },
  })
  constrain(recorder)
  return wheres
}

/**
 * Build a `whereHas` constrain callback for the `whereRelation` sugar — a
 * single `where(column, …)` on the related rows. Mirrors `where()`'s 2-arg
 * (`=`) vs 3-arg (operator) parsing: when `value` is omitted, `operatorOrValue`
 * is the compared value and the operator is `=`.
 */
export function relationConstrain(
  column:          string,
  operatorOrValue: unknown,
  value:           unknown,
): (q: ConstraintQueryBuilder) => void {
  return (q): void => {
    if (value === undefined) q.where(column, operatorOrValue)
    else q.where(column, operatorOrValue as WhereOperator, value)
  }
}

// ─── belongsTo lookup ──────────────────────────────────────

/**
 * Resolve the `belongsTo` relation declaration on `Self` that points at
 * `ParentCtor`. When `relation` is given, looks it up directly. Otherwise
 * scans `Self.relations` for a single `belongsTo` whose `model()` resolves
 * to `ParentCtor` — throws on zero or multiple candidates.
 */
export function resolveBelongsToFor(
  Self:       typeof Model,
  ParentCtor: typeof Model,
  relation?:  string,
): HasOrBelongsToDef {
  if (relation !== undefined) {
    const def = Self.relations[relation]
    if (!def) throw new Error(`[RudderJS ORM] Relation "${relation}" is not defined on ${Self.name}.`)
    if (def.type !== 'belongsTo') {
      throw new Error(`[RudderJS ORM] Relation "${relation}" on ${Self.name} is "${def.type}", not "belongsTo".`)
    }
    return def as HasOrBelongsToDef
  }
  const candidates: Array<[string, HasOrBelongsToDef]> = []
  for (const [name, def] of Object.entries(Self.relations)) {
    if (def.type !== 'belongsTo') continue
    const btDef = def as HasOrBelongsToDef
    if (btDef.model() === ParentCtor) candidates.push([name, btDef])
  }
  if (candidates.length === 0) {
    throw new Error(
      `[RudderJS ORM] whereBelongsTo: ${Self.name} has no belongsTo relation pointing at ${ParentCtor.name}. ` +
      `Pass a relation name explicitly.`,
    )
  }
  if (candidates.length > 1) {
    const names = candidates.map(([n]) => n).join(', ')
    throw new Error(
      `[RudderJS ORM] whereBelongsTo: ${Self.name} has multiple belongsTo relations pointing at ${ParentCtor.name} (${names}). ` +
      `Pass the relation name explicitly.`,
    )
  }
  return candidates[0]![1]
}

// ─── Predicate builder ─────────────────────────────────────

/**
 * Build the {@link RelationExistencePredicate} for a relation declared on
 * `Parent`. `morphTo` is rejected before reaching this function (the related
 * table is dynamic).
 */
export function buildRelationPredicate(
  Parent:           typeof Model,
  relation:         string,
  def:              Exclude<RelationDefinition, { type: 'morphTo' }>,
  exists:           boolean,
  constraintWheres: WhereClause[],
): RelationExistencePredicate {
  if (def.type === 'hasOneThrough' || def.type === 'hasManyThrough') {
    // Through relations are structurally the pivot two-hop walk — the
    // INTERMEDIATE table plays the pivot's role (`users` between `countries`
    // and `posts`):
    //   pivot.foreignPivotKey = parent.parentColumn   (users.countryId = countries.id)
    //   related.relatedColumn = pivot.relatedPivotKey (posts.userId    = users.id)
    // `fanOut` marks the 1:N intermediate→related cardinality so a `count`
    // comparison counts FAR rows (joined), not intermediates — for pivots the
    // two coincide, for through they don't. Constraint wheres apply to the
    // FAR table (Laravel semantics).
    const meta = resolveHasThroughMeta(Parent, def as HasThroughDef)
    return {
      relation,
      exists,
      relatedTable:  meta.Related.getTable(),
      parentColumn:  meta.localKey,
      relatedColumn: meta.secondKey,
      constraintWheres,
      through: {
        pivotTable:      meta.Through.getTable(),
        foreignPivotKey: meta.firstKey,
        relatedPivotKey: meta.secondLocalKey,
        fanOut:          true,
      },
    }
  }

  const Related = def.model() as typeof Model

  if (def.type === 'belongsToMany') {
    const meta = resolveBelongsToManyMeta(Parent, Related, def)
    return {
      relation,
      exists,
      relatedTable:  Related.getTable(),
      parentColumn:  meta.parentKey,
      relatedColumn: meta.relatedKey,
      constraintWheres,
      through: {
        pivotTable:      meta.pivotTable,
        foreignPivotKey: meta.foreignPivotKey,
        relatedPivotKey: meta.relatedPivotKey,
      },
    }
  }

  if (def.type === 'morphToMany') {
    const meta = resolveMorphToManyMeta(Parent, Related, def)
    return {
      relation,
      exists,
      relatedTable:  Related.getTable(),
      parentColumn:  meta.parentKey,
      relatedColumn: meta.relatedKey,
      constraintWheres,
      extraEquals:  { [meta.morphTypeKey]: meta.morphTypeValue },
      through: {
        pivotTable:      meta.pivotTable,
        foreignPivotKey: meta.foreignPivotKey,
        relatedPivotKey: meta.relatedPivotKey,
      },
    }
  }

  if (def.type === 'morphedByMany') {
    const meta = resolveMorphedByManyMeta(Parent, Related, def)
    return {
      relation,
      exists,
      relatedTable:  Related.getTable(),
      parentColumn:  meta.parentKey,
      relatedColumn: meta.relatedKey,
      constraintWheres,
      extraEquals:  { [meta.morphTypeKey]: meta.morphTypeValue },
      through: {
        pivotTable:      meta.pivotTable,
        foreignPivotKey: meta.foreignPivotKey,
        relatedPivotKey: meta.relatedPivotKey,
      },
    }
  }

  if (def.type === 'morphMany' || def.type === 'morphOne') {
    const idCol    = `${def.morphName}Id`
    const typeCol  = `${def.morphName}Type`
    const localCol = def.localKey ?? Parent.primaryKey
    const typeVal  = def.morphType ?? Parent.morphAlias ?? Parent.name
    return {
      relation,
      exists,
      relatedTable:  Related.getTable(),
      parentColumn:  localCol,
      relatedColumn: idCol,
      constraintWheres,
      extraEquals: { [typeCol]: typeVal },
    }
  }

  if (def.type === 'belongsTo') {
    const fk       = def.foreignKey ?? `${camelHead(Related.name)}Id`
    const localCol = def.localKey   ?? fk
    return {
      relation,
      exists,
      relatedTable:  Related.getTable(),
      parentColumn:  localCol,
      relatedColumn: Related.primaryKey,
      constraintWheres,
    }
  }

  // hasOne / hasMany — related table holds the FK pointing back to Parent.
  // (`through` is rejected at the top; narrow positively for TS — a two-literal
  // discriminant member isn't dropped by the guard above.)
  const simpleDef = def as Extract<RelationDefinition, { type: 'hasOne' | 'hasMany' | 'belongsTo' }>
  const fk       = simpleDef.foreignKey ?? `${camelHead(Parent.name)}Id`
  const localCol = simpleDef.localKey   ?? Parent.primaryKey
  return {
    relation,
    exists,
    relatedTable:  Related.getTable(),
    parentColumn:  localCol,
    relatedColumn: fk,
    constraintWheres,
  }
}

// ─── Nested relation paths (`'posts.comments'`) ────────────

/**
 * Build the predicate chain for a dot-path relation
 * (`whereHas('posts.comments', cb)`): each level resolves on the previous
 * level's related model and wraps its child via the predicate's `nested`
 * field. Laravel `hasNested` semantics — outer levels are plain existence,
 * the constrain callback + any count comparison sit on the DEEPEST level,
 * and `exists` flips only the OUTERMOST predicate (`whereDoesntHave('a.b')`
 * = "has no `a` whose `b` exists"; an `a` without any `b` doesn't count
 * against it).
 *
 * `morphTo` anywhere in the chain throws (dynamic related table); through
 * relations compose like any other level (their predicate carries the
 * intermediate as a `through` block).
 */
export function buildNestedRelationPredicate(
  Parent:           typeof Model,
  path:             string,
  exists:           boolean,
  constraintWheres: WhereClause[],
  count?:           { operator: WhereOperator; value: number },
): RelationExistencePredicate {
  const names = path.split('.')
  if (names.some(n => n.length === 0)) {
    throw new Error(`[RudderJS ORM] Malformed nested relation path "${path}" — empty segment.`)
  }

  // Resolve every level first (clear errors before any predicate is built).
  const levels: Array<{ Owner: typeof Model; name: string; def: Exclude<RelationDefinition, { type: 'morphTo' }> }> = []
  let Owner = Parent
  for (const name of names) {
    const def = Owner.relations[name]
    if (!def) {
      throw new Error(`[RudderJS ORM] Relation "${name}" is not defined on ${Owner.name} (nested path "${path}").`)
    }
    if (def.type === 'morphTo') {
      throw new Error(
        `[RudderJS ORM] morphTo "${name}" cannot appear in a nested whereHas path ("${path}") — the related ` +
        `table is dynamic. Filter on ${def.morphName}Id / ${def.morphName}Type directly instead.`,
      )
    }
    levels.push({ Owner, name, def })
    Owner = def.model() as typeof Model
  }

  // Build deepest-first; each level wraps its child via `nested`.
  let child: RelationExistencePredicate | undefined
  for (let i = levels.length - 1; i >= 0; i--) {
    const level   = levels[i]!
    const deepest = i === levels.length - 1
    const pred = buildRelationPredicate(
      level.Owner, level.name, level.def,
      i === 0 ? exists : true,
      deepest ? constraintWheres : [],
    )
    if (deepest && count) pred.count = count
    if (child) pred.nested = child
    child = pred
  }
  return child!
}

/**
 * Guard: nested predicate chains need adapter support (the native engine's
 * recursive correlated-EXISTS compiler) — adapters without the
 * `supportsNestedRelationPredicates` marker would silently ignore the
 * `nested` field and return wrong rows, so throw a clear error instead.
 *
 * Deliberately falsy-based (not `=== true`): the deferred named-connection
 * recorder answers every property access with a recorder function (truthy),
 * so a not-yet-materialized native connection passes through and the
 * materialized QB settles it.
 */
function assertNestedRelationSupport(q: unknown, path: string): void {
  if ((q as { supportsNestedRelationPredicates?: unknown }).supportsNestedRelationPredicates) return
  throw new Error(
    `[RudderJS ORM] Nested whereHas ("${path}") is not supported on this adapter — it needs the native ` +
    `engine's correlated-EXISTS chain. Filter one hop with whereHas and the rest in app code, or use DB.select(...).`,
  )
}

// ─── Public attach helpers ─────────────────────────────────

/**
 * Build the predicate for a relation declared on `Parent` and dispatch it to
 * the adapter via `q.whereRelationExists(predicate)`. Returns the same
 * QueryBuilder for chaining (the adapter mutates in place).
 *
 * `morphTo` throws — the related table isn't statically known so a single
 * EXISTS subquery can't represent it. Filter on the discriminator + id
 * columns directly when you need that semantic.
 */
export function attachWhereHas<TQ>(
  Parent:    typeof Model,
  q:         QueryBuilder<TQ>,
  relation:  string,
  exists:    boolean,
  constrain?: (q: ConstraintQueryBuilder) => void,
  opts?:     { boolean?: 'AND' | 'OR'; count?: { operator: WhereOperator; value: number } },
): QueryBuilder<TQ> {
  // Dot-path = nested relation chain (`whereHas('posts.comments', cb)`).
  if (relation.includes('.')) {
    // Laravel `hasNested` doesntHave special case: `has('a.b', '<', 1)` is
    // exactly "doesn't have" — flip the outermost EXISTS instead of putting
    // the count on the deepest level.
    let rootExists = exists
    let count = opts?.count
    if (count && count.operator === '<' && count.value === 1) {
      rootExists = false
      count = undefined
    }
    const constraintWheres = constrain ? captureConstraintWheres(constrain) : []
    const predicate = buildNestedRelationPredicate(Parent, relation, rootExists, constraintWheres, count)
    if (opts?.boolean) predicate.boolean = opts.boolean
    assertNestedRelationSupport(q, relation)
    return q.whereRelationExists(predicate)
  }

  const def = Parent.relations[relation]
  if (!def) {
    throw new Error(`[RudderJS ORM] Relation "${relation}" is not defined on ${Parent.name}.`)
  }
  if (def.type === 'morphTo') {
    throw new Error(
      `[RudderJS ORM] morphTo "${relation}" cannot be used with whereHas — the related table is dynamic. ` +
      `Filter on ${def.morphName}Id / ${def.morphName}Type directly instead.`,
    )
  }

  const constraintWheres = constrain ? captureConstraintWheres(constrain) : []
  const predicate        = buildRelationPredicate(Parent, relation, def, exists, constraintWheres)
  // OR-rooting (orWhereHas family) + count comparison (has(rel, op, n)) ride on
  // the predicate so the adapter sees them in one shape.
  if (opts?.boolean) predicate.boolean = opts.boolean
  if (opts?.count)   predicate.count   = opts.count
  return q.whereRelationExists(predicate)
}

/**
 * `withWhereHas` — run `whereHas` AND eager-load the relation under the
 * same constraint when the adapter implements `withConstrained`. Adapters
 * without it fall back to plain `with(relation)` (constraint applies only
 * to the parent filter, not the eagerly loaded children).
 */
export function attachWithWhereHas<TQ>(
  Parent:    typeof Model,
  q:         QueryBuilder<TQ>,
  relation:  string,
  constrain?: (q: ConstraintQueryBuilder) => void,
): QueryBuilder<TQ> {
  const constraintWheres = constrain ? captureConstraintWheres(constrain) : []
  // Reuse attachWhereHas for the parent-side filter — it re-runs the
  // constrain callback against a fresh recorder, so the WhereClause[] we
  // capture above and the one captured inside attachWhereHas come from
  // distinct recorder instances. That's intentional: each captures the
  // same constraint independently and neither is mutated by the adapter.
  attachWhereHas(Parent, q, relation, true, constrain)
  // Through relations always eager-load via the Model layer's two-hop walk —
  // an adapter's `withConstrained` (Prisma nested `include.where`) can't
  // express the intermediate hop and would target a schema relation that
  // doesn't exist. Fall back to plain with(): the constraint filters the
  // PARENTS; the eagerly loaded children are unconstrained (documented).
  const defType = Parent.relations[relation]?.type
  const isThrough = defType === 'hasOneThrough' || defType === 'hasManyThrough'
  const withConstrained = (q as unknown as { withConstrained?: (rel: string, ws: WhereClause[]) => QueryBuilder<TQ> }).withConstrained
  if (!isThrough && constraintWheres.length > 0 && typeof withConstrained === 'function') {
    return withConstrained.call(q, relation, constraintWheres)
  }
  return q.with(relation)
}

export function attachWhereBelongsTo<TQ>(
  Self:      typeof Model,
  q:         QueryBuilder<TQ>,
  parent:    Model,
  relation?: string,
): QueryBuilder<TQ> {
  const ParentCtor = parent.constructor as typeof Model
  const def        = resolveBelongsToFor(Self, ParentCtor, relation)
  const Related    = def.model() as typeof Model
  const fk         = def.foreignKey ?? `${camelHead(Related.name)}Id`
  const localCol   = def.localKey   ?? fk
  const parentVal  = (parent as unknown as Record<string, unknown>)[ParentCtor.primaryKey]
  if (parentVal === undefined || parentVal === null) {
    throw new Error(
      `[RudderJS ORM] whereBelongsTo: parent.${ParentCtor.primaryKey} is unset on ${ParentCtor.name}.`,
    )
  }
  return q.where(localCol, parentVal)
}
