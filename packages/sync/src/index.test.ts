import { describe, it, beforeEach } from 'node:test'
import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import {
  MemoryPersistence,
  syncPrisma,
  SyncProvider,
  Sync,
  _handleConnection,
  type SyncPersistence,
  type SyncConfig,
} from './index.js'
import { syncObservers } from './observers.js'
import { SYNC_KEYS } from './globals.js'

// ─── MemoryPersistence ───────────────────────────────────────

describe('MemoryPersistence', () => {
  let persistence: MemoryPersistence

  beforeEach(() => { persistence = new MemoryPersistence() })

  it('getYDoc() returns a new empty doc for an unknown docName', async () => {
    const doc = await persistence.getYDoc('test')
    assert.ok(doc instanceof Y.Doc)
    assert.strictEqual(Y.encodeStateVector(doc).length, 1, 'empty doc state vector is 1 byte (varint 0)')
  })

  it('getYDoc() returns the same doc instance for repeated calls', async () => {
    const a = await persistence.getYDoc('same')
    const b = await persistence.getYDoc('same')
    assert.strictEqual(a, b)
  })

  it('getYDoc() returns independent docs for different docNames', async () => {
    const a = await persistence.getYDoc('doc-a')
    const b = await persistence.getYDoc('doc-b')
    assert.notStrictEqual(a, b)
  })

  it('storeUpdate() applies update to the doc', async () => {
    // Create an update on a separate doc
    const source = new Y.Doc()
    const text   = source.getText('content')
    text.insert(0, 'hello')
    const update = Y.encodeStateAsUpdate(source)

    await persistence.storeUpdate('my-doc', update)

    const doc  = await persistence.getYDoc('my-doc')
    const ytext = doc.getText('content')
    assert.strictEqual(ytext.toString(), 'hello')
  })

  it('storeUpdate() accumulates multiple updates', async () => {
    const source = new Y.Doc()
    const text   = source.getText('content')
    text.insert(0, 'hello')
    const u1 = Y.encodeStateAsUpdate(source)

    text.insert(5, ' world')
    const u2 = Y.encodeStateAsUpdate(source)

    await persistence.storeUpdate('multi', u1)
    await persistence.storeUpdate('multi', u2)

    const doc = await persistence.getYDoc('multi')
    assert.strictEqual(doc.getText('content').toString(), 'hello world')
  })

  it('getStateVector() returns state vector of stored doc', async () => {
    const source = new Y.Doc()
    source.getText('content').insert(0, 'test')
    const update = Y.encodeStateAsUpdate(source)
    await persistence.storeUpdate('sv-doc', update)

    const sv = await persistence.getStateVector('sv-doc')
    assert.ok(sv instanceof Uint8Array)
    assert.ok(sv.length > 0)
  })

  it('getDiff() returns update that brings empty doc up to date', async () => {
    const source = new Y.Doc()
    source.getText('content').insert(0, 'sync me')
    const update = Y.encodeStateAsUpdate(source)
    await persistence.storeUpdate('diff-doc', update)

    const emptyClientSV = Y.encodeStateVector(new Y.Doc())
    const diff          = await persistence.getDiff('diff-doc', emptyClientSV)

    const target = new Y.Doc()
    Y.applyUpdate(target, diff)
    assert.strictEqual(target.getText('content').toString(), 'sync me')
  })

  it('getDiff() with up-to-date state vector returns empty diff', async () => {
    const source = new Y.Doc()
    source.getText('content').insert(0, 'hello')
    const update = Y.encodeStateAsUpdate(source)
    await persistence.storeUpdate('nodiff', update)

    // Get the current state vector (fully up to date)
    const currentSV = await persistence.getStateVector('nodiff')
    const diff      = await persistence.getDiff('nodiff', currentSV)

    // Applying an empty/no-op diff should not change anything meaningful
    const target = new Y.Doc()
    Y.applyUpdate(target, diff)
    // Empty diff — target remains empty (diff is empty update = 2 bytes)
    assert.ok(diff.length <= 2)
  })

  it('clearDocument() removes the document', async () => {
    const source = new Y.Doc()
    source.getText('content').insert(0, 'delete me')
    await persistence.storeUpdate('to-clear', Y.encodeStateAsUpdate(source))

    // Verify it exists
    const before = await persistence.getYDoc('to-clear')
    assert.strictEqual(before.getText('content').toString(), 'delete me')

    await persistence.clearDocument('to-clear')

    // After clear, a new empty doc is returned
    const after = await persistence.getYDoc('to-clear')
    assert.strictEqual(after.getText('content').toString(), '')
  })

  it('clearDocument() on non-existent doc is a no-op', async () => {
    await assert.doesNotReject(() => persistence.clearDocument('ghost'))
  })

  it('destroy() clears all documents', async () => {
    const s1 = new Y.Doc(); s1.getText('t').insert(0, 'a')
    const s2 = new Y.Doc(); s2.getText('t').insert(0, 'b')
    await persistence.storeUpdate('d1', Y.encodeStateAsUpdate(s1))
    await persistence.storeUpdate('d2', Y.encodeStateAsUpdate(s2))

    await persistence.destroy()

    // After destroy, new fresh docs are returned
    const d1 = await persistence.getYDoc('d1')
    assert.strictEqual(d1.getText('t').toString(), '')
  })

  it('multiple documents are isolated from each other', async () => {
    const s1 = new Y.Doc(); s1.getText('t').insert(0, 'AAA')
    const s2 = new Y.Doc(); s2.getText('t').insert(0, 'BBB')
    await persistence.storeUpdate('isolated-a', Y.encodeStateAsUpdate(s1))
    await persistence.storeUpdate('isolated-b', Y.encodeStateAsUpdate(s2))

    const da = await persistence.getYDoc('isolated-a')
    const db = await persistence.getYDoc('isolated-b')
    assert.strictEqual(da.getText('t').toString(), 'AAA')
    assert.strictEqual(db.getText('t').toString(), 'BBB')
  })
})

// ─── SyncConfig interface ─────────────────────────────────────

describe('SyncProvider', () => {
  it('is a ServiceProvider class', () => {
    assert.strictEqual(typeof SyncProvider, 'function')
    assert.strictEqual(SyncProvider.name, 'SyncProvider')
  })
})

describe('SyncProvider.register — dev HMR persistence reuse', () => {
  const G = globalThis as Record<string, unknown>
  const makeFake = (): SyncPersistence => ({
    async getYDoc()        { return new Y.Doc() },
    async storeUpdate()    {},
    async getStateVector() { return new Uint8Array() },
    async getDiff()        { return new Uint8Array() },
    async clearDocument()  {},
    async destroy()        {},
  })
  beforeEach(() => { delete G[SYNC_KEYS.persistence] })

  it('reuses the first persistence across re-boots (a re-built syncRedis() does not open a new connection)', async () => {
    const core     = await import('@rudderjs/core')
    const previous = core.getConfigRepository?.()
    const fakeApp  = { bind: () => {} } as never
    const adapterA = makeFake()
    const adapterB = makeFake()
    try {
      core.setConfigRepository?.(new core.ConfigRepository({ sync: { persistence: adapterA } }))
      new SyncProvider(fakeApp).register()
      assert.strictEqual(G[SYNC_KEYS.persistence], adapterA, 'first register stores adapterA')

      // Simulate a dev HMR re-boot: config re-evaluates and hands register() a
      // freshly-built persistence. It must be ignored — the live one wins.
      core.setConfigRepository?.(new core.ConfigRepository({ sync: { persistence: adapterB } }))
      new SyncProvider(fakeApp).register()
      assert.strictEqual(G[SYNC_KEYS.persistence], adapterA, 're-boot reuses adapterA; adapterB is inert (never connects)')
    } finally {
      delete G[SYNC_KEYS.persistence]
      if (previous) core.setConfigRepository?.(previous)
    }
  })
})

// ─── SyncPersistence interface (custom adapter) ──────────────

describe('Custom SyncPersistence adapter', () => {
  it('satisfies the interface when all methods are provided', () => {
    const adapter: SyncPersistence = {
      async getYDoc()        { return new Y.Doc() },
      async storeUpdate()    {},
      async getStateVector() { return new Uint8Array() },
      async getDiff()        { return new Uint8Array() },
      async clearDocument()  {},
      async destroy()        {},
    }
    assert.strictEqual(typeof adapter.getYDoc,        'function')
    assert.strictEqual(typeof adapter.storeUpdate,    'function')
    assert.strictEqual(typeof adapter.getStateVector, 'function')
    assert.strictEqual(typeof adapter.getDiff,        'function')
    assert.strictEqual(typeof adapter.clearDocument,  'function')
    assert.strictEqual(typeof adapter.destroy,        'function')
  })

  describe('syncPrisma', () => {
    it('caches reconstructed docs per docName and avoids repeated full replay', async () => {
      const rowsByDoc = new Map<string, Array<{ update: Uint8Array }>>()
      const source = new Y.Doc()
      source.getText('content').insert(0, 'cached')
      rowsByDoc.set('cached-doc', [{ update: Y.encodeStateAsUpdate(source) }])

      let findManyCalls = 0
      const persistence = syncPrisma({
        client: {
          syncDocument: {
            async findMany(args: unknown) {
              findManyCalls++
              const docName = (args as { where: { docName: string } }).where.docName
              return rowsByDoc.get(docName) ?? []
            },
            async create() { return {} },
            async deleteMany() { return {} },
          },
        },
      })

      const a = await persistence.getYDoc('cached-doc')
      const b = await persistence.getYDoc('cached-doc')

      assert.strictEqual(a, b, 'subsequent getYDoc() should return the cached instance')
      assert.strictEqual(findManyCalls, 1, 'persistence replay should run only once per cached doc')
    })

    it('applies storeUpdate to cached docs and invalidates cache on clearDocument', async () => {
      const rowsByDoc = new Map<string, Array<{ update: Uint8Array }>>()
      let findManyCalls = 0

      const persistence = syncPrisma({
        client: {
          syncDocument: {
            async findMany(args: unknown) {
              findManyCalls++
              const docName = (args as { where: { docName: string } }).where.docName
              return rowsByDoc.get(docName) ?? []
            },
            async create(args: unknown) {
              const { docName, update } = (args as { data: { docName: string; update: Uint8Array } }).data
              const rows = rowsByDoc.get(docName) ?? []
              rows.push({ update })
              rowsByDoc.set(docName, rows)
              return {}
            },
            async deleteMany(args: unknown) {
              const docName = (args as { where: { docName: string } }).where.docName
              rowsByDoc.delete(docName)
              return {}
            },
          },
        },
      })

      const source = new Y.Doc()
      const text = source.getText('content')
      text.insert(0, 'hello')
      await persistence.storeUpdate('cached-doc', Y.encodeStateAsUpdate(source))

      const cached = await persistence.getYDoc('cached-doc')
      assert.strictEqual(cached.getText('content').toString(), 'hello')
      assert.strictEqual(findManyCalls, 1)

      text.insert(5, ' world')
      await persistence.storeUpdate('cached-doc', Y.encodeStateAsUpdate(source))
      assert.strictEqual(cached.getText('content').toString(), 'hello world', 'cached in-memory doc should advance on storeUpdate')
      assert.strictEqual(findManyCalls, 1, 'storeUpdate should not trigger another replay for cached docs')

      await persistence.clearDocument('cached-doc')

      const fresh = new Y.Doc()
      fresh.getText('content').insert(0, 'fresh')
      await persistence.storeUpdate('cached-doc', Y.encodeStateAsUpdate(fresh))

      const reloaded = await persistence.getYDoc('cached-doc')
      assert.notStrictEqual(reloaded, cached, 'clearDocument should evict the cached doc instance')
      assert.strictEqual(reloaded.getText('content').toString(), 'fresh')
      assert.strictEqual(findManyCalls, 2, 'a cleared doc should be replayed again on next getYDoc')
    })
  })

  it('persistence.storeUpdate() is called with the correct doc name and update', async () => {
    const calls: Array<{ docName: string; update: Uint8Array }> = []
    const adapter: SyncPersistence = {
      async getYDoc()       { return new Y.Doc() },
      async storeUpdate(docName, update) { calls.push({ docName, update }) },
      async getStateVector() { return Y.encodeStateVector(new Y.Doc()) },
      async getDiff()       { return new Uint8Array() },
      async clearDocument() {},
      async destroy()       {},
    }

    const source = new Y.Doc()
    source.getText('t').insert(0, 'test')
    const update = Y.encodeStateAsUpdate(source)

    await adapter.storeUpdate('my-room', update)

    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0]?.docName, 'my-room')
    assert.deepStrictEqual(calls[0]?.update, update)
  })
})

// ─── Yjs CRDT fundamentals (used by the sync protocol) ───────

describe('Yjs CRDT basics', () => {
  it('two docs converge when applying each other\'s updates', () => {
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()

    doc1.getText('t').insert(0, 'hello')
    const u1 = Y.encodeStateAsUpdate(doc1)
    Y.applyUpdate(doc2, u1)

    doc2.getText('t').insert(5, ' world')
    const u2 = Y.encodeStateAsUpdate(doc2, Y.encodeStateVector(doc1))
    Y.applyUpdate(doc1, u2)

    assert.strictEqual(doc1.getText('t').toString(), 'hello world')
    assert.strictEqual(doc2.getText('t').toString(), 'hello world')
  })

  it('applying the same update twice is idempotent (CRDT property)', () => {
    const source = new Y.Doc()
    source.getText('t').insert(0, 'idempotent')
    const update = Y.encodeStateAsUpdate(source)

    const target = new Y.Doc()
    Y.applyUpdate(target, update)
    Y.applyUpdate(target, update) // apply again

    assert.strictEqual(target.getText('t').toString(), 'idempotent')
  })

  it('encodeStateVector() produces a non-empty byte array for a modified doc', () => {
    const doc = new Y.Doc()
    doc.getText('t').insert(0, 'hello')
    const sv = Y.encodeStateVector(doc)
    assert.ok(sv instanceof Uint8Array)
    assert.ok(sv.length > 0)
  })

  it('encodeStateAsUpdate() with stale SV produces minimal diff', () => {
    // Server doc starts with 'hello', client syncs to that state
    const server = new Y.Doc()
    server.getText('t').insert(0, 'hello')
    const baseUpdate = Y.encodeStateAsUpdate(server)

    // Client receives initial state
    const client = new Y.Doc()
    Y.applyUpdate(client, baseUpdate)
    assert.strictEqual(client.getText('t').toString(), 'hello')

    // Client records its current state vector
    const clientSV = Y.encodeStateVector(client)

    // Server adds ' world'
    server.getText('t').insert(5, ' world')

    // Server computes diff since client's last known state
    const diff = Y.encodeStateAsUpdate(server, clientSV)

    // Client applies the incremental diff
    Y.applyUpdate(client, diff)
    assert.strictEqual(client.getText('t').toString(), 'hello world')
    assert.strictEqual(server.getText('t').toString(), 'hello world')
  })

  it('concurrent edits on separate docs merge without conflicts', () => {
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()

    // Both start from the same state
    doc1.getText('t').insert(0, 'base')
    const baseUpdate = Y.encodeStateAsUpdate(doc1)
    Y.applyUpdate(doc2, baseUpdate)

    // Independent edits
    doc1.getText('t').insert(4, '-A')
    doc2.getText('t').insert(4, '-B')

    // Exchange updates
    const u1 = Y.encodeStateAsUpdate(doc1, Y.encodeStateVector(doc2))
    const u2 = Y.encodeStateAsUpdate(doc2, Y.encodeStateVector(doc1))
    Y.applyUpdate(doc1, u2)
    Y.applyUpdate(doc2, u1)

    // Both should converge to the same value (order determined by Yjs)
    assert.strictEqual(doc1.getText('t').toString(), doc2.getText('t').toString())
  })
})

// ─── Sync message encoding helpers ───────────────────────────

describe('Yjs sync protocol message structure', () => {
  // Mirror the private helpers from index.ts to verify encoding
  function readVarUint(buf: Uint8Array, pos: number): [number, number] {
    let result = 0, shift = 0
    while (true) {
      const byte = buf[pos++] ?? 0
      result |= (byte & 0x7f) << shift
      shift  += 7
      if ((byte & 0x80) === 0) break
    }
    return [result, pos]
  }

  function writeVarUint(val: number): Uint8Array {
    const buf: number[] = []
    while (val > 0x7f) { buf.push((val & 0x7f) | 0x80); val >>>= 7 }
    buf.push(val)
    return new Uint8Array(buf)
  }

  function encodeSyncMsg(subType: number, data: Uint8Array): Uint8Array {
    const subTypeBytes = writeVarUint(subType)
    const lenBytes = writeVarUint(data.length)
    const out = new Uint8Array(1 + subTypeBytes.length + lenBytes.length + data.length)
    out[0] = 0 // messageSync
    out.set(subTypeBytes, 1)
    out.set(lenBytes, 1 + subTypeBytes.length)
    out.set(data, 1 + subTypeBytes.length + lenBytes.length)
    return out
  }

  it('writeVarUint encodes small values as a single byte', () => {
    assert.deepStrictEqual(writeVarUint(0),   new Uint8Array([0]))
    assert.deepStrictEqual(writeVarUint(1),   new Uint8Array([1]))
    assert.deepStrictEqual(writeVarUint(127), new Uint8Array([127]))
  })

  it('writeVarUint encodes values > 127 with continuation bit', () => {
    const encoded = writeVarUint(128)
    assert.strictEqual(encoded.length, 2)
    assert.strictEqual(encoded[0]! & 0x80, 0x80, 'first byte has continuation bit')
    assert.strictEqual(encoded[1]! & 0x80, 0,    'last byte has no continuation bit')
  })

  it('readVarUint decodes what writeVarUint encodes (round-trip)', () => {
    for (const val of [0, 1, 127, 128, 255, 1000, 16383, 16384]) {
      const encoded        = writeVarUint(val)
      const [decoded, pos] = readVarUint(encoded, 0)
      assert.strictEqual(decoded, val, `round-trip for ${val}`)
      assert.strictEqual(pos,  encoded.length, `pos for ${val}`)
    }
  })

  it('sync message type byte is 0 for messageSync', () => {
    const messageSync = 0
    const svMsg       = new Uint8Array([0 /* syncStep1 */, 0]) // minimal
    const lenBytes    = writeVarUint(svMsg.length)
    const frame       = new Uint8Array(1 + lenBytes.length + svMsg.length)
    frame[0] = messageSync
    frame.set(lenBytes, 1)
    frame.set(svMsg, 1 + lenBytes.length)

    assert.strictEqual(frame[0], 0) // messageSync
    const [len, pos] = readVarUint(frame, 1)
    assert.strictEqual(len, svMsg.length)
    assert.strictEqual(frame[pos], 0) // syncStep1
  })

  it('awareness message type byte is 1 for messageAwareness', () => {
    const messageAwareness = 1
    const payload          = new Uint8Array([messageAwareness, 5, 0, 1, 2, 3, 4])
    assert.strictEqual(payload[0], messageAwareness)
  })

  it('encodes sync subType as varint (supports values >= 128)', () => {
    const data = new Uint8Array([9, 8, 7])
    const frame = encodeSyncMsg(130, data)

    assert.strictEqual(frame[0], 0, 'frame must start with messageSync')
    const [subType, p1] = readVarUint(frame, 1)
    const [len, p2] = readVarUint(frame, p1)
    assert.strictEqual(subType, 130)
    assert.strictEqual(len, data.length)
    assert.deepStrictEqual(frame.slice(p2, p2 + len), data)
  })
})

// ─── onChange callback ────────────────────────────────────────

describe('SyncConfig.onChange', () => {
  it('onChange is an optional function in config', () => {
    let called = false
    const config: SyncConfig = {
      onChange: (_docName, _update) => { called = true },
    }
    config.onChange?.('doc', new Uint8Array())
    assert.strictEqual(called, true)
  })

  it('onChange can be async', async () => {
    const calls: string[] = []
    const config: SyncConfig = {
      async onChange(docName) { calls.push(docName) },
    }
    await config.onChange?.('async-doc', new Uint8Array())
    assert.deepStrictEqual(calls, ['async-doc'])
  })
})

// ─── onAuth callback ─────────────────────────────────────────

describe('SyncConfig.onAuth', () => {
  it('onAuth can return synchronous boolean', async () => {
    const config: SyncConfig = {
      onAuth: (_req, docName) => docName !== 'private',
    }
    const result = await Promise.resolve(config.onAuth?.({ headers: {}, url: '/' }, 'public'))
    assert.strictEqual(result, true)

    const denied = await Promise.resolve(config.onAuth?.({ headers: {}, url: '/' }, 'private'))
    assert.strictEqual(denied, false)
  })

  it('onAuth can return a Promise', async () => {
    const config: SyncConfig = {
      async onAuth(_req, docName) { return docName === 'allowed' },
    }
    const result = await config.onAuth?.({ headers: {}, url: '/' }, 'allowed')
    assert.strictEqual(result, true)

    const denied = await config.onAuth?.({ headers: {}, url: '/' }, 'denied')
    assert.strictEqual(denied, false)
  })

  it('onAuth receives request headers and doc name', async () => {
    const received: Array<{ headers: Record<string, string | string[] | undefined>; docName: string }> = []
    const config: SyncConfig = {
      onAuth(req, docName) {
        received.push({ headers: req.headers, docName })
        return true
      },
    }
    await Promise.resolve(config.onAuth?.({ headers: { authorization: 'Bearer token' }, url: '/ws-sync/room1' }, 'room1'))
    assert.strictEqual(received.length, 1)
    assert.strictEqual(received[0]?.docName, 'room1')
    assert.strictEqual(received[0]?.headers['authorization'], 'Bearer token')
  })
})

// ─── MemoryPersistence isolation (globalThis state) ──────────

describe('MemoryPersistence instances are independent', () => {
  it('two MemoryPersistence instances do not share documents', async () => {
    const p1 = new MemoryPersistence()
    const p2 = new MemoryPersistence()

    const source = new Y.Doc()
    source.getText('t').insert(0, 'exclusive')
    await p1.storeUpdate('shared-name', Y.encodeStateAsUpdate(source))

    // p2 has no knowledge of p1's documents
    const doc = await p2.getYDoc('shared-name')
    assert.strictEqual(doc.getText('t').toString(), '')
  })
})

// ─── Multi-peer WS broadcast ─────────────────────────────────
//
// Drives `_handleConnection` directly with a minimal MockWsSocket so we can
// assert the broadcast loop fans out an update from one peer to every other
// peer in the same room. Filed alongside pilotiq's
// docs/plans/2026-05-15-sync-ws-multi-peer-diagnostic.md as Option C —
// a defensive regression test that doubles as a known-good reference for
// consumers debugging multi-peer issues.

class MockWsSocket extends EventEmitter {
  public readyState = 1 // ws.OPEN
  public sent: Uint8Array[] = []

  send(data: Uint8Array | Buffer): void {
    this.sent.push(data instanceof Buffer ? new Uint8Array(data) : data)
  }

  // The handler calls `ws.close()` in some paths; no-op in the mock.
  close(): void {
    this.readyState = 3 // ws.CLOSED
  }

  // Inject an inbound frame as if it had arrived over the wire.
  receive(buf: Uint8Array): void {
    this.emit('message', Buffer.from(buf))
  }
}

function writeVarUint(val: number): Uint8Array {
  const out: number[] = []
  while (val > 0x7f) {
    out.push((val & 0x7f) | 0x80)
    val >>>= 7
  }
  out.push(val & 0x7f)
  return new Uint8Array(out)
}

/** Build the y-protocols wire frame for a syncUpdate message. */
function encodeSyncUpdateFrame(update: Uint8Array): Uint8Array {
  // [messageSync=0, syncUpdate=2, dataLen(varint), ...update]
  const len = writeVarUint(update.length)
  const buf = new Uint8Array(2 + len.length + update.length)
  buf[0] = 0 // messageSync
  buf[1] = 2 // syncUpdate
  buf.set(len, 2)
  buf.set(update, 2 + len.length)
  return buf
}

/** Identify the subType (syncStep1=0, syncStep2=1, syncUpdate=2) of a frame. */
function decodeSyncSubType(frame: Uint8Array): number | null {
  if (frame.length < 2) return null
  if (frame[0] !== 0 /* messageSync */) return null
  return frame[1] ?? null
}

describe('Multi-peer WS broadcast', () => {
  it('forwards an update from peer A to peer B in the same room', async () => {
    const persistence = new MemoryPersistence()
    // Unique docName per test — the room registry is process-wide on globalThis.
    const docName = `2peer-fanout-${Date.now()}`
    const url     = `/ws-sync/${docName}`

    const peerA = new MockWsSocket()
    const peerB = new MockWsSocket()

    await _handleConnection(peerA as never, { url } as never, persistence)
    await _handleConnection(peerB as never, { url } as never, persistence)

    // Both peers should have received an initial syncStep1 (state vector).
    assert.strictEqual(decodeSyncSubType(peerA.sent[0]!), 0)
    assert.strictEqual(decodeSyncSubType(peerB.sent[0]!), 0)

    // Track what peer B receives *after* the initial handshake so we can
    // isolate the broadcast frame from the connection-time messages.
    const peerBBaseline = peerB.sent.length

    // Peer A makes a local edit and sends the resulting update.
    const localDocA = new Y.Doc()
    localDocA.getMap('test').set('foo', 'bar')
    const update    = Y.encodeStateAsUpdate(localDocA)
    peerA.receive(encodeSyncUpdateFrame(update))

    // Yield to the message handler's microtasks (applyUpdate → broadcast).
    await new Promise(r => setImmediate(r))

    // Peer B should have received exactly one new frame, a syncUpdate, with
    // peer A's update payload.
    const newFrames = peerB.sent.slice(peerBBaseline)
    assert.strictEqual(newFrames.length, 1, 'peer B should receive exactly one broadcast frame')
    assert.strictEqual(decodeSyncSubType(newFrames[0]!), 2 /* syncUpdate */, 'forwarded frame should be a syncUpdate')

    // Peer A should NOT receive its own update back (originator skip).
    // We know connection-time messages, then nothing new — assert no frames
    // arrived after the broadcast window.
    const peerASentBefore = peerA.sent.length
    await new Promise(r => setImmediate(r))
    assert.strictEqual(peerA.sent.length, peerASentBefore, 'originator should not receive its own update')
  })

  it('isolates broadcasts: peers in different rooms do not see each other', async () => {
    const persistence = new MemoryPersistence()
    const tagA = `room-a-${Date.now()}`
    const tagB = `room-b-${Date.now()}`

    const peerInA = new MockWsSocket()
    const peerInB = new MockWsSocket()

    await _handleConnection(peerInA as never, { url: `/ws-sync/${tagA}` } as never, persistence)
    await _handleConnection(peerInB as never, { url: `/ws-sync/${tagB}` } as never, persistence)

    const peerInBBaseline = peerInB.sent.length

    // Peer in room A edits + broadcasts; peer in room B must not see it.
    const localDoc = new Y.Doc()
    localDoc.getMap('test').set('hello', 'world')
    const update   = Y.encodeStateAsUpdate(localDoc)
    peerInA.receive(encodeSyncUpdateFrame(update))

    await new Promise(r => setImmediate(r))

    assert.strictEqual(
      peerInB.sent.length,
      peerInBBaseline,
      'peer in a different room should NOT receive frames from another room',
    )
  })
})

// ─── Awareness lifecycle (Phase 8) ───────────────────────────
//
// 8a: a force-killed socket (proxy timeout / tab kill) never fires the
// `close` event, so its `awarenessMap` entry would otherwise replay
// ghost cursors to every late joiner. The handler prunes dead entries
// on the awareness replay loop.
//
// 8d: stored AI awareness is replayed to every new joiner. If the AI
// agent crashes without calling `clearAiAwareness`, the stale cursor
// would replay forever. The handler skips replay (and drops the
// buffer) once `aiAwarenessAt` is older than the 60s TTL.

/** Build the y-protocols wire frame for an awareness message. */
function encodeAwarenessFrame(payload: Uint8Array): Uint8Array {
  // [messageAwareness=1, payloadLen(varint), ...payload]
  const len = writeVarUint(payload.length)
  const buf = new Uint8Array(1 + len.length + payload.length)
  buf[0] = 1 // messageAwareness
  buf.set(len, 1)
  buf.set(payload, 1 + len.length)
  return buf
}

function getSyncRooms(): Map<string, {
  awarenessMap: Map<unknown, Uint8Array>
  aiAwarenessMsg?: Uint8Array
  aiAwarenessAt?:  number
}> | undefined {
  return (globalThis as Record<string, unknown>)[SYNC_KEYS.rooms] as
    | Map<string, {
        awarenessMap: Map<unknown, Uint8Array>
        aiAwarenessMsg?: Uint8Array
        aiAwarenessAt?:  number
      }>
    | undefined
}

describe('awareness lifecycle', () => {
  it('prunes dead sockets from awarenessMap on replay', async () => {
    const persistence = new MemoryPersistence()
    const docName     = `awareness-prune-${Date.now()}`
    const url         = `/ws-sync/${docName}`

    const peerA = new MockWsSocket()
    const peerB = new MockWsSocket()

    await _handleConnection(peerA as never, { url } as never, persistence)
    await _handleConnection(peerB as never, { url } as never, persistence)

    // Peer A sends an awareness frame — stored in the room's awarenessMap.
    const awarenessPayload = new Uint8Array([1, 42, 7, 0, 0, 0, 0, 0])
    peerA.receive(encodeAwarenessFrame(awarenessPayload))
    await new Promise(r => setImmediate(r))

    // Force-kill peer A — readyState flips to CLOSED without a `close` event.
    peerA.readyState = 3

    const peerC = new MockWsSocket()
    await _handleConnection(peerC as never, { url } as never, persistence)

    // Peer C should NOT have received an awareness frame from peer A — the
    // dead-socket entry must have been pruned before the replay loop forwarded it.
    const awarenessFramesAtC = peerC.sent.filter(f => f[0] === 1 /* messageAwareness */)
    assert.strictEqual(awarenessFramesAtC.length, 0, 'late joiner must not receive awareness from a dead peer')

    // And the room's awarenessMap should no longer contain peer A.
    const room = getSyncRooms()?.get(docName)
    assert.ok(room, 'room should exist')
    let hasPeerA = false
    for (const client of room!.awarenessMap.keys()) {
      if (client === peerA) hasPeerA = true
    }
    assert.strictEqual(hasPeerA, false, 'dead peer A must be pruned from awarenessMap')
  })

  it('skips stale AI awareness replay older than the TTL', async () => {
    const persistence = new MemoryPersistence()
    const docName     = `ai-stale-${Date.now()}`
    const url         = `/ws-sync/${docName}`

    // Bootstrap the room by opening one peer (so a room entry exists).
    const peerA = new MockWsSocket()
    await _handleConnection(peerA as never, { url } as never, persistence)

    // Inject a stored AI awareness payload that's 120s old — beyond the 60s TTL.
    const room = getSyncRooms()?.get(docName)
    assert.ok(room, 'room should exist after first peer connects')
    room!.aiAwarenessMsg = new Uint8Array([1, 5, 1, 99, 1, 0])
    room!.aiAwarenessAt  = Date.now() - 120_000

    const peerB = new MockWsSocket()
    await _handleConnection(peerB as never, { url } as never, persistence)

    // Peer B should NOT have received the stale AI awareness frame. And the
    // handler should have dropped the buffer so future joiners don't see it either.
    const awarenessFramesAtB = peerB.sent.filter(f => f[0] === 1 /* messageAwareness */)
    assert.strictEqual(awarenessFramesAtB.length, 0, 'stale AI awareness must not be replayed')
    assert.strictEqual(room!.aiAwarenessMsg, undefined, 'stale AI awareness buffer must be dropped')
    assert.strictEqual(room!.aiAwarenessAt,  undefined, 'stale AI awareness timestamp must be dropped')
  })

  it('Sync.clearAiAwareness(docName) drops the stored replay buffer', async () => {
    const persistence = new MemoryPersistence()
    const docName     = `ai-clear-${Date.now()}`
    const url         = `/ws-sync/${docName}`

    // Boot the room + inject a fresh AI awareness payload.
    const peerA = new MockWsSocket()
    await _handleConnection(peerA as never, { url } as never, persistence)
    const room = getSyncRooms()?.get(docName)
    assert.ok(room, 'room should exist')
    room!.aiAwarenessMsg = new Uint8Array([1, 5, 1, 99, 1, 0])
    room!.aiAwarenessAt  = Date.now()

    Sync.clearAiAwareness(docName)

    assert.strictEqual(room!.aiAwarenessMsg, undefined, 'aiAwarenessMsg must be cleared')
    assert.strictEqual(room!.aiAwarenessAt,  undefined, 'aiAwarenessAt must be cleared')
  })
})

/**
 * Decode an awareness frame back to its clientID + clock + JSON-state entries.
 * Mirrors the server-side decoder so the test can assert what other peers
 * received on the wire (clientID matches, state was null, clock incremented).
 */
function decodeAwarenessFrame(buf: Uint8Array): Array<{ clientID: number; clock: number; state: string }> {
  if (buf[0] !== 1 /* messageAwareness */) return []
  // Skip messageAwareness + innerLen varuint.
  let pos = 1
  while ((buf[pos]! & 0x80) !== 0) pos++; pos++  // skip innerLen
  const readVar = (): number => {
    let result = 0, shift = 0
    while (true) {
      const b = buf[pos++] ?? 0
      result |= (b & 0x7f) << shift
      shift  += 7
      if ((b & 0x80) === 0) break
    }
    return result
  }
  const count = readVar()
  const out: Array<{ clientID: number; clock: number; state: string }> = []
  for (let i = 0; i < count; i++) {
    const clientID = readVar()
    const clock    = readVar()
    const jsonLen  = readVar()
    const state    = new TextDecoder().decode(buf.slice(pos, pos + jsonLen))
    pos += jsonLen
    out.push({ clientID, clock, state })
  }
  return out
}

describe('awareness removal on disconnect', () => {
  it('broadcasts a null-state awareness frame to remaining peers on close', async () => {
    // Pre-fix: when a peer disconnected (refresh, tab close), the server only
    // cleaned its own maps — other peers never learned the user had left,
    // so `Awareness.getStates()` kept the ghost user until the y-protocols
    // 30s outdated-timeout (or forever, in the playground demo's case).
    const persistence = new MemoryPersistence()
    const docName     = `ghost-${Date.now()}`
    const url         = `/ws-sync/${docName}`

    const peerA = new MockWsSocket()
    const peerB = new MockWsSocket()
    await _handleConnection(peerA as never, { url } as never, persistence)
    await _handleConnection(peerB as never, { url } as never, persistence)

    // Peer A announces awareness with clientID=42, clock=7, state='{"user":"alice"}'.
    const aliceClientID = 42
    const aliceClock    = 7
    const aliceJson     = '{"user":"alice"}'
    const aliceBytes    = new TextEncoder().encode(aliceJson)
    const innerParts: number[] = [
      1,                                              // numberOfClients
      aliceClientID,                                  // clientID (fits in 1 byte)
      aliceClock,                                     // clock     (fits in 1 byte)
      aliceJson.length,                               // jsonLen   (fits in 1 byte)
      ...Array.from(aliceBytes),                      // json utf8
    ]
    peerA.receive(encodeAwarenessFrame(new Uint8Array(innerParts)))
    await new Promise(r => setImmediate(r))

    // Snapshot peer B's pre-disconnect frame count so we can isolate what
    // the close handler sent.
    const peerBPreClose = peerB.sent.length

    // Simulate peer A disconnecting — the close handler must broadcast a
    // removal frame to peer B carrying clientID=42 + state='null' + bumped clock.
    peerA.emit('close')

    const newFrames = peerB.sent.slice(peerBPreClose)
    const awarenessFrames = newFrames.filter(f => f[0] === 1 /* messageAwareness */)
    assert.strictEqual(awarenessFrames.length, 1, `peer B should receive exactly one awareness removal frame, got ${awarenessFrames.length}`)
    const decoded = decodeAwarenessFrame(awarenessFrames[0]!)
    assert.strictEqual(decoded.length, 1)
    assert.strictEqual(decoded[0]?.clientID, aliceClientID, 'removal must target the right clientID')
    assert.strictEqual(decoded[0]?.state,    'null',        'state must be the literal null marker')
    assert.ok((decoded[0]?.clock ?? 0) > aliceClock, 'clock must be > last observed so peers do not filter as stale')
  })

  it('removal frame skips closed sockets', async () => {
    const persistence = new MemoryPersistence()
    const docName     = `ghost-skip-closed-${Date.now()}`
    const url         = `/ws-sync/${docName}`

    const peerA = new MockWsSocket()
    const peerB = new MockWsSocket()
    await _handleConnection(peerA as never, { url } as never, persistence)
    await _handleConnection(peerB as never, { url } as never, persistence)

    // Peer A announces awareness.
    peerA.receive(encodeAwarenessFrame(new Uint8Array([1, 42, 7, 4, 110, 117, 108, 108])))
    await new Promise(r => setImmediate(r))

    // Peer B's socket is already closed when peer A disconnects — must not
    // attempt to send the removal frame to a dead socket.
    peerB.readyState = 3 // ws.CLOSED
    const peerBPreClose = peerB.sent.length

    assert.doesNotThrow(() => peerA.emit('close'))
    assert.strictEqual(peerB.sent.length, peerBPreClose, 'must not send removal to a CLOSED peer')
  })
})

describe('async message handler error containment', () => {
  it('a malformed frame does not produce an unhandled rejection', async () => {
    // Pre-fix: `ws.on('message', async (raw) => …)` with no outer try/catch
    // meant a throw from readVarUint / Y.applyUpdate became an unhandled
    // promise rejection. The fix surfaces the failure through the observer
    // and keeps the room operating.
    const persistence = new MemoryPersistence()
    const docName     = `malformed-${Date.now()}`
    const url         = `/ws-sync/${docName}`

    const observed: Array<{ kind: string; op?: string; error?: string }> = []
    const unsub = syncObservers.subscribe(ev => {
      if (ev.kind === 'sync.error') {
        observed.push({
          kind: ev.kind,
          ...(ev.op    ? { op:    ev.op    } : {}),
          ...(ev.error ? { error: ev.error } : {}),
        })
      }
    })

    const peer = new MockWsSocket()
    await _handleConnection(peer as never, { url } as never, persistence)

    // Send a syncUpdate frame whose Y.js update payload is garbage — applyUpdate throws.
    // Frame: [messageSync=0, syncUpdate=2, dataLen=4, 0xff 0xff 0xff 0xff]
    const malformed = new Uint8Array([0, 2, 4, 0xff, 0xff, 0xff, 0xff])
    peer.receive(malformed)

    // Yield to microtasks so the async handler runs to completion + catch.
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))

    assert.ok(observed.length >= 1, `should emit at least one sync.error event, got ${observed.length}`)
    assert.strictEqual(observed[0]?.kind, 'sync.error')
    assert.strictEqual(observed[0]?.op,   'message')
    unsub()
  })
})
