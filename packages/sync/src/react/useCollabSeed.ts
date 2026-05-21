import { useEffect, useRef, useState } from 'react'
import type {
  Doc as YDoc,
  XmlFragment,
}                                       from 'yjs'
import type { CollabRoom }              from './types.js'

const SEED_ORIGIN = 'rudder-sync-seed'

/**
 * Seed a freshly-created Y fragment with default content on first sync.
 *
 * Runs after `room.synced` resolves; only writes if the fragment is
 * empty (so subsequent peers joining the same room don't re-seed).
 * Returns `true` once the check has completed, regardless of whether
 * a seed actually happened — consumers use this to gate mounting an
 * editor against an empty fragment.
 *
 * `seedFn` is captured via a ref so consumers don't need `useCallback`
 * to keep the effect stable. The seed runs exactly once per
 * `(room, fragmentKey)` pair.
 *
 * @example
 * const seeded = useCollabSeed(room, 'content', (doc, fragment) => {
 *   const initial = new Y.XmlText()
 *   initial.insert(0, defaultValue)
 *   fragment.insert(0, [initial])
 * })
 * if (!seeded) return <Placeholder />
 */
export function useCollabSeed(
  room:        CollabRoom | null,
  fragmentKey: string,
  seedFn:      (doc: YDoc, fragment: XmlFragment) => void,
): boolean {
  const [seeded, setSeeded] = useState(false)
  const seedFnRef           = useRef(seedFn)
  seedFnRef.current         = seedFn

  useEffect(() => {
    if (!room) {
      setSeeded(false)
      return
    }

    let cancelled = false
    room.synced.then(() => {
      if (cancelled) return
      const fragment = room.ydoc.getXmlFragment(fragmentKey)
      if (fragment.length === 0) {
        room.ydoc.transact(
          () => seedFnRef.current(room.ydoc, fragment),
          SEED_ORIGIN,
        )
      }
      setSeeded(true)
    }).catch(() => {
      // Synced promise rejects when the manager stops before connecting.
      // Don't surface that as a seed failure — the room just isn't available.
      if (!cancelled) setSeeded(false)
    })

    return () => { cancelled = true }
  }, [room, fragmentKey])

  return seeded
}
