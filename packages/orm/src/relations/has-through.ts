/**
 * `hasOneThrough` / `hasManyThrough` — reach a distant relation through an
 * intermediate model. `Country → hasManyThrough(Post, User)` walks
 * `countries.id = users.countryId` then `users.id = posts.userId`.
 *
 * Both the lazy `related()` accessor (via `hasThroughDeferredQb` in
 * `./pivot-deferred.ts`) and the eager Model-layer loader (`attachHasThrough`)
 * resolve the two hops with batched `WHERE … IN` queries — no join SQL — so the
 * relation works on every adapter with no contract/adapter change, exactly like
 * the `belongsToMany` pivot path.
 */

import type { QueryBuilder } from '@rudderjs/contracts'
import { Model, type RelationDefinition } from '../index.js'
import { camelHead } from '../utils.js'
import { collectIds, uniq, setDefault } from '../polymorphic-eager-load.js'

export type HasThroughDef = Extract<RelationDefinition, { type: 'hasOneThrough' | 'hasManyThrough' }>

export interface HasThroughMeta {
  Related:        typeof Model
  Through:        typeof Model
  /** FK on the through table pointing at the parent (`users.countryId`). */
  firstKey:       string
  /** FK on the related table pointing at the through row (`posts.userId`). */
  secondKey:      string
  /** Local key on the parent (`countries.id`). */
  localKey:       string
  /** Local key on the through model (`users.id`). */
  secondLocalKey: string
  /** `true` for `hasOneThrough` (single-row result), `false` for many. */
  one:            boolean
}

/** Resolve the four through keys, defaulting by Laravel convention. */
export function resolveHasThroughMeta(Parent: typeof Model, def: HasThroughDef): HasThroughMeta {
  const Related = def.model()
  const Through = def.through()
  return {
    Related,
    Through,
    firstKey:       def.firstKey       ?? `${camelHead(Parent.name)}Id`,
    secondKey:      def.secondKey      ?? `${camelHead(Through.name)}Id`,
    localKey:       def.localKey       ?? Parent.primaryKey,
    secondLocalKey: def.secondLocalKey ?? Through.primaryKey,
    one:            def.type === 'hasOneThrough',
  }
}

/**
 * Eager-load a through relation onto a set of parents. Two batched queries:
 * the through rows linking parents → through keys, then the related rows
 * referenced by those through keys. Stitches results back per parent. Mirrors
 * `attachBelongsToMany`'s two-hop shape.
 */
export async function attachHasThrough(
  Parent:  typeof Model,
  parents: ReadonlyArray<Model>,
  name:    string,
  def:     HasThroughDef,
): Promise<void> {
  const meta = resolveHasThroughMeta(Parent, def)
  const cardinality = meta.one ? 'one' : 'many'

  const parentIds = collectIds(parents, meta.localKey)
  if (parentIds.length === 0) {
    setDefault(parents, name, cardinality)
    return
  }

  // Step 1 — through rows linking these parents to through keys. Keep the parent
  // FK so we can fan related rows back out to the right parent.
  const throughRows = await (meta.Through.query() as QueryBuilder<Model>)
    .where(meta.firstKey, 'IN', parentIds)
    .get()
  if (throughRows.length === 0) {
    setDefault(parents, name, cardinality)
    return
  }

  // through local key → the parent FK value it belongs to.
  const throughToParent = new Map<unknown, unknown>()
  for (const t of throughRows) {
    const rec = t as unknown as Record<string, unknown>
    throughToParent.set(rec[meta.secondLocalKey], rec[meta.firstKey])
  }

  // Step 2 — related rows referenced by those through keys.
  const throughKeys = uniq(throughRows.map(t => (t as unknown as Record<string, unknown>)[meta.secondLocalKey]))
  const relatedRows = await (meta.Related.query() as QueryBuilder<Model>)
    .where(meta.secondKey, 'IN', throughKeys)
    .get()

  // Bucket related rows by parent FK value (via the through key → parent map).
  const byParent = new Map<unknown, Model[]>()
  for (const r of relatedRows) {
    const throughKey = (r as unknown as Record<string, unknown>)[meta.secondKey]
    const parentVal  = throughToParent.get(throughKey)
    if (parentVal === undefined) continue
    const list = byParent.get(parentVal)
    if (list) list.push(r); else byParent.set(parentVal, [r])
  }

  for (const parent of parents) {
    const k = (parent as unknown as Record<string, unknown>)[meta.localKey]
    const list = byParent.get(k) ?? []
    ;(parent as unknown as Record<string, unknown>)[name] =
      meta.one ? (list[0] ?? null) : list
  }
}
