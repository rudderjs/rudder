import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import * as Y from 'yjs'
import {
  MemoryPersistence,
  Sync,
  _handleConnection,
  _resetFirstConnectFired,
  type SyncConfig,
  type SyncPersistence,
} from './index.js'

// ─── Test helpers ────────────────────────────────────────────

/**
 * Slow-loading persistence. Wraps a backing store and delays the first
 * `getYDoc` call by `delayMs` so we can assert the async accessors actually
 * await `room.ready` (the sync versions return before the persistence load
 * resolves; the async versions wait).
 */
function slowPersistence(backing: SyncPersistence, delayMs: number): SyncPersistence {
  return {
    async getYDoc(docName) {
      await new Promise(r => setTimeout(r, delayMs))
      return backing.getYDoc(docName)
    },
    storeUpdate:    backing.storeUpdate.bind(backing),
    getStateVector: backing.getStateVector.bind(backing),
    getDiff:        backing.getDiff.bind(backing),
    clearDocument:  backing.clearDocument.bind(backing),
    destroy:        backing.destroy.bind(backing),
  }
}

/**
 * Bind Sync's persistence to a specific adapter — the facade reads from
 * `globalThis[PERSIST_KEY]` (set by `SyncProvider.register`), so tests that
 * exercise the facade have to populate that slot directly.
 */
function bindPersistence(p: SyncPersistence): void {
  ;(globalThis as Record<string, unknown>)['__rudderjs_live_persistence__'] = p
}

/**
 * Minimal `WsSocket` mock. `handleConnection` only calls `.send()`, `.on()`,
 * and reads `.readyState`; the EventEmitter provides `.on` / `.emit` so the
 * message + close listeners register without error.
 */
function mockSocket(): { ws: import('ws').WebSocket; sent: Uint8Array[] } {
  const sent: Uint8Array[] = []
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1, // OPEN
    send(data: Uint8Array | string) {
      if (data instanceof Uint8Array) sent.push(data)
    },
    close: () => {},
  }) as unknown as import('ws').WebSocket
  return { ws, sent }
}

/** Minimal `IncomingMessage` mock — `handleConnection` only reads `.url`. */
function mockReq(url: string): import('node:http').IncomingMessage {
  return { url } as import('node:http').IncomingMessage
}

let _testCounter = 0
function uniqueDoc(label: string): string {
  return `${label}-${++_testCounter}-${Math.random().toString(36).slice(2, 6)}`
}

// ─── Async read accessors ────────────────────────────────────

describe('Sync.snapshotAsync', () => {
  beforeEach(() => { _resetFirstConnectFired() })

  it('waits for persistence load before returning', async () => {
    const docName = uniqueDoc('snap-async')

    // Seed the backing persistence with a known update.
    const backing = new MemoryPersistence()
    const source  = new Y.Doc()
    source.getText('content').insert(0, 'hello from db')
    await backing.storeUpdate(docName, Y.encodeStateAsUpdate(source))

    // 20ms delay on the slow wrapper — long enough that the sync sibling
    // would visibly miss the seeded state if it were used here.
    bindPersistence(slowPersistence(backing, 20))

    const snapshot = await Sync.snapshotAsync(docName)
    const decoded  = new Y.Doc()
    Y.applyUpdate(decoded, snapshot)
    assert.strictEqual(
      decoded.getText('content').toString(),
      'hello from db',
      'async snapshot must reflect persisted state',
    )
  })

  it('sync `snapshot()` does NOT wait — regression guard documenting why async exists', async () => {
    const docName = uniqueDoc('snap-sync')

    const backing = new MemoryPersistence()
    const source  = new Y.Doc()
    source.getText('content').insert(0, 'should be missed')
    await backing.storeUpdate(docName, Y.encodeStateAsUpdate(source))

    bindPersistence(slowPersistence(backing, 20))

    // First call kicks off the persistence load but returns immediately.
    const snapshot = Sync.snapshot(docName)
    const decoded  = new Y.Doc()
    Y.applyUpdate(decoded, snapshot)
    assert.strictEqual(
      decoded.getText('content').toString(),
      '',
      'sync snapshot returns the empty in-process doc before persistence resolves',
    )
  })
})

describe('Sync.readMapAsync', () => {
  it('waits for persistence load before reading the map', async () => {
    const docName = uniqueDoc('map-async')

    const backing = new MemoryPersistence()
    const source  = new Y.Doc()
    source.getMap('fields').set('title', 'Hello')
    source.getMap('fields').set('body',  'World')
    await backing.storeUpdate(docName, Y.encodeStateAsUpdate(source))

    bindPersistence(slowPersistence(backing, 20))

    const fields = await Sync.readMapAsync(docName, 'fields')
    assert.deepStrictEqual(fields, { title: 'Hello', body: 'World' })
  })
})

describe('Sync.readText', () => {
  it('returns Y.Text content after persistence load', async () => {
    const docName = uniqueDoc('text-content')

    const backing = new MemoryPersistence()
    const source  = new Y.Doc()
    source.getText('body').insert(0, 'rich text payload')
    await backing.storeUpdate(docName, Y.encodeStateAsUpdate(source))

    bindPersistence(slowPersistence(backing, 20))

    const body = await Sync.readText(docName, 'body')
    assert.strictEqual(body, 'rich text payload')
  })

  it('returns empty string when the Y.Text has never been written', async () => {
    const docName = uniqueDoc('text-empty')
    bindPersistence(new MemoryPersistence())

    const body = await Sync.readText(docName, 'never-written')
    assert.strictEqual(body, '')
  })
})

describe('Sync.load', () => {
  it('returns a hydrated doc that round-trips through persistence', async () => {
    const docName = uniqueDoc('load')

    const backing = new MemoryPersistence()
    const source  = new Y.Doc()
    source.getText('body').insert(0, 'seeded')
    await backing.storeUpdate(docName, Y.encodeStateAsUpdate(source))

    bindPersistence(slowPersistence(backing, 10))

    const doc = await Sync.load(docName)
    assert.strictEqual(doc.getText('body').toString(), 'seeded')

    // Mutations on the returned doc are visible to a subsequent `load()`
    // call — same room, same Y.Doc instance.
    doc.getText('body').insert(doc.getText('body').length, ' + edited')
    const doc2 = await Sync.load(docName)
    assert.strictEqual(doc2.getText('body').toString(), 'seeded + edited')
  })
})

// ─── onFirstConnect ──────────────────────────────────────────

describe('onFirstConnect', () => {
  beforeEach(() => { _resetFirstConnectFired() })

  it('fires exactly once per docName even with two concurrent connections', async () => {
    const docName = uniqueDoc('once')
    const persistence = new MemoryPersistence()

    let calls = 0
    const onFirstConnect: SyncConfig['onFirstConnect'] = (_name, _doc, _ctx) => {
      calls++
    }

    const s1 = mockSocket()
    const s2 = mockSocket()

    await Promise.all([
      _handleConnection(s1.ws, mockReq(`/ws-sync/${docName}`), persistence, undefined, onFirstConnect),
      _handleConnection(s2.ws, mockReq(`/ws-sync/${docName}`), persistence, undefined, onFirstConnect),
    ])

    assert.strictEqual(calls, 1, 'hook must fire exactly once per docName per process')
  })

  it('fires after room.ready — hook sees persisted state, not the empty placeholder', async () => {
    const docName = uniqueDoc('after-ready')

    const backing = new MemoryPersistence()
    const source  = new Y.Doc()
    source.getText('title').insert(0, 'persisted-title')
    await backing.storeUpdate(docName, Y.encodeStateAsUpdate(source))

    const persistence = slowPersistence(backing, 25)

    let observedTitle: string | null = null
    const onFirstConnect: SyncConfig['onFirstConnect'] = (_name, doc) => {
      observedTitle = doc.getText('title').toString()
    }

    const { ws } = mockSocket()
    await _handleConnection(ws, mockReq(`/ws-sync/${docName}`), persistence, undefined, onFirstConnect)

    assert.strictEqual(observedTitle, 'persisted-title')
  })

  it('un-marks the docName on throw so a subsequent connection retries', async () => {
    const docName = uniqueDoc('retry')
    const persistence = new MemoryPersistence()

    let calls = 0
    const onFirstConnect: SyncConfig['onFirstConnect'] = () => {
      calls++
      if (calls === 1) throw new Error('boom')
    }

    const s1 = mockSocket()
    await _handleConnection(s1.ws, mockReq(`/ws-sync/${docName}`), persistence, undefined, onFirstConnect)

    const s2 = mockSocket()
    await _handleConnection(s2.ws, mockReq(`/ws-sync/${docName}`), persistence, undefined, onFirstConnect)

    assert.strictEqual(calls, 2, 'hook must retry on throw — first throws, second sees a fresh attempt')

    // A third connection sees the hook succeeded, so should NOT re-fire.
    const s3 = mockSocket()
    await _handleConnection(s3.ws, mockReq(`/ws-sync/${docName}`), persistence, undefined, onFirstConnect)
    assert.strictEqual(calls, 2, 'after successful retry, no further fires')
  })

  it('is optional — connections succeed when the hook is undefined', async () => {
    const docName = uniqueDoc('optional')
    const persistence = new MemoryPersistence()

    const { ws, sent } = mockSocket()
    await _handleConnection(ws, mockReq(`/ws-sync/${docName}`), persistence, undefined, undefined)

    // Connection completed: step1 message was sent.
    assert.ok(sent.length >= 1, 'connection should have sent the step1 state vector')
  })

  it('sees consumer writes — seed mutations are visible to the next reader', async () => {
    const docName = uniqueDoc('seed-write')
    const persistence = new MemoryPersistence()

    const onFirstConnect: SyncConfig['onFirstConnect'] = (_name, doc) => {
      doc.transact(() => {
        if (doc.getText('title').length === 0) {
          doc.getText('title').insert(0, 'seeded-from-hook')
        }
      })
    }

    const { ws } = mockSocket()
    await _handleConnection(ws, mockReq(`/ws-sync/${docName}`), persistence, undefined, onFirstConnect)

    // Bind Sync to the same persistence so readText sees the hook's writes.
    bindPersistence(persistence)
    const title = await Sync.readText(docName, 'title')
    assert.strictEqual(title, 'seeded-from-hook')
  })
})
