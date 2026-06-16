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

/**
 * WebSocket close codes the sync server's `onAuth` gate uses to reject an
 * upgrade (see `createCollabRoomAuth` / the server's `ws.close(4401, …)`).
 * A close with one of these codes is a POLICY verdict, not a transient
 * network blip, so the manager stops reconnecting on it.
 */
const AUTH_DENIED_CLOSE_CODES = new Set([4401, 4403])

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
  private onDeniedCb?: () => void
  private closeHandler?: ((event: unknown) => void) | undefined
  private deniedFlag = false

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
   * `true` once the server rejected the WS upgrade with an auth-denied close
   * code (4401/4403). A denied room never syncs, so consumers should treat it
   * as nonexistent and fall back to non-collaborative editing.
   */
  get denied(): boolean {
    return this.deniedFlag
  }

  /**
   * Register a callback fired once when the room is auth-denied (the server
   * closed the upgrade with 4401/4403). The manager has already stopped
   * reconnecting and emitted a `null` room via {@link onRoomChange} by the
   * time this fires. Single-slot — last registration wins.
   */
  onDenied(cb: () => void): void {
    this.onDeniedCb = cb
  }

  /**
   * Lazy-imports peers, constructs handles, wires sync resolution.
   *
   * One-shot — a `CollabRoomManager` instance binds to a single
   * `(roomKey, wsUrl, offline)` triple and a single connection attempt.
   * Calling `start()` twice on the same instance throws: if the first
   * call was cancelled mid-`loadYjs` (e.g. via React strict-mode
   * double-invoke), the `synced` promise is already rejected and there's
   * no observable success path for the second call to resolve. Throwing
   * makes the misuse loud instead of leaving consumers waiting on a dead
   * promise. Construct a fresh manager to retry.
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('CollabRoomManager.start() called twice — construct a fresh manager to retry')
    }
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

      // y-websocket treats every socket close as transient and reconnects
      // immediately (no backoff). An auth-denied close (4401/4403 from the
      // server's onAuth gate) is a policy verdict, not a blip — disconnect
      // for good, mark the room denied, and surface a `null` room so the
      // consumer falls back to non-collaborative editing. (`connection-close`
      // isn't on y-websocket's typed event map; cast like the `synced` path.)
      const onClose = (event: unknown): void => {
        const code = (event as { code?: number } | null)?.code
        if (code == null || !AUTH_DENIED_CLOSE_CODES.has(code)) return
        this.deniedFlag = true
        this.cancelled  = true
        try { provider.disconnect() } catch { /* already torn down */ }
        this.onRoomCb?.(null)
        this.onDeniedCb?.()
      }
      this.closeHandler = onClose
      provider.on('connection-close' as never, onClose as never)

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
    if (this.closeHandler) {
      try { this.handles.provider?.off('connection-close' as never, this.closeHandler as never) } catch { /* torn down */ }
      this.closeHandler = undefined
    }
    try { this.handles.provider?.disconnect() } catch { /* already-closed sockets throw */ }
    try { this.handles.provider?.destroy()    } catch { /* idempotent destroy */ }
    try { this.handles.persistence?.destroy() } catch { /* idempotent destroy */ }
    try { this.handles.ydoc?.destroy()        } catch { /* idempotent destroy */ }
    this.handles = {}
  }
}
