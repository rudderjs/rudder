import { describe, it, beforeEach } from 'node:test'
import assert                       from 'node:assert/strict'
import { CollabRoomManager }        from './CollabRoomManager.js'
import type { CollabRoom }          from './types.js'

// ─── Mocks ──────────────────────────────────────────────────────
//
// The manager's only contract with the upstream libs is the small
// surface used inside `start()` / `stop()`. We mock those shapes so
// tests run without `y-websocket` / `y-indexeddb` being available.

interface MockDoc {
  destroyed:        boolean
  fragments:        Map<string, { length: number }>
  destroy():        void
  getXmlFragment(k: string): { length: number }
  transact(fn: () => void, origin?: string): void
}

interface MockProvider {
  url:           string
  roomKey:       string
  doc:           unknown
  destroyed:     boolean
  disconnected:  boolean
  synced:        boolean
  awareness:     { setLocalState: (state: unknown) => void; clearedTo: unknown[] }
  listeners:     Map<string, ((...args: unknown[]) => void)[]>
  on(event: string, cb: (...args: unknown[]) => void): void
  off(event: string, cb: (...args: unknown[]) => void): void
  emit(event: string, ...args: unknown[]): void
  disconnect():  void
  destroy():     void
}

interface MockPersistence {
  roomKey:   string
  doc:       unknown
  destroyed: boolean
  destroy(): void
}

function makeMockDoc(): MockDoc {
  const fragments = new Map<string, { length: number }>()
  return {
    destroyed: false,
    fragments,
    destroy() { this.destroyed = true },
    getXmlFragment(k) {
      let f = fragments.get(k)
      if (!f) { f = { length: 0 }; fragments.set(k, f) }
      return f
    },
    transact(fn) { fn() },
  }
}

function makeMockProvider(url: string, roomKey: string, doc: unknown): MockProvider {
  const clearedTo: unknown[] = []
  return {
    url, roomKey, doc,
    destroyed: false,
    disconnected: false,
    synced: false,
    awareness: {
      clearedTo,
      setLocalState(state) { clearedTo.push(state) },
    },
    listeners: new Map(),
    on(event, cb) {
      const list = this.listeners.get(event) ?? []
      list.push(cb)
      this.listeners.set(event, list)
    },
    off(event, cb) {
      const list = this.listeners.get(event) ?? []
      this.listeners.set(event, list.filter(fn => fn !== cb))
    },
    emit(event, ...args) {
      ;(this.listeners.get(event) ?? []).forEach(cb => cb(...args))
    },
    disconnect() { this.disconnected = true },
    destroy()    { this.destroyed    = true },
  }
}

function makeMockPersistence(roomKey: string, doc: unknown): MockPersistence {
  return {
    roomKey, doc,
    destroyed: false,
    destroy() { this.destroyed = true },
  }
}

interface MockState {
  docs:         MockDoc[]
  providers:    MockProvider[]
  persistences: MockPersistence[]
}

interface FactoryGates {
  /** When set, the IndexedDB factory waits on this promise before resolving. */
  gateIndexeddb?: Promise<void>
}

function makeFactories(state: MockState, gates: FactoryGates = {}) {
  // Push `this` (the constructed instance) into state, not the helper `p`.
  // The manager interacts with `this`, so external assertions must read the
  // same object — otherwise `Object.assign(this, p)` makes a divergent copy.
  return {
    loadYjs: async (): Promise<typeof import('yjs')> => ({
      Doc: class {
        constructor() {
          Object.assign(this, makeMockDoc())
          state.docs.push(this as unknown as MockDoc)
        }
      } as unknown as typeof import('yjs')['Doc'],
    } as unknown as typeof import('yjs')),

    loadWebsocket: async (): Promise<typeof import('y-websocket')> => ({
      WebsocketProvider: class {
        constructor(url: string, roomKey: string, doc: unknown) {
          Object.assign(this, makeMockProvider(url, roomKey, doc))
          state.providers.push(this as unknown as MockProvider)
        }
      } as unknown as typeof import('y-websocket')['WebsocketProvider'],
    } as unknown as typeof import('y-websocket')),

    loadIndexeddb: async (): Promise<typeof import('y-indexeddb')> => {
      if (gates.gateIndexeddb) await gates.gateIndexeddb
      return {
        IndexeddbPersistence: class {
          constructor(roomKey: string, doc: unknown) {
            Object.assign(this, makeMockPersistence(roomKey, doc))
            state.persistences.push(this as unknown as MockPersistence)
          }
        } as unknown as typeof import('y-indexeddb')['IndexeddbPersistence'],
      } as unknown as typeof import('y-indexeddb')
    },
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('CollabRoomManager', () => {
  let state: MockState

  beforeEach(() => {
    state = { docs: [], providers: [], persistences: [] }
  })

  it('constructs a room and notifies onRoomChange when start() resolves', async () => {
    const seen: (CollabRoom | null)[] = []
    const mgr = new CollabRoomManager({
      roomKey:  'doc:1',
      wsUrl:    'ws://test',
      factories: makeFactories(state),
    })
    mgr.onRoomChange(room => seen.push(room))
    await mgr.start()

    assert.equal(state.docs.length, 1)
    assert.equal(state.providers.length, 1)
    assert.equal(state.persistences.length, 0, 'no IDB without offline:true')
    assert.equal(seen.length, 1)
    assert.ok(seen[0])
    assert.equal(seen[0]?.persistence, null)
  })

  it('constructs IndexeddbPersistence when offline:true', async () => {
    const mgr = new CollabRoomManager({
      roomKey:  'doc:2',
      wsUrl:    'ws://test',
      offline:  true,
      factories: makeFactories(state),
    })
    await mgr.start()

    assert.equal(state.persistences.length, 1)
    assert.equal(state.persistences[0]?.roomKey, 'doc:2')
  })

  it('resolves synced when provider emits "synced"', async () => {
    const mgr = new CollabRoomManager({
      roomKey:  'doc:3',
      wsUrl:    'ws://test',
      factories: makeFactories(state),
    })
    await mgr.start()

    let resolved = false
    mgr.synced.then(() => { resolved = true })

    // Not resolved yet
    await new Promise(r => setImmediate(r))
    assert.equal(resolved, false)

    // Emit synced → resolution
    state.providers[0]!.emit('synced')
    await mgr.synced
    assert.equal(resolved, true)
  })

  it('resolves synced immediately if provider.synced is true at construction', async () => {
    // Pre-flip the mock's `synced` flag before the manager constructs it.
    // Simulates the y-websocket fast path where a peer that reconnects to
    // a doc already in IDB skips the network round-trip.
    const factories = makeFactories(state)
    const originalLoadWs = factories.loadWebsocket
    factories.loadWebsocket = async () => {
      const mod = await originalLoadWs()
      return {
        ...mod,
        WebsocketProvider: class extends (mod.WebsocketProvider as unknown as new (...a: unknown[]) => Record<string, unknown>) {
          constructor(...args: unknown[]) {
            super(...args)
            ;(this as unknown as { synced: boolean }).synced = true
          }
        } as unknown as typeof import('y-websocket')['WebsocketProvider'],
      }
    }

    const mgr = new CollabRoomManager({
      roomKey:  'doc:3b',
      wsUrl:    'ws://test',
      factories,
    })
    await mgr.start()
    await mgr.synced  // resolves without an emit
  })

  it('stop() before start() prevents construction', async () => {
    const mgr = new CollabRoomManager({
      roomKey:  'doc:4',
      wsUrl:    'ws://test',
      factories: makeFactories(state),
    })
    mgr.stop()
    await mgr.start()

    assert.equal(state.docs.length, 0, 'Y.Doc never constructed after stop')
    assert.equal(state.providers.length, 0)
  })

  it('stop() during start() cleans up partial handles', async () => {
    // Externally-controlled gate so we can deterministically stop the
    // manager between provider construction and IDB construction.
    let releaseIdb!: () => void
    const idbGate = new Promise<void>(r => { releaseIdb = r })

    const mgr = new CollabRoomManager({
      roomKey:  'doc:5',
      wsUrl:    'ws://test',
      offline:  true,
      factories: makeFactories(state, { gateIndexeddb: idbGate }),
    })
    const startPromise = mgr.start()

    // Yield to microtasks so yjs + ws factories settle and the provider
    // is constructed. IDB factory is now parked at `await gates.gateIndexeddb`.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    mgr.stop()
    releaseIdb()  // unblock IDB factory — manager should bail before constructing
    await startPromise

    assert.equal(state.docs.length, 1)
    assert.equal(state.providers.length, 1)
    assert.equal(state.persistences.length, 0, 'IDB skipped because cancelled mid-construction')
    assert.equal(state.providers[0]?.destroyed, true, 'provider destroyed by stop()')
    assert.equal(state.docs[0]?.destroyed, true, 'doc destroyed by stop()')
  })

  it('stop() is idempotent — second call is a no-op', async () => {
    const mgr = new CollabRoomManager({
      roomKey:  'doc:6',
      wsUrl:    'ws://test',
      offline:  true,
      factories: makeFactories(state),
    })
    await mgr.start()
    mgr.stop()
    const destroyedCountBefore = state.providers[0]?.destroyed
    mgr.stop()
    assert.equal(state.providers[0]?.destroyed, destroyedCountBefore)
  })

  it('stop() destroys provider + persistence + doc and clears awareness', async () => {
    const mgr = new CollabRoomManager({
      roomKey:  'doc:7',
      wsUrl:    'ws://test',
      offline:  true,
      factories: makeFactories(state),
    })
    await mgr.start()
    mgr.stop()

    assert.equal(state.providers[0]?.disconnected, true)
    assert.equal(state.providers[0]?.destroyed, true)
    assert.equal(state.persistences[0]?.destroyed, true)
    assert.equal(state.docs[0]?.destroyed, true)
    assert.deepEqual(state.providers[0]?.awareness.clearedTo, [null])
  })

  it('onRoomChange fires null on stop()', async () => {
    const seen: (CollabRoom | null)[] = []
    const mgr = new CollabRoomManager({
      roomKey:  'doc:8',
      wsUrl:    'ws://test',
      factories: makeFactories(state),
    })
    mgr.onRoomChange(r => seen.push(r))
    await mgr.start()
    mgr.stop()

    assert.equal(seen.length, 2)
    assert.ok(seen[0], 'first call: room constructed')
    assert.equal(seen[1], null, 'second call: stopped')
  })

  it('synced promise rejects when stop() runs before provider emits', async () => {
    const mgr = new CollabRoomManager({
      roomKey:  'doc:9',
      wsUrl:    'ws://test',
      factories: makeFactories(state),
    })
    await mgr.start()
    mgr.stop()

    await assert.rejects(mgr.synced, /stopped before sync/)
  })

  it('start() throws and cleans up if a factory rejects', async () => {
    const mgr = new CollabRoomManager({
      roomKey:  'doc:10',
      wsUrl:    'ws://test',
      factories: {
        loadYjs:       () => Promise.reject(new Error('yjs unavailable')),
        loadWebsocket: () => Promise.resolve({} as typeof import('y-websocket')),
        loadIndexeddb: () => Promise.resolve({} as typeof import('y-indexeddb')),
      },
    })

    await assert.rejects(mgr.start(), /yjs unavailable/)
    await assert.rejects(mgr.synced, /yjs unavailable/)
    assert.equal(state.docs.length, 0)
    assert.equal(state.providers.length, 0)
  })

  it('start() is one-shot — second call throws and never double-constructs', async () => {
    const mgr = new CollabRoomManager({
      roomKey:  'doc:11',
      wsUrl:    'ws://test',
      factories: makeFactories(state),
    })
    await mgr.start()
    await assert.rejects(mgr.start(), /called twice/)
    assert.equal(state.docs.length, 1)
    assert.equal(state.providers.length, 1)
  })

  it('marks the room denied and stops on a 4401 auth-denied close', async () => {
    const seen: (CollabRoom | null)[] = []
    let deniedFired = 0
    const mgr = new CollabRoomManager({
      roomKey:  'doc:auth',
      wsUrl:    'ws://test',
      factories: makeFactories(state),
    })
    mgr.onRoomChange(room => seen.push(room))
    mgr.onDenied(() => { deniedFired++ })
    await mgr.start()

    assert.equal(mgr.denied, false)
    assert.ok(seen[0], 'room emitted on start')

    state.providers[0]!.emit('connection-close', { code: 4401 })

    assert.equal(mgr.denied, true)
    assert.equal(deniedFired, 1)
    assert.equal(state.providers[0]!.disconnected, true, 'provider disconnected to stop the reconnect loop')
    assert.equal(seen[seen.length - 1], null, 'room cleared to null on denial')
  })

  it('treats 4403 as auth-denied too', async () => {
    const mgr = new CollabRoomManager({
      roomKey: 'doc:auth2', wsUrl: 'ws://test', factories: makeFactories(state),
    })
    await mgr.start()
    state.providers[0]!.emit('connection-close', { code: 4403 })
    assert.equal(mgr.denied, true)
  })

  it('ignores a transient (non-policy) close code', async () => {
    const seen: (CollabRoom | null)[] = []
    let deniedFired = 0
    const mgr = new CollabRoomManager({
      roomKey: 'doc:blip', wsUrl: 'ws://test', factories: makeFactories(state),
    })
    mgr.onRoomChange(room => seen.push(room))
    mgr.onDenied(() => { deniedFired++ })
    await mgr.start()

    state.providers[0]!.emit('connection-close', { code: 1006 })   // abnormal closure

    assert.equal(mgr.denied, false)
    assert.equal(deniedFired, 0)
    assert.equal(state.providers[0]!.disconnected, false)
    assert.notEqual(seen[seen.length - 1], null, 'room left intact on a transient blip')
  })

  it('removes the close listener on stop()', async () => {
    const mgr = new CollabRoomManager({
      roomKey: 'doc:cleanup', wsUrl: 'ws://test', factories: makeFactories(state),
    })
    await mgr.start()
    mgr.stop()
    // A late close event after teardown must not flip denied.
    state.providers[0]!.emit('connection-close', { code: 4401 })
    assert.equal(mgr.denied, false)
  })
})
