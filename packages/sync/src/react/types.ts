/**
 * Shared types for the client-side collab room hooks.
 *
 * `y-websocket` and `y-indexeddb` are declared as optional peerDependencies
 * on `@rudderjs/sync` — apps that use these hooks must install them. The
 * types are imported here so consumers get full IntelliSense without us
 * re-declaring the upstream shapes.
 */

import type { Doc as YDoc }              from 'yjs'
import type { WebsocketProvider }        from 'y-websocket'
import type { IndexeddbPersistence }     from 'y-indexeddb'

export interface CollabRoom {
  /** The Y.Doc that holds all collaborative state. */
  ydoc:        YDoc
  /** WebSocket provider — peer awareness, sync, and connection state live here. */
  provider:    WebsocketProvider
  /** IndexedDB persistence handle, present only when `offline: true`. */
  persistence: IndexeddbPersistence | null
  /** Resolves on the provider's first `synced` event. */
  synced:      Promise<void>
}

export interface UseCollabRoomOptions {
  /**
   * WebSocket URL for the sync server.
   *
   * Defaults to `/ws-sync` — matches the default mount path used by
   * `@rudderjs/sync`'s server adapter, so apps that don't override the
   * server path don't need to set this either.
   */
  wsUrl?:   string

  /**
   * When true, also constructs an `IndexeddbPersistence` for offline-first
   * behavior. The room becomes usable from a previous session's cached state
   * before the WebSocket finishes its first sync. Defaults to `false`.
   */
  offline?: boolean

  /**
   * Gate the WebSocket connection without rendering branches around the hook.
   *
   * Defaults to `true` — omit and the hook behaves identically to before.
   * Set to `false` to skip the manager construction entirely (no WS handshake,
   * no IndexedDB open). Flipping `false` → `true` mounts the manager; flipping
   * `true` → `false` tears down the active room (`room` becomes `null` via
   * `CollabRoomManager.stop()`'s `onRoomChange(null)` callback).
   *
   * Standard pattern for "render fields locally until prerequisites are met"
   * (e.g. `enabled: !!wsPath`) — same shape as `useSWR(..., { enabled })` and
   * `useQuery(..., { enabled })`. Use this instead of `if (!wsPath) return …`
   * before the hook (illegal under Rules of Hooks).
   */
  enabled?: boolean

  /**
   * Fired once if the server rejects the WS upgrade with an auth-denied close
   * code (4401/4403 from the `onAuth` gate). The hook stops reconnecting and
   * returns `null` (the room is treated as nonexistent, so collab fields fall
   * back to plain editing); this callback lets the UI distinguish "denied"
   * from "still connecting" — e.g. to show a "sign in to collaborate" notice.
   *
   * The callback reference is read live, so an inline closure doesn't
   * re-trigger the connection effect.
   */
  onDenied?: () => void
}
