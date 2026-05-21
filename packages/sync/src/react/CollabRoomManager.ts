/**
 * Lifecycle manager for a single collab room — the pure logic behind
 * `useCollabRoom`. Owns the lazy-imports of `yjs` / `y-websocket` /
 * `y-indexeddb`, handles cancellation safely (even mid-async-await),
 * and exposes idempotent `stop()` so React strict-mode double-invokes
 * don't leak handles.
 *
 * Why this is a class (not just a hook): testability. With no React in
 * the loop we can exhaustively unit-test the cancellation matrix using
 * mock factories, then keep the React hook as a 10-line `useEffect`
 * wrapper. The framework doesn't ship `@testing-library/react`; this
 * shape sidesteps that gap.
 */

import type { Doc as YDoc }          from 'yjs'
import type { WebsocketProvider }    from 'y-websocket'
import type { IndexeddbPersistence } from 'y-indexeddb'
import type { CollabRoom }           from './types.js'

/**
 * Factories let tests inject mock module shapes without touching the
 * real `yjs` / `y-websocket` / `y-indexeddb` packages. In production
 * they default to the real dynamic imports.
 */
export interface CollabRoomFactories {
  loadYjs?:        () => Promise<typeof import('yjs')>
  loadWebsocket?:  () => Promise<typeof import('y-websocket')>
  loadIndexeddb?:  () => Promise<typeof import('y-indexeddb')>
}

export interface CollabRoomManagerOptions {
  roomKey:    string
  wsUrl:      string
  offline?:   boolean
  factories?: CollabRoomFactories
}

interface Handles {
  ydoc?:        YDoc
  provider?:    WebsocketProvider
  persistence?: IndexeddbPersistence
}

export class CollabRoomManager {
  private handles:   Handles = {}
  private cancelled  = false
  private started    = false
  private stopped    = false
  private syncedResolve!: () => void
  private syncedReject!:  (e: Error) => void
  private onRoomCb?: (room: CollabRoom | null) => void

  /** Resolves on the provider's first `synced` event; rejects if construction fails. */
  readonly synced: Promise<void>

  constructor(private readonly opts: CollabRoomManagerOptions) {
    this.synced = new Promise<void>((resolve, reject) => {
      this.syncedResolve = resolve
      this.syncedReject  = reject
    })
    // Prevent unhandled-rejection warnings if no consumer awaits `synced`
    // before `stop()` rejects it.
    this.synced.catch(() => { /* swallowed — consumer may not be listening */ })
  }

  /**
   * Register a callback that fires when the room becomes available
   * (constructed + initial sync wired) and again when `stop()` is called
   * (with `null`). Single-slot — last registration wins.
   */
  onRoomChange(cb: (room: CollabRoom | null) => void): void {
    this.onRoomCb = cb
  }

  /**
   * Lazy-imports peers, constructs handles, wires sync resolution.
   * Safe to call exactly once. Cancellation via `stop()` aborts mid-await
   * without leaving partial handles uncleaned.
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    if (this.cancelled) return

    const loadYjs       = this.opts.factories?.loadYjs       ?? (() => import('yjs'))
    const loadWebsocket = this.opts.factories?.loadWebsocket ?? (() => import('y-websocket'))
    const loadIndexeddb = this.opts.factories?.loadIndexeddb ?? (() => import('y-indexeddb'))

    try {
      const Y = await loadYjs()
      if (this.cancelled) return
      this.handles.ydoc = new Y.Doc()

      const wsMod = await loadWebsocket()
      if (this.cancelled) return
      this.handles.provider = new wsMod.WebsocketProvider(
        this.opts.wsUrl,
        this.opts.roomKey,
        this.handles.ydoc,
      )

      if (this.opts.offline) {
        const idbMod = await loadIndexeddb()
        if (this.cancelled) return
        this.handles.persistence = new idbMod.IndexeddbPersistence(
          this.opts.roomKey,
          this.handles.ydoc,
        )
      }

      // y-websocket's typed event union doesn't include `'synced'` (it's
      // emitted via the `synced` setter, not declared on the Observable
      // event map). Cast through `never` — consistent with the same
      // workaround in `@pilotiq/pilotiq/react`'s `onProviderSynced`.
      const provider = this.handles.provider
      if (provider.synced) {
        this.syncedResolve()
      } else {
        const onSynced = (): void => {
          try { provider.off('synced' as never, onSynced as never) } catch { /* ignore */ }
          this.syncedResolve()
        }
        provider.on('synced' as never, onSynced as never)
      }

      this.onRoomCb?.({
        ydoc:        this.handles.ydoc,
        provider:    this.handles.provider,
        persistence: this.handles.persistence ?? null,
        synced:      this.synced,
      })
    } catch (e) {
      this.syncedReject(e instanceof Error ? e : new Error(String(e)))
      // Best-effort cleanup of anything we did manage to construct
      this.cancelled = true
      this.destroyHandles()
      throw e
    }
  }

  /**
   * Tear down all handles. Idempotent — safe under React strict-mode
   * double-invokes. Notifies the consumer with `null` so they can
   * re-render against an empty room.
   */
  stop(): void {
    if (this.stopped) return
    this.stopped   = true
    this.cancelled = true
    // Best-effort awareness clear before disconnect so other peers see
    // us leave instead of timing out our cursor.
    try { this.handles.provider?.awareness.setLocalState(null) } catch { /* not initialized yet */ }
    this.destroyHandles()
    this.onRoomCb?.(null)
    // Reject the synced promise so anything still awaiting it unblocks.
    this.syncedReject(new Error('CollabRoomManager: stopped before sync'))
  }

  private destroyHandles(): void {
    try { this.handles.provider?.disconnect() } catch { /* already-closed sockets throw */ }
    try { this.handles.provider?.destroy()    } catch { /* idempotent destroy */ }
    try { this.handles.persistence?.destroy() } catch { /* idempotent destroy */ }
    try { this.handles.ydoc?.destroy()        } catch { /* idempotent destroy */ }
    this.handles = {}
  }
}
