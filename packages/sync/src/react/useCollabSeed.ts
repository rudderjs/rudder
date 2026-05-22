import { useEffect, useRef, useState } from 'react'
import type {
  Doc as YDoc,
  XmlFragment,
  Text as YText,
}                                       from 'yjs'
import type { CollabRoom }              from './types.js'

export const SEED_ORIGIN = 'rudder-sync-seed'

/** Y-share types that this module's seed helpers can target. Both `XmlFragment`
 *  (Tiptap / ProseMirror) and `Text` (CodeMirror / y-codemirror.next) expose a
 *  `.length` property and accept content via `transact`; that's all the
 *  seed-on-empty decision needs. */
type SeedableShare = XmlFragment | YText

/**
 * Seed-on-first-sync helper — the pure, hook-free skeleton both
 * `useCollabSeed` and `useCollabSeedText` use under the hood.
 *
 * Awaits `room.synced`, reads the share via `getShare(doc, key)`, and
 * invokes `seedFn` only when the share is empty (`.length === 0`). The
 * seed call is wrapped in `room.ydoc.transact(..., SEED_ORIGIN)` so
 * downstream consumers can filter their own update observers on the
 * origin tag instead of mistaking the seed for a user edit.
 *
 * Exported for unit testing — the React hooks add the `seedFn`-ref
 * capture + state management on top. App code should use the hooks.
 *
 * @returns `true` if the synced check completed (regardless of whether
 *          a seed actually wrote); `false` if `room.synced` rejected
 *          (e.g. the manager was stopped before connecting).
 */
export async function seedShareTypeOnSync<Share extends SeedableShare>(
  room:     CollabRoom,
  key:      string,
  getShare: (doc: YDoc, key: string) => Share,
  seedFn:   (doc: YDoc, share: Share) => void,
): Promise<boolean> {
  try {
    await room.synced
  } catch {
    // Synced promise rejects when the manager stops before connecting.
    // Don't surface that as a seed failure — the room just isn't available.
    return false
  }
  const share = getShare(room.ydoc, key)
  if (share.length === 0) {
    room.ydoc.transact(() => seedFn(room.ydoc, share), SEED_ORIGIN)
  }
  return true
}

/** Shared React hook scaffold — keeps `seedFn` stable via a ref, runs the
 *  helper on mount, flips `seeded` to true once the synced check finishes.
 *  Both `useCollabSeed` and `useCollabSeedText` are 5-line wrappers around it. */
function useSeedShareType<Share extends SeedableShare>(
  room:     CollabRoom | null,
  key:      string,
  getShare: (doc: YDoc, key: string) => Share,
  seedFn:   (doc: YDoc, share: Share) => void,
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
    void seedShareTypeOnSync(
      room,
      key,
      getShare,
      (doc, share) => seedFnRef.current(doc, share),
    ).then((ok) => {
      if (!cancelled) setSeeded(ok)
    })

    return () => { cancelled = true }
    // `getShare` is a module-level function (`doc.getXmlFragment` or
    // `doc.getText`) so its identity is stable across renders; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, key])

  return seeded
}

/**
 * Seed a freshly-created Y.XmlFragment with default content on first sync.
 *
 * Runs after `room.synced` resolves; only writes if the fragment is
 * empty (so subsequent peers joining the same room don't re-seed).
 * Returns `true` once the check has completed, regardless of whether
 * a seed actually happened — consumers use this to gate mounting an
 * editor against an empty fragment.
 *
 * Use this for ProseMirror / Tiptap-shaped editors that bind to a
 * `Y.XmlFragment`. For CodeMirror or other `Y.Text`-shaped editors,
 * use {@link useCollabSeedText}.
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
  return useSeedShareType(room, fragmentKey, (doc, k) => doc.getXmlFragment(k), seedFn)
}

/**
 * Seed a freshly-created Y.Text with default content on first sync.
 *
 * Sibling of {@link useCollabSeed} for `Y.Text`-shaped editors —
 * CodeMirror (`y-codemirror.next`), Monaco's Yjs binding, and any
 * other adapter that binds to `Y.Text` rather than `Y.XmlFragment`.
 * Calling `doc.getXmlFragment(key)` on a name already bound as
 * `Y.Text` (or vice versa) throws / corrupts the doc, so the share
 * type must match the binding.
 *
 * Same synced-await + transact-origin semantics as `useCollabSeed`.
 *
 * @example
 * const seeded = useCollabSeedText(room, 'content', (_doc, text) => {
 *   text.insert(0, defaultValue)
 * })
 * if (!seeded) return <Placeholder />
 */
export function useCollabSeedText(
  room:    CollabRoom | null,
  textKey: string,
  seedFn:  (doc: YDoc, text: YText) => void,
): boolean {
  return useSeedShareType(room, textKey, (doc, k) => doc.getText(k), seedFn)
}
