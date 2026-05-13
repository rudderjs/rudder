import type { QueryBuilder } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../index.js'
import {
  resolveBelongsToManyMeta,
  resolveMorphToManyMeta,
  resolveMorphedByManyMeta,
  type BelongsToManyDef,
  type MorphToManyDef,
  type MorphedByManyDef,
} from './pivot-meta.js'

// ─── Public input + accessor types ─────────────────────────

/**
 * Pivot attach input. Either a flat id list (optional pivot extras written
 * to every new row) or a per-id map keyed by related id.
 */
export type AttachInput =
  | ReadonlyArray<number | string>
  | Record<string | number, Record<string, unknown>>

/**
 * Per-relation accessor for a `belongsToMany` relation. Returned from
 * {@link Model.belongsToMany} and from the auto-generated prototype
 * methods.
 *
 * `attach` writes new pivot rows. `detach` removes pivot rows. `sync`
 * diffs the current pivot ids against the requested set and runs
 * `attach`/`detach` for the difference. `updatePivot` writes new extras
 * onto an existing pivot row without touching either side.
 */
export interface BelongsToManyAccessor {
  /**
   * Insert pivot rows. Accepts a list of ids (with optional flat pivot data
   * applied to every row) or a per-id map keyed by related id with that
   * row's pivot data.
   *
   * Empty input is a no-op — no INSERT, no error.
   */
  attach(input: AttachInput, flatPivot?: Record<string, unknown>): Promise<void>
  /**
   * Delete pivot rows. With ids, deletes only the matching pivot rows.
   * With no args, deletes all pivot rows for this parent.
   */
  detach(ids?: ReadonlyArray<number | string>): Promise<number>
  /**
   * Update extras on an existing pivot row without touching the parent or
   * related row. Locates the pivot row by `(parent, relatedId)` and applies
   * `data`. Returns the number of rows updated (0 when no match — does NOT
   * throw; the caller decides whether absence is an error).
   */
  updatePivot(relatedId: number | string, data: Record<string, unknown>): Promise<number>
  /**
   * Diff the current pivot set against `desiredIds` — attach the missing,
   * detach what's no longer present. Optional flat pivot data is written
   * onto the *new* pivot rows only; existing rows are not modified.
   *
   * The map form (`sync({ id1: { col: val }, id2: { col: val } })`) carries
   * per-id pivot data: `desiredIds = Object.keys(map)`, attached rows go in
   * with their own pivot data, and ids that already exist with changed
   * pivot data go through `updatePivot` to reconcile their extras. The
   * `updated` array on the return value lists those reconciled ids.
   *
   * Returns counts of what changed.
   */
  sync(
    desiredIds: ReadonlyArray<number | string>,
    flatPivot?: Record<string, unknown>,
  ): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }>
  sync(
    perIdPivot: Record<string | number, Record<string, unknown>>,
  ): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }>
}

/**
 * Per-relation accessor for a `morphToMany` relation (parent is the
 * polymorphic side). Same shape as {@link BelongsToManyAccessor} — distinct
 * nominal type so user-defined `tags()` methods can be typed precisely.
 */
export interface MorphToManyAccessor {
  attach(input: AttachInput, flatPivot?: Record<string, unknown>): Promise<void>
  detach(ids?: ReadonlyArray<number | string>): Promise<number>
  /** Update extras on an existing pivot row. Same posture as
   *  {@link BelongsToManyAccessor.updatePivot}; the morph discriminator is
   *  implicitly included in the WHERE clause. */
  updatePivot(relatedId: number | string, data: Record<string, unknown>): Promise<number>
  sync(
    desiredIds: ReadonlyArray<number | string>,
    flatPivot?: Record<string, unknown>,
  ): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }>
  sync(
    perIdPivot: Record<string | number, Record<string, unknown>>,
  ): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }>
}

/**
 * Per-relation accessor for a `morphedByMany` relation (related is the
 * polymorphic side). Identical runtime shape to `MorphToManyAccessor`.
 */
export interface MorphedByManyAccessor {
  attach(input: AttachInput, flatPivot?: Record<string, unknown>): Promise<void>
  detach(ids?: ReadonlyArray<number | string>): Promise<number>
  /** Update extras on an existing pivot row. Same posture as
   *  {@link BelongsToManyAccessor.updatePivot}; the morph discriminator is
   *  implicitly included in the WHERE clause. */
  updatePivot(relatedId: number | string, data: Record<string, unknown>): Promise<number>
  sync(
    desiredIds: ReadonlyArray<number | string>,
    flatPivot?: Record<string, unknown>,
  ): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }>
  sync(
    perIdPivot: Record<string | number, Record<string, unknown>>,
  ): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }>
}

// ─── Input helpers ─────────────────────────────────────────

function normalizeAttachInput(
  input:           AttachInput,
  foreignPivotKey: string,
  parentVal:       unknown,
  relatedPivotKey: string,
  flatPivot?:      Record<string, unknown>,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  if (Array.isArray(input)) {
    for (const id of input) {
      rows.push({
        ...(flatPivot ?? {}),
        [foreignPivotKey]: parentVal,
        [relatedPivotKey]: id,
      })
    }
  } else {
    for (const [id, perIdPivot] of Object.entries(input as Record<string | number, Record<string, unknown>>)) {
      // Normalize numeric-string keys back to numbers when possible — JS
      // object keys are always strings; the pivot column may be int.
      const idVal: unknown = /^\d+$/.test(id) ? Number(id) : id
      rows.push({
        ...perIdPivot,
        [foreignPivotKey]: parentVal,
        [relatedPivotKey]: idVal,
      })
    }
  }
  return rows
}

function idsFromAttachInput(input: AttachInput): unknown[] {
  if (Array.isArray(input)) return [...input]
  return Object.keys(input).map(k => /^\d+$/.test(k) ? Number(k) : k)
}

// ─── Unified pivot accessor factory ────────────────────────

/**
 * Shape shared by all three pivot relation types. The morph variants extend
 * this with `morphTypeKey` / `morphTypeValue`, expressed as the optional
 * `morphConstraint` parameter on {@link makePivotAccessor}.
 */
interface PivotMeta {
  pivotTable:      string
  foreignPivotKey: string
  relatedPivotKey: string
  relatedKey:      string
}

interface MorphConstraint {
  typeColumn: string
  typeValue:  string
}

/**
 * The runtime body of all three accessors. `morphConstraint`, when present,
 * is applied to every pivot read (`detach`, `updatePivot`, `sync` lookup) and
 * stamped onto every pivot write (`attach`, `sync` attach side).
 *
 * Return shape uses the broadest of the three accessor interfaces —
 * `BelongsToManyAccessor` — since the morph variants are structurally
 * identical. Callers narrow the return via the public factories below.
 */
function makePivotAccessor(
  meta:            PivotMeta,
  parentVal:       unknown,
  morphConstraint?: MorphConstraint,
): BelongsToManyAccessor {
  const applyMorphFilter = <Q extends QueryBuilder<Record<string, unknown>>>(q: Q): Q => {
    return morphConstraint
      ? q.where(morphConstraint.typeColumn, morphConstraint.typeValue) as Q
      : q
  }
  const writeMorphCol = (row: Record<string, unknown>): Record<string, unknown> =>
    morphConstraint ? { ...row, [morphConstraint.typeColumn]: morphConstraint.typeValue } : row

  const updatePivot = async (relatedId: number | string, data: Record<string, unknown>): Promise<number> => {
    let q = ModelRegistry.getAdapter()
      .query<Record<string, unknown>>(meta.pivotTable)
      .where(meta.foreignPivotKey, parentVal)
    q = applyMorphFilter(q)
    q = q.where(meta.relatedPivotKey, relatedId)
    return q.updateAll(data)
  }

  return {
    async attach(input, flatPivot) {
      const ids = idsFromAttachInput(input)
      if (ids.length === 0) return
      const rows = normalizeAttachInput(input, meta.foreignPivotKey, parentVal, meta.relatedPivotKey, flatPivot)
        .map(writeMorphCol)
      await ModelRegistry.getAdapter()
        .query<Record<string, unknown>>(meta.pivotTable)
        .insertMany(rows)
    },

    async detach(ids) {
      const adapter = ModelRegistry.getAdapter()
      let q = adapter
        .query<Record<string, unknown>>(meta.pivotTable)
        .where(meta.foreignPivotKey, parentVal)
      q = applyMorphFilter(q)
      if (ids !== undefined) {
        if (ids.length === 0) return 0
        q = q.where(meta.relatedPivotKey, 'IN', [...ids])
      }
      return q.deleteAll()
    },

    updatePivot,

    async sync(
      arg1:      ReadonlyArray<number | string> | Record<string | number, Record<string, unknown>>,
      flatPivot?: Record<string, unknown>,
    ): Promise<{ attached: unknown[]; detached: unknown[]; updated: unknown[] }> {
      const adapter   = ModelRegistry.getAdapter()
      const isMap     = !Array.isArray(arg1)
      const perIdMap  = isMap ? (arg1 as Record<string | number, Record<string, unknown>>) : null
      const desiredIds: unknown[] = isMap
        ? Object.keys(perIdMap!).map(k => /^\d+$/.test(k) ? Number(k) : k)
        : [...(arg1 as ReadonlyArray<number | string>)]

      let lookup = adapter
        .query<Record<string, unknown>>(meta.pivotTable)
        .where(meta.foreignPivotKey, parentVal)
      lookup = applyMorphFilter(lookup)
      const currentRows = await lookup.get()

      const current = new Set(currentRows.map(r => r[meta.relatedPivotKey]))
      const desired = new Set<unknown>(desiredIds)
      const attached: unknown[] = []
      const detached: unknown[] = []
      const updated:  unknown[] = []
      for (const id of desired) if (!current.has(id)) attached.push(id)
      for (const id of current) if (!desired.has(id)) detached.push(id)

      if (attached.length > 0) {
        const rows = attached.map(id => {
          const perIdPivot = perIdMap ? perIdMap[id as string | number] : undefined
          return writeMorphCol({
            ...(flatPivot ?? {}),
            ...(perIdPivot ?? {}),
            [meta.foreignPivotKey]: parentVal,
            [meta.relatedPivotKey]: id,
          })
        })
        await adapter.query<Record<string, unknown>>(meta.pivotTable).insertMany(rows)
      }
      if (detached.length > 0) {
        let del = adapter
          .query<Record<string, unknown>>(meta.pivotTable)
          .where(meta.foreignPivotKey, parentVal)
        del = applyMorphFilter(del)
        del = del.where(meta.relatedPivotKey, 'IN', detached)
        await del.deleteAll()
      }
      if (perIdMap) {
        // Reconcile extras on still-present ids by overwriting with the
        // requested pivot data — matches Filament's posture (the form
        // value wins). Skip when the supplied pivot is empty.
        for (const id of desired) {
          if (!current.has(id)) continue
          const perIdPivot = perIdMap[id as string | number]
          if (!perIdPivot || Object.keys(perIdPivot).length === 0) continue
          await updatePivot(id as number | string, perIdPivot)
          updated.push(id)
        }
      }

      return { attached, detached, updated }
    },
  }
}

// ─── Public factories ──────────────────────────────────────

export function makeBelongsToManyAccessor(
  Parent:    typeof Model,
  Related:   typeof Model,
  def:       BelongsToManyDef,
  parentVal: unknown,
): BelongsToManyAccessor {
  const meta = resolveBelongsToManyMeta(Parent, Related, def)
  return makePivotAccessor(meta, parentVal)
}

export function makeMorphToManyAccessor(
  Parent:    typeof Model,
  Related:   typeof Model,
  def:       MorphToManyDef,
  parentVal: unknown,
): MorphToManyAccessor {
  const meta = resolveMorphToManyMeta(Parent, Related, def)
  return makePivotAccessor(meta, parentVal, {
    typeColumn: meta.morphTypeKey,
    typeValue:  meta.morphTypeValue,
  })
}

export function makeMorphedByManyAccessor(
  Parent:    typeof Model,
  Related:   typeof Model,
  def:       MorphedByManyDef,
  parentVal: unknown,
): MorphedByManyAccessor {
  const meta = resolveMorphedByManyMeta(Parent, Related, def)
  return makePivotAccessor(meta, parentVal, {
    typeColumn: meta.morphTypeKey,
    typeValue:  meta.morphTypeValue,
  })
}

// ─── Prototype-method install hooks ────────────────────────

/**
 * Install per-relation prototype methods for every `belongsToMany` entry
 * declared on `static relations`. Idempotent — won't overwrite a method
 * the author already defined (typing escape hatch).
 *
 * Called on first query (via `ModelRegistry.register`) and once more
 * defensively from `Model.belongsToMany` so apps that construct instances
 * without ever querying still get the auto-method.
 */
export function installBelongsToManyMethods(ModelClass: typeof Model): void {
  for (const [name, def] of Object.entries(ModelClass.relations)) {
    if (def.type !== 'belongsToMany') continue
    if (Object.prototype.hasOwnProperty.call(ModelClass.prototype, name)) continue
    Object.defineProperty(ModelClass.prototype, name, {
      configurable: true,
      writable:     true,
      value(this: Model): BelongsToManyAccessor {
        return Model.belongsToMany(this, name)
      },
    })
  }
}

/**
 * Install per-relation prototype methods for every `morphToMany` /
 * `morphedByMany` entry. Same idempotent shape as
 * {@link installBelongsToManyMethods}.
 */
export function installMorphPivotMethods(ModelClass: typeof Model): void {
  for (const [name, def] of Object.entries(ModelClass.relations)) {
    if (def.type !== 'morphToMany' && def.type !== 'morphedByMany') continue
    if (Object.prototype.hasOwnProperty.call(ModelClass.prototype, name)) continue
    const isOwning = def.type === 'morphToMany'
    Object.defineProperty(ModelClass.prototype, name, {
      configurable: true,
      writable:     true,
      value(this: Model): MorphToManyAccessor | MorphedByManyAccessor {
        return isOwning
          ? Model.morphToMany(this, name)
          : Model.morphedByMany(this, name)
      },
    })
  }
}
