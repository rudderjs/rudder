import { useEffect, useRef, useState } from 'react'
import { CollabRoomManager }      from './CollabRoomManager.js'
import type {
  CollabRoom,
  UseCollabRoomOptions,
}                                  from './types.js'

const DEFAULT_WS_URL = '/ws-sync'

/**
 * Connect to a collab room and return the live `CollabRoom` handle.
 *
 * Returns `null` while the connection is in flight (dynamic imports +
 * initial handshake) and on the server (SSR no-op). Consumers should
 * render a placeholder for the `null` case.
 *
 * Re-renders when:
 * - The room becomes available (`null` → `CollabRoom`)
 * - The room key changes (old room destroyed, new room constructed)
 * - The component unmounts (room destroyed, hook returns `null` once)
 *
 * @example
 * const room = useCollabRoom(`doc:${id}`, { offline: true })
 * if (!room) return <Spinner />
 * // …bind to room.ydoc / room.provider…
 */
export function useCollabRoom(
  roomKey: string,
  options: UseCollabRoomOptions = {},
): CollabRoom | null {
  const { wsUrl = DEFAULT_WS_URL, offline = false, enabled = true, onDenied } = options
  const [room, setRoom] = useState<CollabRoom | null>(null)

  // Read the denial callback live so an inline closure doesn't land in the
  // effect deps and re-trigger the WS handshake on every render.
  const onDeniedRef = useRef(onDenied)
  onDeniedRef.current = onDenied

  useEffect(() => {
    // SSR — never connect. Check via `globalThis` so we don't depend on
    // the DOM lib being in the framework's tsconfig (it isn't).
    if (typeof (globalThis as { window?: unknown }).window === 'undefined') return

    // Gated — caller flipped `enabled` to false. No manager construction,
    // no WS handshake. When `enabled` flips back to true the effect re-fires
    // (deps include `enabled`) and the room mounts as if from a fresh hook.
    if (!enabled) {
      // Flipping `true → false` mid-lifecycle: the previous effect's cleanup
      // already called `manager.stop()` (which fires `onRoomChange(null)`),
      // so `room` is already null here — no extra setRoom needed.
      return
    }

    const manager = new CollabRoomManager({ roomKey, wsUrl, offline })
    manager.onRoomChange(setRoom)
    manager.onDenied(() => onDeniedRef.current?.())
    void manager.start()

    return () => { manager.stop() }
  }, [roomKey, wsUrl, offline, enabled])

  return room
}
