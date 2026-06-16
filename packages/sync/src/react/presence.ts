/**
 * Client-side presence/awareness hooks for `@rudderjs/sync`.
 *
 * The room hooks ({@link useCollabRoom} / {@link CollabRoomManager}) manage the
 * Y.Doc + WebSocket lifecycle but expose nothing for presence. These layer the
 * common awareness patterns on top of a {@link CollabRoom} so consumers stop
 * re-deriving the Yjs-awareness gotchas (the mid-render `setLocalStateField`
 * race, the same-list bail against per-keystroke `change` events, the
 * `#rrggbb`-not-`hsl()` color constraint Tiptap's CollaborationCaret enforces).
 *
 * They are the client mirror of the server-side awareness helpers in
 * `@rudderjs/sync/lexical`. All hooks take the `CollabRoom | null` returned by
 * `useCollabRoom`, so they compose without re-opening a connection:
 *
 * ```tsx
 * const room = useCollabRoom(`doc:${id}`)
 * useCollabPresence(room, { name: user.name, color: collabColorFromSeed(user.email) })
 * useReportAwarenessField(room, 'focusField', isFocused ? fieldName : null)
 * const editors = useFieldPresence(room, fieldName)   // who else is on this field
 * ```
 *
 * Peer requirement: `react@>=19.2.0`. The pure helpers ({@link
 * collabColorFromSeed}, {@link computeAwarenessPeers}) have no React or Yjs
 * dependency and are exported for direct use + unit testing.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CollabRoom } from './types.js'

// ─── Color from seed ──────────────────────────────────────

/**
 * Hash a stable seed (email / name / id) into a deterministic `#rrggbb` so a
 * user gets the same caret color across reloads and devices. Cheap djb2 fold
 * to a hue, then HSL(h, 70%, 50%) to hex.
 *
 * Returns hex, not `hsl(...)`, on purpose: Tiptap's CollaborationCaret parses
 * the color to derive a faded selection background and only recognizes
 * `#rrggbb` (an `hsl(...)` value logs "unsupported color format" on every
 * caret paint). Collisions across the 360-hue space are fine — the color is
 * decorative; the name is the canonical identifier.
 */
export function collabColorFromSeed(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return hslToHex(hue, 0.7, 0.5)
}

/** HSL to `#rrggbb`. Inline so the package stays dependency-free. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r: number, g: number, b: number
  if      (h <  60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  const hex = (n: number): string => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

// ─── Awareness shapes ─────────────────────────────────────

/** The local user's presence identity, mirrored onto awareness `user`. */
export interface CollabUser {
  name:  string
  color: string
}

/** A remote peer that has a non-null value for the queried awareness key. */
export interface AwarenessPeer {
  /** Yjs clientID — stable per peer, used as the React key. */
  clientId: number
  /** The peer's value for the queried key. */
  value:    unknown
  /** The peer's `{ name, color }` identity (filled with defaults if absent). */
  user:     CollabUser
}

/**
 * The slice of a Yjs `Awareness` instance these hooks use. y-websocket exposes
 * `provider.awareness` at runtime, but its exported provider type omits the
 * field; this structural type lets the hooks read it without a wide `any`.
 */
interface AwarenessLike {
  clientID:           number
  getStates():        Map<number, Record<string, unknown>>
  getLocalState():    Record<string, unknown> | null
  setLocalStateField(field: string, value: unknown): void
  on(event: 'change', cb: () => void):  void
  off(event: 'change', cb: () => void): void
}

function awarenessOf(room: CollabRoom | null): AwarenessLike | null {
  const provider = room?.provider as { awareness?: AwarenessLike } | undefined
  return provider?.awareness ?? null
}

const DEFAULT_USER: CollabUser = { name: 'Anonymous', color: '#888888' }

function userFromState(state: Record<string, unknown> | undefined): CollabUser {
  const u = (state?.['user'] ?? {}) as Partial<CollabUser>
  return {
    name:  typeof u.name  === 'string' ? u.name  : DEFAULT_USER.name,
    color: typeof u.color === 'string' ? u.color : DEFAULT_USER.color,
  }
}

// ─── Pure reducers (exported for testing) ─────────────────

/**
 * Collect the remote peers that have a non-null value for `key` from an
 * awareness state map. The local client is excluded. Pure — drives
 * {@link useAwarenessField} but is testable without React or a live provider.
 */
export function computeAwarenessPeers(
  states:  Map<number, Record<string, unknown>>,
  localId: number,
  key:     string,
): AwarenessPeer[] {
  const out: AwarenessPeer[] = []
  states.forEach((state, clientId) => {
    if (clientId === localId) return
    const value = state?.[key]
    if (value == null) return
    out.push({ clientId, value, user: userFromState(state) })
  })
  return out
}

/** Positional equality on the rendered keys — Yjs `getStates()` order is stable per clientID. */
function samePeers(a: AwarenessPeer[], b: AwarenessPeer[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!
    if (x.clientId !== y.clientId || x.value !== y.value || x.user.name !== y.user.name || x.user.color !== y.user.color) {
      return false
    }
  }
  return true
}

// ─── Hooks ────────────────────────────────────────────────

/**
 * Mirror the local user's `{ name, color }` onto the room's awareness `user`
 * field, on the first room emit and whenever the identity changes. Remote
 * peers' carets/chips read this. A missing color falls back to a deterministic
 * {@link collabColorFromSeed} of the name.
 *
 * No-op until the room (and its awareness) exists; safe to call with `null`.
 */
export function useCollabPresence(room: CollabRoom | null, user: CollabUser): void {
  useEffect(() => {
    const awareness = awarenessOf(room)
    if (!awareness) return
    const color = user.color || (user.name ? collabColorFromSeed(user.name) : DEFAULT_USER.color)
    try {
      const prev = (awareness.getLocalState()?.['user'] ?? {}) as Partial<CollabUser>
      awareness.setLocalStateField('user', {
        name:  user.name || prev.name || DEFAULT_USER.name,
        color: color     || prev.color || DEFAULT_USER.color,
      })
    } catch (err) {
      // Awareness not initialized yet — the next render's effect retries.
      warnDev('setLocalStateField raced; retry on next tick', err)
    }
  }, [room, user.name, user.color])
}

/**
 * Report a value into the local awareness `key` (e.g. the field the user is
 * focused on), clearing it to `null` on change or unmount. Pass `null` to clear
 * explicitly. The companion read hook is {@link useAwarenessField}.
 */
export function useReportAwarenessField(
  room:  CollabRoom | null,
  key:   string,
  value: unknown,
): void {
  useEffect(() => {
    const awareness = awarenessOf(room)
    if (!awareness) return
    try { awareness.setLocalStateField(key, value ?? null) }
    catch (err) { warnDev(`setLocalStateField('${key}') raced`, err) }
    return () => {
      try { awareness.setLocalStateField(key, null) } catch { /* torn down */ }
    }
  }, [room, key, value])
}

/**
 * Read the remote peers that currently have a non-null value for `key`. Returns
 * `[]` outside a room. Excludes the local user, dedupes by clientID, and skips
 * a re-render when the next computed list is identical (the awareness `change`
 * event fires on every peer keystroke, so most fire no real delta).
 *
 * The `setState` is deferred via `queueMicrotask`: Tiptap's CollaborationCaret
 * calls `setLocalStateField('user', …)` synchronously while mounting, which
 * fires `change` mid-render — deferring avoids React's "update while rendering"
 * warning.
 */
export function useAwarenessField(room: CollabRoom | null, key: string): AwarenessPeer[] {
  const [peers, setPeers] = useState<AwarenessPeer[]>([])
  const lastRef = useRef<AwarenessPeer[]>([])

  useEffect(() => {
    const awareness = awarenessOf(room)
    if (!awareness) {
      if (lastRef.current.length) { lastRef.current = []; setPeers([]) }
      return
    }
    const localId = awareness.clientID

    const publish = (next: AwarenessPeer[]): void => {
      if (samePeers(lastRef.current, next)) return
      lastRef.current = next
      setPeers(next)
    }
    const recompute = (): void => publish(computeAwarenessPeers(awareness.getStates(), localId, key))

    recompute()  // initial snapshot — peers already present before mount
    const handler = (): void => { queueMicrotask(recompute) }
    awareness.on('change', handler)
    return () => { awareness.off('change', handler) }
  }, [room, key])

  return peers
}

/** A remote peer focused on a field, as rendered by a presence chip. */
export interface FieldPresenceUser {
  clientId: number
  name:     string
  color:    string
}

/**
 * Who else is currently focused on `fieldName`, read from the `focusField`
 * awareness key. Pairs with `useReportAwarenessField(room, 'focusField', …)` on
 * the writing side. Convenience over {@link useAwarenessField}.
 */
export function useFieldPresence(room: CollabRoom | null, fieldName: string): FieldPresenceUser[] {
  const peers = useAwarenessField(room, 'focusField')
  return useMemo(
    () => peers
      .filter(p => p.value === fieldName)
      .map(p => ({ clientId: p.clientId, name: p.user.name, color: p.user.color })),
    [peers, fieldName],
  )
}

function warnDev(message: string, err: unknown): void {
  if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`[@rudderjs/sync] awareness ${message}:`, err instanceof Error ? err.message : err)
  }
}
