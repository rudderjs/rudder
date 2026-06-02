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

/**
 * Variant shape of `RelationDefinition` for `hasOne | hasMany | belongsTo`.
 * Those three live in a single union member with a literal-union `type`
 * field, so `Extract<RelationDefinition, { type: 'belongsTo' }>` evaluates
 * to `never` (the wider literal union doesn't extend the narrower one). We
 * model the merged variant explicitly and runtime-check `type === 'belongsTo'`.
 */
export type HasOrBelongsToDef = Exclude<
  RelationDefinition,
  { type: 'belongsToMany' | 'morphMany' | 'morphOne' | 'morphTo' | 'morphToMany' | 'morphedByMany' }
>

// ─── Constraint capture ────────────────────────────────────

/**
 * Run the constrain callback against a recording-only QueryBuilder that
 * captures `.where()` calls into a flat `WhereClause[]` and treats every
 * other chainable method as a no-op. Nested `whereHas` inside the callback
 * throws — recursive predicates are deferred to v2.
 */
export function captureConstraintWheres(
  constrain: (q: QueryBuilder<Model>) => void,
): WhereClause[] {
  const wheres: WhereClause[] = []
  const recorder: QueryBuilder<Model> = new Proxy({} as QueryBuilder<Model>, {
    get(_t, prop): unknown {
      const name = String(prop)
      if (name === 'where') {
        return (col: string, opOrVal: unknown, maybeVal?: unknown): QueryBuilder<Model> => {
          if (maybeVal === undefined) {
            wheres.push({ column: col, operator: '=', value: opOrVal })
          } else {
            wheres.push({ column: col, operator: opOrVal as WhereOperator, value: maybeVal })
          }
          return recorder
        }
      }
      if (name === 'whereHas' || name === 'whereDoesntHave' || name === 'withWhereHas') {
        return (): QueryBuilder<Model> => {
          throw new Error(
            `[RudderJS ORM] Nested ${name} inside a whereHas constrain callback is deferred to v2. ` +
            `Filter on flat columns inside the callback for now.`,
          )
        }
      }
      if (name === 'orWhere') {
        return (): QueryBuilder<Model> => {
          throw new Error(
            `[RudderJS ORM] orWhere inside a whereHas constrain callback is not supported in v1 — ` +
            `the WhereClause contract has no boolean flag, so the OR semantic can't round-trip to the adapter. ` +
            `Compose the predicate with where() (AND), or run two queries and merge in app code.`,
          )
        }
      }
      // All other chainable methods record nothing and return the recorder so
      // `q.orderBy('x').limit(1)` chains through silently. Terminal methods
      // (find/get/etc.) don't make sense in a constrain callback — they'd
      // execute mid-build — but we don't intercept them here; they'd just
      // return the recorder which then fails downstream. Keep the contract
      // simple.
      return (): QueryBuilder<Model> => recorder
    },
  })
  constrain(recorder)
  return wheres
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
  const fk       = def.foreignKey ?? `${camelHead(Parent.name)}Id`
  const localCol = def.localKey   ?? Parent.primaryKey
  return {
    relation,
    exists,
    relatedTable:  Related.getTable(),
    parentColumn:  localCol,
    relatedColumn: fk,
    constraintWheres,
  }
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
  constrain?: (q: QueryBuilder<Model>) => void,
  opts?:     { boolean?: 'AND' | 'OR'; count?: { operator: WhereOperator; value: number } },
): QueryBuilder<TQ> {
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
  constrain?: (q: QueryBuilder<Model>) => void,
): QueryBuilder<TQ> {
  const constraintWheres = constrain ? captureConstraintWheres(constrain) : []
  // Reuse attachWhereHas for the parent-side filter — it re-runs the
  // constrain callback against a fresh recorder, so the WhereClause[] we
  // capture above and the one captured inside attachWhereHas come from
  // distinct recorder instances. That's intentional: each captures the
  // same constraint independently and neither is mutated by the adapter.
  attachWhereHas(Parent, q, relation, true, constrain)
  const withConstrained = (q as unknown as { withConstrained?: (rel: string, ws: WhereClause[]) => QueryBuilder<TQ> }).withConstrained
  if (constraintWheres.length > 0 && typeof withConstrained === 'function') {
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
