import { useCallback, useEffect, useState } from 'react'
import type { Doc as YDoc } from 'yjs'

import {
  observeFieldValue,
  readFieldValue,
  writeFieldValue,
  type CollabValueBinding,
  type CollabValueFieldType,
}                              from '../collab/bindings.js'
import type { CollabRoom }     from './types.js'

/** Transact origin tagged on `useCollabField` writes, matching the seed origin
 *  so observers can filter framework-originated mutations uniformly. */
export const FIELD_WRITE_ORIGIN = 'rudder-sync-field'

/**
 * Two-way bind a form field to its Y share inside a collab room — the client
 * counterpart to a {@link CollabFieldBindings} entry. Reads the field's current
 * value out of the bound share, re-renders when a peer changes it, and returns a
 * setter that validates then writes the new value.
 *
 * Handles the value-shaped share types: `scalar` (an entry in the shared fields
 * Y.Map), `array` (a dedicated Y.Array), and `map` (a dedicated nested Y.Map).
 * Collaborative-string (`text`) fields are intentionally excluded — they merge
 * per-keystroke and must bind through an editor adapter (`useCollabSeedText` +
 * a Y.Text editor binding), not whole-value replacement, so passing a `'text'`
 * binding is a compile error.
 *
 * The setter is whole-value replace and returns whether the write was accepted:
 * a value the binding's `validate` predicate rejects is **not written** and the
 * setter returns `false`, so a form can surface the rejection without the
 * invalid value ever reaching the CRDT.
 *
 * Returns `[undefined, noop]` until `room` is non-null and connected — render an
 * empty/disabled control while the room resolves.
 *
 * @example
 * const [title, setTitle] = useCollabField<string>(room, 'title', {
 *   type: 'scalar',
 *   validate: (v) => typeof v === 'string' && v.length <= 120,
 * })
 * <input value={title ?? ''} onChange={(e) => setTitle(e.target.value)} />
 *
 * @example
 * const [tags, setTags] = useCollabField<string[]>(room, 'tags', 'array')
 *
 * @param room    the collab room from {@link useCollabRoom}, or `null` while it resolves
 * @param field   the field name — also the share key for `array` / `map` bindings
 * @param binding the field's share type (shorthand) or a {@link CollabValueBinding} with a validator
 * @param mapName the shared Y.Map name `scalar` fields live in (default `'fields'`)
 */
export function useCollabField<V = unknown>(
  room: CollabRoom | null,
  field: string,
  binding: CollabValueFieldType | CollabValueBinding,
  mapName: string = 'fields',
): [V | undefined, (value: V) => boolean] {
  const [value, setValue] = useState<V | undefined>(undefined)

  useEffect(() => {
    if (!room) {
      setValue(undefined)
      return
    }
    const doc: YDoc = room.ydoc

    // Seed the initial value, then re-read on every observed change. The room's
    // doc is live immediately (offline edits work pre-sync), so don't gate the
    // initial read on `room.synced`.
    setValue(readFieldValue<V>(doc, field, binding, mapName))
    return observeFieldValue<V>(doc, field, binding, (v) => setValue(v), mapName)
    // `binding` deliberately omitted — it's read by value (type + validate);
    // callers pass a stable literal or memoized object, so re-subscribing on its
    // per-render identity would be churn without correctness benefit.
  }, [room, field, mapName])

  const set = useCallback(
    (next: V): boolean => {
      if (!room) return false
      return writeFieldValue(room.ydoc, field, next, binding, {
        mapName,
        origin: FIELD_WRITE_ORIGIN,
      })
      // `binding` omitted for the same reason as the effect above.
    },
    [room, field, mapName],
  )

  return [value, set]
}
