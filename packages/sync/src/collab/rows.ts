/**
 * Row-array collab bindings for `@rudderjs/sync`.
 *
 * The field bindings in {@link ./bindings.ts} cover scalar / text / flat-array /
 * map field types — but not an **array of records**: a repeater, an editable
 * table, a list of objects, where each row needs stable identity across
 * concurrent edits and clean reorder/move. Yjs has no native move primitive on
 * `Y.Array`, and the delete-then-insert workaround on the data array destroys
 * the moved row's CRDT identity (its per-field merge history). So this module
 * keeps the same hybrid shape every app re-derives by hand: **decouple data from
 * order**.
 *
 *   - `row-data`  — top-level `Y.Map<arrayName, Y.Map<rowId, Y.Map<field, value>>>`.
 *     Each row is a `Y.Map` keyed by a stable id (a UUID for a fresh row, the DB
 *     primary key for a relationship-backed one). A row map is attached once and
 *     **never moves** — so a row keeps its identity for the document's lifetime.
 *   - `row-order` — top-level `Y.Map<arrayName, Y.Array<rowId>>`. Only this order
 *     array changes on reorder: a move is a delete+insert of the plain `rowId`
 *     **string** in the order array, which is lossless because the row's data map
 *     stays put. Non-text field values use whole-value LWW on the row map.
 *
 * Persisted transparently alongside the existing `fields` Y.Map (same Y.Doc, same
 * transport) — no schema or sync-server change. The contract is duck-typed: a
 * plain `Y.Doc` in, plain JS rows out, no `@rudderjs/orm` and no form layer.
 *
 * Yjs is imported at runtime here (not type-only like `bindings.ts`) because
 * creating the nested `Y.Map` / `Y.Array` shares needs the constructors. Yjs is a
 * browser CRDT library, so the module stays safe to evaluate in a client bundle
 * (the `useCollabRows` hook reaches it).
 */

import * as Y from 'yjs'

/** Top-level `Y.Map` holding every row array's per-row data, keyed by array name. */
export const ROW_DATA_MAP = 'row-data'
/** Top-level `Y.Map` holding every row array's order, keyed by array name. */
export const ROW_ORDER_MAP = 'row-order'

/**
 * A row read out of the CRDT: its stable `id` plus the plain-JS projection of its
 * field map. `id` is reserved — a field literally named `id` on the row map is
 * shadowed by the row's stable id in the returned object.
 */
export type CollabRow<T = Record<string, unknown>> = T & { id: string }

/** Options shared by the mutating primitives — tag the transaction with `origin`. */
export interface RowMutateOptions {
  /** Transaction origin, so observers can filter framework-originated writes. */
  origin?: unknown
}

/** Generate a stable row id. Uses the platform `crypto.randomUUID` (Node ≥ 19,
 *  every modern browser). Exposed so callers can pre-allocate an id if needed. */
export function newRowId(): string {
  return globalThis.crypto.randomUUID()
}

/** Read the order `Y.Array<rowId>` for an array, or `null` when none exists yet.
 *  Read-only: never creates the share (so a bare read doesn't mutate the doc). */
function orderArray(doc: Y.Doc, arrayName: string): Y.Array<string> | null {
  const root = doc.getMap(ROW_ORDER_MAP)
  const arr = root.get(arrayName)
  return arr instanceof Y.Array ? (arr as Y.Array<string>) : null
}

/** Read the data `Y.Map<rowId, Y.Map>` for an array, or `null` when none exists
 *  yet. Read-only: never creates the share. */
function dataMap(doc: Y.Doc, arrayName: string): Y.Map<Y.Map<unknown>> | null {
  const root = doc.getMap(ROW_DATA_MAP)
  const m = root.get(arrayName)
  return m instanceof Y.Map ? (m as Y.Map<Y.Map<unknown>>) : null
}

/** Ensure both shares exist for an array, creating them if absent. Must run
 *  inside a transaction (every caller does). Returns the live shares. */
function ensureShares(
  doc: Y.Doc,
  arrayName: string,
): { order: Y.Array<string>; data: Y.Map<Y.Map<unknown>> } {
  const orderRoot = doc.getMap(ROW_ORDER_MAP)
  let order = orderRoot.get(arrayName)
  if (!(order instanceof Y.Array)) {
    order = new Y.Array<string>()
    orderRoot.set(arrayName, order)
  }
  const dataRoot = doc.getMap(ROW_DATA_MAP)
  let data = dataRoot.get(arrayName)
  if (!(data instanceof Y.Map)) {
    data = new Y.Map<Y.Map<unknown>>()
    dataRoot.set(arrayName, data)
  }
  return { order: order as Y.Array<string>, data: data as Y.Map<Y.Map<unknown>> }
}

/** Project a single row `Y.Map` to a plain object, stamping its stable id last
 *  so the reserved `id` always wins over any field of the same name. */
function projectRow<T>(id: string, row: Y.Map<unknown>): CollabRow<T> {
  return { ...(row.toJSON() as T), id }
}

/**
 * Read every row of an array in order, each projected to a plain JS object with
 * its stable `id`. Order entries whose data map is missing (a dangling id from a
 * concurrent remove) are skipped — the order array is the source of truth for
 * which rows exist and in what sequence. Returns `[]` when the array is unset.
 */
export function readRows<T = Record<string, unknown>>(
  doc: Y.Doc,
  arrayName: string,
): CollabRow<T>[] {
  const order = orderArray(doc, arrayName)
  if (!order || order.length === 0) return []
  const data = dataMap(doc, arrayName)
  if (!data) return []

  const rows: CollabRow<T>[] = []
  for (const id of order.toArray()) {
    const row = data.get(id)
    if (row instanceof Y.Map) rows.push(projectRow<T>(id, row))
  }
  return rows
}

/** Read a single row by id, or `undefined` when it does not exist. */
export function readRow<T = Record<string, unknown>>(
  doc: Y.Doc,
  arrayName: string,
  rowId: string,
): CollabRow<T> | undefined {
  const data = dataMap(doc, arrayName)
  const row = data?.get(rowId)
  return row instanceof Y.Map ? projectRow<T>(rowId, row) : undefined
}

/**
 * Add a row to an array and return its stable id. A fresh row is appended to the
 * end of the order array by default; pass `index` to insert at a position
 * (clamped to `[0, length]`). Supply `id` to back the row with a known key (a DB
 * primary key) — adding an id that already exists is a no-op on order (the row
 * is not duplicated) but **merges** the given fields into the existing row map.
 *
 * @returns the row's id (the supplied `id`, or a freshly generated UUID).
 */
export function addRow(
  doc: Y.Doc,
  arrayName: string,
  fields: Record<string, unknown> = {},
  opts: RowMutateOptions & { id?: string; index?: number } = {},
): string {
  const id = opts.id ?? newRowId()
  doc.transact(() => {
    const { order, data } = ensureShares(doc, arrayName)

    let row = data.get(id)
    if (!(row instanceof Y.Map)) {
      row = new Y.Map<unknown>()
      data.set(id, row)
    }
    for (const [k, v] of Object.entries(fields)) (row as Y.Map<unknown>).set(k, v)

    // Append/insert the id in the order array only when it isn't already
    // tracked, so re-adding a known id updates fields without moving the row.
    if (!order.toArray().includes(id)) {
      const at = opts.index === undefined ? order.length : clampIndex(opts.index, order.length)
      order.insert(at, [id])
    }
  }, opts.origin)
  return id
}

/**
 * Remove a row by id — deletes both its order entry and its data map, in one
 * transaction. A no-op when the id is not present. Returns whether a row was
 * removed.
 */
export function removeRow(
  doc: Y.Doc,
  arrayName: string,
  rowId: string,
  opts: RowMutateOptions = {},
): boolean {
  let removed = false
  doc.transact(() => {
    const order = orderArray(doc, arrayName)
    const data = dataMap(doc, arrayName)
    if (order) {
      const i = order.toArray().indexOf(rowId)
      if (i !== -1) {
        order.delete(i, 1)
        removed = true
      }
    }
    if (data && data.has(rowId)) {
      data.delete(rowId)
      removed = true
    }
  }, opts.origin)
  return removed
}

/**
 * Move a row to a new position. Only the order array changes — the row's data
 * map (and its per-field CRDT history) is untouched, which is what keeps move
 * lossless where a delete+insert of the data would not. `toIndex` is clamped to
 * `[0, length - 1]` and interpreted against the array **after** the row is
 * removed from its current slot, so it names the row's final resting index.
 * A no-op when the id is absent or already at `toIndex`. Returns whether it moved.
 */
export function moveRow(
  doc: Y.Doc,
  arrayName: string,
  rowId: string,
  toIndex: number,
  opts: RowMutateOptions = {},
): boolean {
  let moved = false
  doc.transact(() => {
    const order = orderArray(doc, arrayName)
    if (!order) return
    const ids = order.toArray()
    const from = ids.indexOf(rowId)
    if (from === -1) return
    const to = clampIndex(toIndex, ids.length - 1)
    if (from === to) return
    order.delete(from, 1)
    order.insert(to, [rowId])
    moved = true
  }, opts.origin)
  return moved
}

/**
 * Set a single field on a row with whole-value LWW. A no-op (returns `false`)
 * when the row does not exist — create it with {@link addRow} first. `undefined`
 * is normalized to `null`, matching the scalar field binding.
 */
export function setRowField(
  doc: Y.Doc,
  arrayName: string,
  rowId: string,
  field: string,
  value: unknown,
  opts: RowMutateOptions = {},
): boolean {
  let ok = false
  doc.transact(() => {
    const row = dataMap(doc, arrayName)?.get(rowId)
    if (row instanceof Y.Map) {
      row.set(field, value ?? null)
      ok = true
    }
  }, opts.origin)
  return ok
}

/**
 * Merge a partial patch of fields into a row (each field whole-value LWW). A
 * no-op (returns `false`) when the row does not exist. Only the keys present in
 * `patch` are written — absent fields are left untouched.
 */
export function updateRow(
  doc: Y.Doc,
  arrayName: string,
  rowId: string,
  patch: Record<string, unknown>,
  opts: RowMutateOptions = {},
): boolean {
  let ok = false
  doc.transact(() => {
    const row = dataMap(doc, arrayName)?.get(rowId)
    if (row instanceof Y.Map) {
      for (const [k, v] of Object.entries(patch)) (row as Y.Map<unknown>).set(k, v ?? null)
      ok = true
    }
  }, opts.origin)
  return ok
}

/**
 * Seed an array's initial rows, idempotently. Gated on the order array still
 * being empty, so a doc already hydrated from persistence (or seeded by a racing
 * connection) is left untouched — the same whole-share idempotence the field
 * seeder uses. Each row may carry an `id` (a DB primary key); rows without one
 * get a generated UUID. Everything happens in a single `origin`-tagged
 * transaction. Returns the ids of the rows it seeded (empty when it no-ops).
 */
export function seedRows(
  doc: Y.Doc,
  arrayName: string,
  rows: ReadonlyArray<Record<string, unknown> & { id?: string }>,
  opts: RowMutateOptions = {},
): string[] {
  if (rows.length === 0) return []
  const ids: string[] = []
  doc.transact(() => {
    const { order, data } = ensureShares(doc, arrayName)
    if (order.length > 0) return // already seeded — leave untouched

    for (const { id: rawId, ...fields } of rows) {
      const id = rawId ?? newRowId()
      const row = new Y.Map<unknown>()
      for (const [k, v] of Object.entries(fields)) row.set(k, v)
      data.set(id, row)
      order.push([id])
      ids.push(id)
    }
  }, opts.origin)
  return ids
}

/**
 * Subscribe to changes on an array's rows — fires `cb` with the freshly read
 * rows (in order) on every observed change to the order array OR any row's data.
 * Observes the array's data + order shares deeply, so a field edit on any row, an
 * add/remove, and a reorder all notify. Returns an unsubscribe function.
 *
 * Both shares are observed via the top-level roots so the subscription survives
 * the shares being created lazily after `observeRows` is called (an empty array
 * whose first row arrives from a peer).
 */
export function observeRows<T = Record<string, unknown>>(
  doc: Y.Doc,
  arrayName: string,
  cb: (rows: CollabRow<T>[]) => void,
): () => void {
  const orderRoot = doc.getMap(ROW_ORDER_MAP)
  const dataRoot = doc.getMap(ROW_DATA_MAP)
  const emit = () => cb(readRows<T>(doc, arrayName))

  // Deep observers on the roots catch nested array/map mutations for this array
  // (and harmlessly for siblings — readRows re-projects only this array).
  orderRoot.observeDeep(emit)
  dataRoot.observeDeep(emit)
  return () => {
    orderRoot.unobserveDeep(emit)
    dataRoot.unobserveDeep(emit)
  }
}

/** Clamp an insertion index to `[0, max]` (treats non-finite / negative as 0). */
function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index) || index < 0) return 0
  return index > max ? max : Math.floor(index)
}
