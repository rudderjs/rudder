/**
 * Polymorphic eager-load — Model-layer fix
 *
 * `Model.with(...names)` historically forwarded names straight to the adapter.
 * That works for direct relations (Prisma's `include`, Drizzle's `with`) but
 * **breaks for polymorphic relations** (`morphMany` / `morphOne` / `morphTo` /
 * `morphToMany` / `morphedByMany`) — those have no FK declared in the
 * underlying schema, so the adapter can't represent them and Prisma rejects.
 *
 * This module resolves polymorphic eager-loads in the Model layer:
 *
 *   1. `partitionEagerLoads()` splits the requested names into adapter-handled
 *      (direct) vs Model-layer (polymorphic) sets.
 *   2. `attachPolymorphicRelations()` runs **after** the adapter terminal
 *      returns hydrated parent instances and, for each polymorphic relation,
 *      fires one batched IN-query (or two for pivot-mediated shapes) and
 *      attaches the results to each parent.
 *
 * Both adapters benefit automatically — there is no contract change.
 *
 * See `docs/plans/2026-05-18-polymorphic-eager-load.md` for the design
 * rationale and per-shape resolution rules.
 */

import type { QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry, type RelationDefinition } from './index.js'
import {
  resolveMorphToManyMeta,
  resolveMorphedByManyMeta,
  type MorphToManyDef,
  type MorphedByManyDef,
} from './relations/pivot-meta.js'

// ─── Relation-type predicates ──────────────────────────────────────────────

const POLY_TYPES = new Set([
  'morphMany', 'morphOne', 'morphTo', 'morphToMany', 'morphedByMany',
])

export function isPolymorphic(def: RelationDefinition | undefined): boolean {
  return def !== undefined && POLY_TYPES.has(def.type)
}

// ─── Partition ─────────────────────────────────────────────────────────────

export interface PartitionedEagerLoads {
  /** Names the adapter handles natively (direct relations on a `'native'`
   *  adapter, plus unknown names that the adapter surfaces its own error for). */
  adapter:     string[]
  /** Polymorphic names — always resolved in the Model layer via batched
   *  IN-queries (`attachPolymorphicRelations`). */
  polymorphic: string[]
  /** Direct relations (`hasOne`/`hasMany`/`belongsTo`/`belongsToMany`) the
   *  Model layer resolves via batched IN-queries (`attachDirectRelations`).
   *  Populated only when the active adapter's `eagerLoadStrategy` is
   *  `'model-layer'` (e.g. Drizzle); empty for `'native'` adapters (Prisma),
   *  whose direct relations go to {@link PartitionedEagerLoads.adapter}. */
  direct:      string[]
}

/**
 * Split requested eager-load names into the three resolution lanes.
 *
 * `strategy` is the active adapter's {@link OrmAdapter.eagerLoadStrategy}:
 * `'native'` (default) sends direct relations to the adapter; `'model-layer'`
 * routes them into the Model-layer batched loader alongside polymorphic ones.
 */
export function partitionEagerLoads(
  ParentClass: typeof Model,
  names:       readonly string[],
  strategy:    'native' | 'model-layer' = 'native',
): PartitionedEagerLoads {
  const adapter:     string[] = []
  const polymorphic: string[] = []
  const direct:      string[] = []
  for (const name of names) {
    const def = ParentClass.relations[name]
    if (isPolymorphic(def)) {
      polymorphic.push(name)
    } else if (strategy === 'model-layer') {
      // Drizzle-style adapters can't resolve direct relations from schema
      // metadata, so the Model layer batches them. Unknown names land here too
      // and `attachDirectRelations` throws a clear "no relation declared" error.
      direct.push(name)
    } else {
      // Native adapters resolve direct relations themselves; unknown relations
      // also forward (Prisma surfaces its own clear error for unknown names).
      adapter.push(name)
    }
  }
  return { adapter, polymorphic, direct }
}

// ─── Attach (after terminal call returns hydrated instances) ────────────────

/**
 * For each polymorphic relation in `names`, fire batched queries against the
 * related table(s) and attach the results to each parent instance.
 *
 * Single query per relation for `morphOne`/`morphMany`. Two queries for
 * `morphToMany`/`morphedByMany` (pivot + related). `morphTo` fires one query
 * per distinct discriminator value present in the parent set.
 *
 * Empty parent set short-circuits — no queries fired.
 */
export async function attachPolymorphicRelations(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  names:       readonly string[],
): Promise<void> {
  if (parents.length === 0 || names.length === 0) return
  for (const name of names) {
    const def = ParentClass.relations[name]
    if (!def) continue
    switch (def.type) {
      case 'morphMany':
        await attachMorphChildren(ParentClass, parents, name, def, 'many')
        break
      case 'morphOne':
        await attachMorphChildren(ParentClass, parents, name, def, 'one')
        break
      case 'morphTo':
        await attachMorphTo(ParentClass, parents, name, def)
        break
      case 'morphToMany':
        await attachMorphToMany(ParentClass, parents, name, def)
        break
      case 'morphedByMany':
        await attachMorphedByMany(ParentClass, parents, name, def)
        break
      default:
        // Non-polymorphic — shouldn't reach here if the partition was correct;
        // skip silently for defense.
        break
    }
  }
}

// ─── morphOne / morphMany ──────────────────────────────────────────────────

type MorphParentDef = Extract<RelationDefinition, { type: 'morphMany' | 'morphOne' }>

async function attachMorphChildren(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  name:        string,
  def:         MorphParentDef,
  cardinality: 'one' | 'many',
): Promise<void> {
  const Related   = def.model()
  const parentKey = def.localKey ?? ParentClass.primaryKey
  const idCol     = `${def.morphName}Id`
  const typeCol   = `${def.morphName}Type`
  const morphType = def.morphType ?? ParentClass.morphAlias ?? ParentClass.name

  const parentIds = collectIds(parents, parentKey)
  if (parentIds.length === 0) {
    setDefault(parents, name, cardinality)
    return
  }

  const children = await (Related.query() as QueryBuilder<Model>)
    .where(idCol,   'IN', parentIds)
    .where(typeCol, morphType)
    .get()

  const byParent = new Map<unknown, Model[]>()
  for (const child of children) {
    const k = (child as unknown as Record<string, unknown>)[idCol]
    const list = byParent.get(k)
    if (list) list.push(child); else byParent.set(k, [child])
  }
  for (const parent of parents) {
    const k = (parent as unknown as Record<string, unknown>)[parentKey]
    const list = byParent.get(k) ?? []
    ;(parent as unknown as Record<string, unknown>)[name] =
      cardinality === 'many' ? list : (list[0] ?? null)
  }
}

// ─── morphTo ───────────────────────────────────────────────────────────────

type MorphToDef = Extract<RelationDefinition, { type: 'morphTo' }>

async function attachMorphTo(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  name:        string,
  def:         MorphToDef,
): Promise<void> {
  const idCol   = `${def.morphName}Id`
  const typeCol = `${def.morphName}Type`
  const targets = def.types()
  if (targets.length === 0) {
    throw new Error(
      `[RudderJS ORM] morphTo "${name}" on ${ParentClass.name}: ` +
      "`types: () => [...]` is empty — declare at least one allowed target class.",
    )
  }

  // Group parent rows by their discriminator value so we fire one query per
  // distinct target class instead of one per parent.
  const byType = new Map<string, Model[]>()
  for (const parent of parents) {
    const t = (parent as unknown as Record<string, unknown>)[typeCol]
    if (t === undefined || t === null) {
      ;(parent as unknown as Record<string, unknown>)[name] = null
      continue
    }
    const key = String(t)
    const bucket = byType.get(key)
    if (bucket) bucket.push(parent); else byType.set(key, [parent])
  }

  for (const [typeKey, group] of byType) {
    const Target = targets.find(C => (C.morphAlias ?? C.name) === typeKey)
    if (!Target) {
      throw new Error(
        `[RudderJS ORM] morphTo "${name}" on ${ParentClass.name}: ` +
        `unknown ${typeCol} = ${JSON.stringify(typeKey)}. ` +
        `Allowed: ${targets.map(C => C.morphAlias ?? C.name).join(', ')}`,
      )
    }
    const ids = group
      .map(p => (p as unknown as Record<string, unknown>)[idCol])
      .filter(v => v !== undefined && v !== null)
    if (ids.length === 0) {
      for (const p of group) (p as unknown as Record<string, unknown>)[name] = null
      continue
    }
    const rows = await (Target.query() as QueryBuilder<Model>)
      .where(Target.primaryKey, 'IN', ids)
      .get()
    const byPk = new Map<unknown, Model>()
    for (const r of rows) byPk.set((r as unknown as Record<string, unknown>)[Target.primaryKey], r)
    for (const parent of group) {
      const fk = (parent as unknown as Record<string, unknown>)[idCol]
      ;(parent as unknown as Record<string, unknown>)[name] = byPk.get(fk) ?? null
    }
  }
}

// ─── morphToMany ───────────────────────────────────────────────────────────

async function attachMorphToMany(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  name:        string,
  def:         MorphToManyDef,
): Promise<void> {
  const Related = def.model()
  const meta    = resolveMorphToManyMeta(ParentClass, Related, def)
  const parentIds = collectIds(parents, meta.parentKey)
  if (parentIds.length === 0) {
    for (const p of parents) (p as unknown as Record<string, unknown>)[name] = []
    return
  }

  // Step 1 — pivot rows for these parents under this morph alias.
  const adapter = ModelRegistry.getAdapter()
  const pivotRows = await adapter
    .query<Record<string, unknown>>(meta.pivotTable)
    .where(meta.foreignPivotKey, 'IN', parentIds)
    .where(meta.morphTypeKey,    meta.morphTypeValue)
    .get()

  if (pivotRows.length === 0) {
    for (const p of parents) (p as unknown as Record<string, unknown>)[name] = []
    return
  }

  const relatedIds = uniq(pivotRows.map(r => r[meta.relatedPivotKey]))
  const relatedRows = await (Related.query() as QueryBuilder<Model>)
    .where(meta.relatedKey, 'IN', relatedIds)
    .get()
  const relatedByKey = new Map<unknown, Model>()
  for (const r of relatedRows) relatedByKey.set((r as unknown as Record<string, unknown>)[meta.relatedKey], r)

  // Group pivot rows by parent id, project to related models.
  const byParent = new Map<unknown, Model[]>()
  for (const p of pivotRows) {
    const parentVal  = p[meta.foreignPivotKey]
    const relatedVal = p[meta.relatedPivotKey]
    const rel = relatedByKey.get(relatedVal)
    if (!rel) continue
    const list = byParent.get(parentVal)
    if (list) list.push(rel); else byParent.set(parentVal, [rel])
  }
  for (const parent of parents) {
    const k = (parent as unknown as Record<string, unknown>)[meta.parentKey]
    ;(parent as unknown as Record<string, unknown>)[name] = byParent.get(k) ?? []
  }
}

// ─── morphedByMany ─────────────────────────────────────────────────────────

async function attachMorphedByMany(
  ParentClass: typeof Model,
  parents:     ReadonlyArray<Model>,
  name:        string,
  def:         MorphedByManyDef,
): Promise<void> {
  const Related = def.model()
  const meta    = resolveMorphedByManyMeta(ParentClass, Related, def)
  const parentIds = collectIds(parents, meta.parentKey)
  if (parentIds.length === 0) {
    for (const p of parents) (p as unknown as Record<string, unknown>)[name] = []
    return
  }

  // Pivot lookup — parent is the strong side, related is the polymorphic side.
  // Filter by the related class's discriminator stored in {morphName}Type.
  const adapter = ModelRegistry.getAdapter()
  const pivotRows = await adapter
    .query<Record<string, unknown>>(meta.pivotTable)
    .where(meta.foreignPivotKey, 'IN', parentIds)
    .where(meta.morphTypeKey,    meta.morphTypeValue)
    .get()

  if (pivotRows.length === 0) {
    for (const p of parents) (p as unknown as Record<string, unknown>)[name] = []
    return
  }

  const relatedIds = uniq(pivotRows.map(r => r[meta.relatedPivotKey]))
  const relatedRows = await (Related.query() as QueryBuilder<Model>)
    .where(meta.relatedKey, 'IN', relatedIds)
    .get()
  const relatedByKey = new Map<unknown, Model>()
  for (const r of relatedRows) relatedByKey.set((r as unknown as Record<string, unknown>)[meta.relatedKey], r)

  const byParent = new Map<unknown, Model[]>()
  for (const p of pivotRows) {
    const parentVal  = p[meta.foreignPivotKey]
    const relatedVal = p[meta.relatedPivotKey]
    const rel = relatedByKey.get(relatedVal)
    if (!rel) continue
    const list = byParent.get(parentVal)
    if (list) list.push(rel); else byParent.set(parentVal, [rel])
  }
  for (const parent of parents) {
    const k = (parent as unknown as Record<string, unknown>)[meta.parentKey]
    ;(parent as unknown as Record<string, unknown>)[name] = byParent.get(k) ?? []
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** @internal — distinct, non-null values of `key` across the parent set.
 *  Shared with `attachDirectRelations`. */
export function collectIds(parents: ReadonlyArray<Model>, key: string): unknown[] {
  const seen = new Set<unknown>()
  const out:  unknown[] = []
  for (const p of parents) {
    const v = (p as unknown as Record<string, unknown>)[key]
    if (v === undefined || v === null) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/** @internal — order-preserving dedupe. Shared with `attachDirectRelations`. */
export function uniq<T>(xs: ReadonlyArray<T>): T[] {
  const seen = new Set<T>()
  const out:  T[] = []
  for (const v of xs) {
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

/** @internal — assign the empty default (`[]` for many, `null` for one) to
 *  every parent. Shared with `attachDirectRelations`. */
export function setDefault(parents: ReadonlyArray<Model>, name: string, cardinality: 'one' | 'many'): void {
  const v = cardinality === 'many' ? [] : null
  for (const p of parents) (p as unknown as Record<string, unknown>)[name] = v
}
