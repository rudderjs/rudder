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
}
