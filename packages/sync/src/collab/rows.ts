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
 * A row read out of the CRDT: its stable id (under `K`, defaults to `'id'`) plus
 * the plain-JS projection of its field map. The key `K` is reserved — a field
 * literally named `K` on the row map is shadowed by the row's stable id.
 */
export type CollabRow<T = Record<string, unknown>, K extends string = 'id'> = T & { [P in K]: string }

/** Options shared by the mutating primitives — tag the transaction with `origin`. */
export interface RowMutateOptions {
  /** Transaction origin, so observers can filter framework-originated writes. */
  origin?: unknown
}

/** Options for read primitives that project a stable identity field. */
export interface ReadRowsOptions<K extends string = 'id'> {
  /**
   * Project the row's stable id under this key instead of the default `'id'`.
   * Useful for renderers that reserve a different field name (e.g. `'__id'`).
   * Does not affect storage — only the projected plain-JS output.
   * Default: `'id'`.
   */
  idKey?: K
}

/**
 * A granular row lifecycle event emitted by {@link observeRowChanges}.
 *
 * - `add`    — a new row was inserted at `index`; `values` is its initial field map.
 * - `remove` — a row was deleted from `index`.
 * - `move`   — a row moved from `from` to `to` (order-only; data map untouched).
 *
 * Field edits do NOT produce change events — they are covered by
 * {@link observeRows} (full-snapshot) or direct `readRow` calls.
 */
export type RowChangeEvent<T = Record<string, unknown>> =
  | { kind: 'add';    rowId: string; index: number; values: T }
  | { kind: 'remove'; rowId: string; index: number }
  | { kind: 'move';   rowId: string; from: number; to: number }

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
 *  so the reserved key always wins over any field of the same name. */
function projectRow<T, K extends string = 'id'>(
  id: string,
  row: Y.Map<unknown>,
  idKey?: K,
): CollabRow<T, K> {
  return { ...(row.toJSON() as T), [idKey ?? 'id']: id } as CollabRow<T, K>
}

/**
 * Pre-allocate the order and data shares for an array without seeding any rows.
 * Calling this idempotently ensures that two peers' concurrent first `addRow` on a
 * brand-new doc do not each `getOrCreate` a fresh `Y.Array` and LWW-orphan the
 * loser's entry. A no-op when the shares already exist.
 *
 * Useful when the server pre-seeds an empty array so that racing clients converge
 * on one canonical order array instead of one per client.
 */
export function ensureRowArray(
  doc: Y.Doc,
  arrayName: string,
  opts: RowMutateOptions = {},
): void {
  doc.transact(() => {
    ensureShares(doc, arrayName)
  }, opts.origin)
}

/**
 * Read every row of an array in order, each projected to a plain JS object with
 * its stable id (under `opts.idKey`, default `'id'`). Order entries whose data map
 * is missing (a dangling id from a concurrent remove) are skipped — the order array
 * is the source of truth for which rows exist and in what sequence. Returns `[]`
 * when the array is unset.
 */
export function readRows<T = Record<string, unknown>, K extends string = 'id'>(
  doc: Y.Doc,
  arrayName: string,
  opts: ReadRowsOptions<K> = {},
): CollabRow<T, K>[] {
  const order = orderArray(doc, arrayName)
  if (!order || order.length === 0) return []
  const data = dataMap(doc, arrayName)
  if (!data) return []

  const rows: CollabRow<T, K>[] = []
  for (const id of order.toArray()) {
    const row = data.get(id)
    if (row instanceof Y.Map) rows.push(projectRow<T, K>(id, row, opts.idKey))
  }
  return rows
}

/**
 * Read a single row by id, or `undefined` when it does not exist.
 * The stable id is projected under `opts.idKey` (default `'id'`).
 */
export function readRow<T = Record<string, unknown>, K extends string = 'id'>(
  doc: Y.Doc,
  arrayName: string,
  rowId: string,
  opts: ReadRowsOptions<K> = {},
): CollabRow<T, K> | undefined {
  const data = dataMap(doc, arrayName)
  const row = data?.get(rowId)
  return row instanceof Y.Map ? projectRow<T, K>(rowId, row, opts.idKey) : undefined
}

/**
 * Add a row to an array and return its stable id. A fresh row is appended to the
 * end of the order array by default; pass `index` to insert at a position
 * (clamped to `[0, length]`). Supply `id` to back the row with a known key (a DB
 * primary key) — adding an id that already exists is a no-op on order (the row
 * is not duplicated) but **merges** the given fields into the existing row map.
 *
 * Pass `mirrorId: true` to also write the row's stable id into the row map under
 * `idKey` (default `'id'`). This makes the id available in `readRows` `values`
 * and across the wire without a projection-side stamp — useful for renderers that
 * read the id out of the row's fields rather than a reserved projected key.
 *
 * @returns the row's id (the supplied `id`, or a freshly generated UUID).
 */
export function addRow(
  doc: Y.Doc,
  arrayName: string,
  fields: Record<string, unknown> = {},
  opts: RowMutateOptions & { id?: string; index?: number; mirrorId?: boolean; idKey?: string } = {},
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
    if (opts.mirrorId) (row as Y.Map<unknown>).set(opts.idKey ?? 'id', id)

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
 * Re-key a row from `oldId` to `newId` in one transaction. Clones the row map
 * contents into a fresh `Y.Map` under `newId`, swaps the order-array entry in
 * place, and removes `oldId`. Returns `false` without mutating when:
 *   - `oldId === newId` (no-op)
 *   - `oldId` is not found in the array
 *   - `newId` already exists (collision — fail-safe, never overwrites)
 *
 * The canonical use case is a draft row created under a client UUID that the
 * server persists under a DB primary key: re-keying inside the CRDT lets peers
 * converge on the PK without a full reload. Row field values must be plain JS
 * values (whole-value LWW) — nested `Y.Map`/`Y.Array` values are not supported
 * and will be silently omitted from the clone.
 */
export function renameRow(
  doc: Y.Doc,
  arrayName: string,
  oldId: string,
  newId: string,
  opts: RowMutateOptions = {},
): boolean {
  if (oldId === newId) return false
  let renamed = false
  doc.transact(() => {
    const order = orderArray(doc, arrayName)
    const data = dataMap(doc, arrayName)
    if (!order || !data) return

    const oldRow = data.get(oldId)
    if (!(oldRow instanceof Y.Map)) return // oldId not found
    if (data.has(newId)) return            // newId collision — fail-safe

    const idx = order.toArray().indexOf(oldId)
    if (idx === -1) return // dangling data entry with no order entry

    // Clone plain-value fields into a fresh Y.Map under the new key.
    const newRow = new Y.Map<unknown>()
    for (const [k, v] of (oldRow as Y.Map<unknown>).entries()) {
      // Only plain JS values; nested Y.Types cannot be re-parented.
      if (!(v instanceof Y.AbstractType)) newRow.set(k, v)
    }
    data.set(newId, newRow)
    data.delete(oldId)

    // Swap the order-array entry at the same position.
    order.delete(idx, 1)
    order.insert(idx, [newId])

    renamed = true
  }, opts.origin)
  return renamed
}

/**
 * Seed an array's initial rows, idempotently. Gated on the order array still
 * being empty, so a doc already hydrated from persistence (or seeded by a racing
 * connection) is left untouched — the same whole-share idempotence the field
 * seeder uses. Each row may carry an `id` (a DB primary key); rows without one
 * get a generated UUID. Everything happens in a single `origin`-tagged
 * transaction. Returns the ids of the rows it seeded (empty when it no-ops).
 *
 * Pass `mirrorId: true` to write each row's stable id into its row map under
 * `idKey` (default `'id'`). See {@link addRow} for the mirroring rationale.
 *
 * When `rows` is empty the function normally returns early without allocating the
 * underlying CRDT shares. If you need to pre-allocate shares for a brand-new
 * empty array (to close the concurrent-first-`addRow` race), call
 * {@link ensureRowArray} instead.
 */
export function seedRows(
  doc: Y.Doc,
  arrayName: string,
  rows: ReadonlyArray<Record<string, unknown> & { id?: string }>,
  opts: RowMutateOptions & { mirrorId?: boolean; idKey?: string } = {},
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
      if (opts.mirrorId) row.set(opts.idKey ?? 'id', id)
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

/**
 * Subscribe to **granular** row lifecycle events on an array — `add`, `remove`,
 * and `move` — without requiring the caller to diff successive snapshots.
 *
 * Unlike {@link observeRows} (which fires a full snapshot on every change),
 * `observeRowChanges` emits one {@link RowChangeEvent} per structural change:
 *
 * - `add`    — a new row arrived at `index` with initial `values`.
 * - `remove` — a row was deleted from `index`.
 * - `move`   — a row was reordered from `from` to `to` (delete+insert of the
 *              same id in one transaction, coalesced into a single event).
 *
 * Field edits on existing rows do NOT produce events here — subscribe to
 * {@link observeRows} or use `readRow` directly for field-level reactivity.
 *
 * Returns an unsubscribe function.
 *
 * @example
 * const stop = observeRowChanges<Item>(doc, 'items', (event) => {
 *   if (event.kind === 'add')    list.splice(event.index, 0, { id: event.rowId, ...event.values })
 *   if (event.kind === 'remove') list.splice(event.index, 1)
 *   if (event.kind === 'move')   list.splice(event.to, 0, ...list.splice(event.from, 1))
 * })
 */
export function observeRowChanges<T = Record<string, unknown>>(
  doc: Y.Doc,
  arrayName: string,
  cb: (event: RowChangeEvent<T>) => void,
): () => void {
  const orderRoot = doc.getMap(ROW_ORDER_MAP)
  // Shadow copy of the last-known order — used to map delta delete-counts to ids.
  let prevOrder: string[] = orderArray(doc, arrayName)?.toArray() ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (events: Y.YEvent<any>[]) => {
    // Scan for the Y.YArrayEvent on our specific order array (path = [arrayName])
    // and for a Y.YMapEvent signalling the array was lazily created (when creation
    // and the first insert happen in the same Yjs transaction, only a Y.YMapEvent
    // fires on the root — no separate Y.YArrayEvent for the initial content).
    let arrayEvent: Y.YArrayEvent<string> | undefined
    let orderArrayCreated = false

    for (const event of events) {
      if (
        event.path.length === 1 &&
        event.path[0] === arrayName &&
        event instanceof Y.YArrayEvent
      ) {
        arrayEvent = event as Y.YArrayEvent<string>
      } else if (
        event.path.length === 0 &&
        event instanceof Y.YMapEvent &&
        (event as Y.YMapEvent<unknown>).keysChanged.has(arrayName)
      ) {
        orderArrayCreated = true
      }
    }

    if (arrayEvent) {
      // Walk the Yjs delta against prevOrder to recover which ids were deleted
      // and inserted.  A delete+insert of the SAME id in one transaction is a
      // move; a lone delete is a remove; a lone insert is an add.
      type DeltaOp = { retain?: number; delete?: number; insert?: string[] }
      const delta = arrayEvent.changes.delta as DeltaOp[]
      const newOrder = (arrayEvent.target as Y.Array<string>).toArray()

      let oldIdx = 0
      const deletedIds: string[] = []
      const insertedIds: string[] = []

      for (const op of delta) {
        if (op.retain !== undefined) {
          oldIdx += op.retain
        } else if (op.delete !== undefined) {
          for (let i = 0; i < op.delete; i++) {
            const id = prevOrder[oldIdx + i]
            if (id !== undefined) deletedIds.push(id)
          }
          oldIdx += op.delete
        } else if (op.insert !== undefined) {
          insertedIds.push(...op.insert)
        }
      }

      const deletedSet = new Set(deletedIds)
      const insertedSet = new Set(insertedIds)
      const data = dataMap(doc, arrayName)

      // Emit remove or move for each deleted id.
      for (const id of deletedIds) {
        if (insertedSet.has(id)) {
          // Same id deleted and re-inserted in one transaction: move.
          cb({ kind: 'move', rowId: id, from: prevOrder.indexOf(id), to: newOrder.indexOf(id) })
        } else {
          cb({ kind: 'remove', rowId: id, index: prevOrder.indexOf(id) })
        }
      }

      // Emit add for each inserted id that is not part of a move.
      for (const id of insertedIds) {
        if (!deletedSet.has(id)) {
          const index = newOrder.indexOf(id)
          const row = data?.get(id)
          const values = row instanceof Y.Map ? (row.toJSON() as T) : ({} as T)
          cb({ kind: 'add', rowId: id, index, values })
        }
      }

      prevOrder = newOrder
    } else if (orderArrayCreated) {
      // Fallback: the array was just created — snapshot-diff against prevOrder to
      // emit adds for any ids the new array already contains.
      const newOrder = orderArray(doc, arrayName)?.toArray() ?? []
      const prevSet = new Set(prevOrder)
      const data = dataMap(doc, arrayName)
      for (const id of newOrder) {
        if (!prevSet.has(id)) {
          const index = newOrder.indexOf(id)
          const row = data?.get(id)
          const values = row instanceof Y.Map ? (row.toJSON() as T) : ({} as T)
          cb({ kind: 'add', rowId: id, index, values })
        }
      }
      prevOrder = newOrder
    }
  }

  orderRoot.observeDeep(handler)
  return () => orderRoot.unobserveDeep(handler)
}

/** Clamp an insertion index to `[0, max]` (treats non-finite / negative as 0). */
function clampIndex(index: number, max: number): number {
  if (!Number.isFinite(index) || index < 0) return 0
  return index > max ? max : Math.floor(index)
}
