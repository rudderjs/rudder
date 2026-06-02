/**
 * Direct-relation eager-load — Model-layer resolution for adapters whose
 * `eagerLoadStrategy` is `'model-layer'` (e.g. Drizzle).
 *
 * Prisma resolves `Model.with('posts')` natively via `include` because its
 * adapter holds the schema relation graph. Drizzle's adapter holds only table
 * schemas (`DrizzleTableRegistry`), not the `relations()` graph its relational
 * query API needs — so its `QueryBuilder.with()` can't resolve a direct
 * relation. The ORM's real relation metadata (foreign key, direction, type)
 * lives in the Model layer on `static relations`, which is exactly what this
 * module reads.
 *
 * Resolution mirrors the polymorphic loader (`./polymorphic-eager-load.ts`):
 * after the adapter terminal returns hydrated parents, fire one batched
 * `WHERE … IN` query per relation against the related model and stitch the
 * results onto each parent. Foreign-key conventions match the lazy
 * `instance.related()` accessor exactly, so eager and lazy loads agree.
 *
 * Covered: `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`, `hasOneThrough`,
 * `hasManyThrough` (the last two always route here regardless of adapter
 * strategy — see `isThrough` in the partition). Polymorphic
 * relations never reach here (the partition sends them to
 * `attachPolymorphicRelations`). Nested names (`'a.b'`) and undeclared relations
 * throw a clear error — nested eager loading is deferred to a later pass.
 */

import type { QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry, type RelationDefinition } from './index.js'
import { camelHead } from './utils.js'
import { resolveBelongsToManyMeta } from './relations/pivot-meta.js'
import { collectIds, uniq, setDefault } from './polymorphic-eager-load.js'
import { attachHasThrough } from './relations/has-through.js'

/**
 * For each direct relation in `names`, batch-load the related rows and attach
 * them to each parent instance. Empty parent/name set short-circuits.
 *
 * @throws when a name is not declared on `static relations`, or names a
 *   relation type this loader doesn't handle (polymorphic types are resolved
 *   elsewhere; nested `'a.b'` names are undeclared, so they hit the same throw).
 */
export async function attachDirectRelations(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  names:       readonly string[],
): Promise<void> {
  if (parents.length === 0 || names.length === 0) return
  for (const name of names) {
    const def = ParentClass.relations[name]
    if (!def) {
      throw new Error(
        `[RudderJS ORM] Cannot eager-load "${name}" on ${ParentClass.name} — ` +
        `no relation named "${name}" is declared on static relations. ` +
        `(Nested eager loads like 'a.b' are not supported yet — load the ` +
        `intermediate relation, then the next level.)`,
      )
    }
    switch (def.type) {
      case 'belongsTo':
        await attachBelongsTo(ParentClass, parents, name, def)
        break
      case 'hasOne':
        await attachHasOneOrMany(ParentClass, parents, name, def, 'one')
        break
      case 'hasMany':
        await attachHasOneOrMany(ParentClass, parents, name, def, 'many')
        break
      case 'belongsToMany':
        await attachBelongsToMany(ParentClass, parents, name, def)
        break
      case 'hasOneThrough':
      case 'hasManyThrough':
        await attachHasThrough(ParentClass, parents, name, def)
        break
      default:
        // Polymorphic types are routed to attachPolymorphicRelations by the
        // partition, so they should never arrive here.
        throw new Error(
          `[RudderJS ORM] Eager-loading relation type "${def.type}" ("${name}" ` +
          `on ${ParentClass.name}) is not supported by the model-layer loader.`,
        )
    }
  }
}

// ─── belongsTo ─────────────────────────────────────────────────────────────

// `hasOne` / `hasMany` / `belongsTo` share one union member, so they can't be
// `Extract`ed apart by a single literal — match the shared shape (as pivot-meta
// does for morphOne/morphMany).
type SimpleRelationDef = Extract<RelationDefinition, { type: 'hasOne' | 'hasMany' | 'belongsTo' }>

async function attachBelongsTo(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  name:        string,
  def:         SimpleRelationDef,
): Promise<void> {
  const Related  = def.model()
  // This model holds the FK; it points at the related model's PK.
  const fk       = def.foreignKey ?? `${camelHead(Related.name)}Id`
  const localCol = def.localKey   ?? fk
  const relatedKey = Related.primaryKey

  const ids = collectIds(parents, localCol)
  if (ids.length === 0) {
    setDefault(parents, name, 'one')
    return
  }

  const rows = await (Related.query() as QueryBuilder<Model>)
    .where(relatedKey, 'IN', ids)
    .get()

  const byKey = new Map<unknown, Model>()
  for (const r of rows) byKey.set((r as unknown as Record<string, unknown>)[relatedKey], r)

  for (const parent of parents) {
    const fkVal = (parent as unknown as Record<string, unknown>)[localCol]
    ;(parent as unknown as Record<string, unknown>)[name] = byKey.get(fkVal) ?? null
  }
}

// ─── hasOne / hasMany ──────────────────────────────────────────────────────

async function attachHasOneOrMany(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  name:        string,
  def:         SimpleRelationDef,
  cardinality: 'one' | 'many',
): Promise<void> {
  const Related  = def.model()
  // Related model holds the FK pointing back at this model's local key.
  const fk       = def.foreignKey ?? `${camelHead(ParentClass.name)}Id`
  const localCol = def.localKey   ?? ParentClass.primaryKey

  const ids = collectIds(parents, localCol)
  if (ids.length === 0) {
    setDefault(parents, name, cardinality)
    return
  }

  const rows = await (Related.query() as QueryBuilder<Model>)
    .where(fk, 'IN', ids)
    .get()

  const byKey = new Map<unknown, Model[]>()
  for (const r of rows) {
    const k = (r as unknown as Record<string, unknown>)[fk]
    const list = byKey.get(k)
    if (list) list.push(r); else byKey.set(k, [r])
  }

  for (const parent of parents) {
    const k = (parent as unknown as Record<string, unknown>)[localCol]
    const list = byKey.get(k) ?? []
    ;(parent as unknown as Record<string, unknown>)[name] =
      cardinality === 'many' ? list : (list[0] ?? null)
  }
}

// ─── belongsToMany ─────────────────────────────────────────────────────────

type BelongsToManyDef = Extract<RelationDefinition, { type: 'belongsToMany' }>

async function attachBelongsToMany(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  name:        string,
  def:         BelongsToManyDef,
): Promise<void> {
  const Related   = def.model()
  const meta      = resolveBelongsToManyMeta(ParentClass, Related, def)
  const parentIds = collectIds(parents, meta.parentKey)
  if (parentIds.length === 0) {
    setDefault(parents, name, 'many')
    return
  }

  // Step 1 — pivot rows linking these parents to related rows.
  const adapter = ModelRegistry.getAdapter()
  const pivotRows = await adapter
    .query<Record<string, unknown>>(meta.pivotTable)
    .where(meta.foreignPivotKey, 'IN', parentIds)
    .get()

  if (pivotRows.length === 0) {
    setDefault(parents, name, 'many')
    return
  }

  // Step 2 — the related rows referenced by those pivots.
  const relatedIds  = uniq(pivotRows.map(r => r[meta.relatedPivotKey]))
  const relatedRows = await (Related.query() as QueryBuilder<Model>)
    .where(meta.relatedKey, 'IN', relatedIds)
    .get()
  const relatedByKey = new Map<unknown, Model>()
  for (const r of relatedRows) relatedByKey.set((r as unknown as Record<string, unknown>)[meta.relatedKey], r)

  const byParent = new Map<unknown, Model[]>()
  for (const p of pivotRows) {
    const rel = relatedByKey.get(p[meta.relatedPivotKey])
    if (!rel) continue
    const parentVal = p[meta.foreignPivotKey]
    const list = byParent.get(parentVal)
    if (list) list.push(rel); else byParent.set(parentVal, [rel])
  }
  for (const parent of parents) {
    const k = (parent as unknown as Record<string, unknown>)[meta.parentKey]
    ;(parent as unknown as Record<string, unknown>)[name] = byParent.get(k) ?? []
  }
}
