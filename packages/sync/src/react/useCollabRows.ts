import { useEffect, useMemo, useState } from 'react'
import type { Doc as YDoc } from 'yjs'

import {
  addRow,
  moveRow,
  observeRows,
  readRows,
  removeRow,
  setRowField,
  updateRow,
  type CollabRow,
}                              from '../collab/rows.js'
import type { CollabRoom }     from './types.js'

/** Transact origin tagged on `useCollabRows` writes, matching {@link FIELD_WRITE_ORIGIN}'s
 *  posture so observers can filter framework-originated mutations uniformly. */
export const ROW_WRITE_ORIGIN = 'rudder-sync-rows'

/** The mutation surface returned by {@link useCollabRows} alongside the live rows. */
export interface CollabRowsApi<T> {
  /** Add a row and return its stable id. Append by default; pass `index` to
   *  insert at a position, or `id` to back the row with a known key. */
  add:    (fields?: Partial<T>, opts?: { id?: string; index?: number }) => string | null
  /** Remove a row by id. Returns whether a row was removed. */
  remove: (rowId: string) => boolean
  /** Move a row to a new index (order-only, lossless). Returns whether it moved. */
  move:   (rowId: string, toIndex: number) => boolean
  /** Set one field on a row (whole-value LWW). Returns whether the row existed. */
  setField: (rowId: string, field: keyof T & string, value: unknown) => boolean
  /** Merge a partial patch into a row. Returns whether the row existed. */
  update: (rowId: string, patch: Partial<T>) => boolean
}

/**
 * Two-way bind an **array of records** (a repeater, editable table, list of
 * objects) to a collab room — the row counterpart to {@link useCollabField}.
 * Reads the array's rows in order, re-renders when a peer adds / removes /
 * reorders a row or edits any field, and returns a stable mutation API.
 *
 * Each row carries a stable `id` (a generated UUID, or a DB primary key you pass
 * to `add`). Rows never move in storage; only the order array changes on
 * `move`, so a reorder keeps every row's per-field CRDT history — the property a
 * naive delete+insert of an array of objects loses. Non-text field values use
 * whole-value LWW.
 *
 * Returns `[[], noopApi]` until `room` is non-null — render an empty/disabled
 * table while the room resolves. The mutation API is referentially stable across
 * renders (memoized on the room), so it is safe in effect deps.
 *
 * @example
 * const [rows, lineItems] = useCollabRows<{ sku: string; qty: number }>(room, 'lineItems')
 *
 * return (
 *   <>
 *     {rows.map((r) => (
 *       <tr key={r.id}>
 *         <td><input value={r.sku} onChange={(e) => lineItems.setField(r.id, 'sku', e.target.value)} /></td>
 *         <td><input type="number" value={r.qty} onChange={(e) => lineItems.setField(r.id, 'qty', +e.target.value)} /></td>
 *         <td><button onClick={() => lineItems.remove(r.id)}>×</button></td>
 *       </tr>
 *     ))}
 *     <button onClick={() => lineItems.add({ sku: '', qty: 1 })}>Add row</button>
 *   </>
 * )
 *
 * @param room      the collab room from {@link useCollabRoom}, or `null` while it resolves
 * @param arrayName the array's name — the key under the `row-data` / `row-order` shares
 */
export function useCollabRows<T extends Record<string, unknown> = Record<string, unknown>>(
  room: CollabRoom | null,
  arrayName: string,
): [CollabRow<T>[], CollabRowsApi<T>] {
  const [rows, setRows] = useState<CollabRow<T>[]>([])

  useEffect(() => {
    if (!room) {
      setRows([])
      return
    }
    const doc: YDoc = room.ydoc
    // The room's doc is live immediately (offline edits work pre-sync), so read
    // the initial rows without gating on `room.synced`, then re-read on change.
    setRows(readRows<T>(doc, arrayName))
    return observeRows<T>(doc, arrayName, setRows)
  }, [room, arrayName])

  const api = useMemo<CollabRowsApi<T>>(() => {
    const origin = ROW_WRITE_ORIGIN
    return {
      add: (fields, opts) =>
        room ? addRow(room.ydoc, arrayName, (fields ?? {}) as Record<string, unknown>, { ...opts, origin }) : null,
      remove:   (rowId) => (room ? removeRow(room.ydoc, arrayName, rowId, { origin }) : false),
      move:     (rowId, toIndex) => (room ? moveRow(room.ydoc, arrayName, rowId, toIndex, { origin }) : false),
      setField: (rowId, field, value) => (room ? setRowField(room.ydoc, arrayName, rowId, field, value, { origin }) : false),
      update:   (rowId, patch) => (room ? updateRow(room.ydoc, arrayName, rowId, patch as Record<string, unknown>, { origin }) : false),
    }
  }, [room, arrayName])

  return [rows, api]
}
