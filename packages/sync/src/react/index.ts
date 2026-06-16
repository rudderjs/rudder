/**
 * Client-side React hooks for `@rudderjs/sync`.
 *
 * The server-side sync engine lives in the main `@rudderjs/sync` entry.
 * This subpath exposes hooks that connect a React component to a
 * collab room without re-implementing the provider lifecycle in each
 * consumer (see `docs/plans/2026-05-21-sync-react-hooks.md` for the
 * motivation).
 *
 * Peer requirements: `react@>=19.2.0` always; `y-websocket` and
 * `y-indexeddb` are optional peers — install them when you use the
 * hooks.
 */

export { useCollabRoom }                        from './useCollabRoom.js'
export { useCollabSeed, useCollabSeedText }     from './useCollabSeed.js'
export { useCollabField, FIELD_WRITE_ORIGIN }   from './useCollabField.js'
export { CollabRoomManager }                    from './CollabRoomManager.js'

export type {
  CollabFieldType,
  CollabFieldBinding,
  CollabValueFieldType,
  CollabValueBinding,
}                              from '../collab/bindings.js'

export {
  collabColorFromSeed,
  computeAwarenessPeers,
  useCollabPresence,
  useReportAwarenessField,
  useAwarenessField,
  useFieldPresence,
}                              from './presence.js'

export type {
  CollabRoom,
  UseCollabRoomOptions,
}                              from './types.js'
export type {
  CollabRoomFactories,
  CollabRoomManagerOptions,
}                              from './CollabRoomManager.js'
export type {
  CollabUser,
  AwarenessPeer,
  FieldPresenceUser,
}                              from './presence.js'
