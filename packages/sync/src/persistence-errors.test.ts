import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as Y    from 'yjs'
import {
  MemoryPersistence,
  Sync,
  syncObservers,
  type SyncPersistence,
  type SyncEvent,
} from './index.js'
import { encodeAiAwareness } from './lexical/awareness.js'

// ─── Test setup ─────────────────────────────────────────────

const g = globalThis as Record<string, unknown>
const PERSIST_KEY        = '__rudderjs_live_persistence__'
const ROOMS_KEY          = '__rudderjs_live__'
const FIRST_CONNECT_KEY  = '__rudderjs_sync_first_connect__'
const AI_CLOCK_KEY       = '__rudderjs_sync_ai_clock__'

function clearSyncGlobals(): void {
  delete g[PERSIST_KEY]
  delete g[ROOMS_KEY]
  delete g[FIRST_CONNECT_KEY]
  delete g[AI_CLOCK_KEY]
}

function captureSyncEvents(): { events: SyncEvent[]; unsubscribe: () => void } {
  const events: SyncEvent[] = []
  const unsubscribe = syncObservers.subscribe((e) => events.push(e))
  return { events, unsubscribe }
}

// Persistence that fails on getYDoc for the first N calls, then recovers.
function failingPersistence(failTimes: number, message = 'load failed'): SyncPersistence & { calls: number } {
  let calls = 0
  const inner = new MemoryPersistence()
  return {
    get calls() { return calls },
    async getYDoc(docName) {
      calls++
      if (calls <= failTimes) throw new Error(message)
      return inner.getYDoc(docName)
    },
    async storeUpdate(docName, update) { return inner.storeUpdate(docName, update) },
    async getStateVector(docName)      { return inner.getStateVector(docName) },
    async getDiff(docName, sv)         { return inner.getDiff(docName, sv) },
    async clearDocument(docName)       { return inner.clearDocument(docName) },
    async destroy()                    { return inner.destroy() },
  }
}

// ─── Phase 7a: atomic seed gate ─────────────────────────────

describe('Phase 7a — Sync.seed atomic empty-doc gate', () => {
  beforeEach(() => { clearSyncGlobals() })
  afterEach(()  => { clearSyncGlobals() })

  it('seeds an empty doc and returns true', async () => {
    g[PERSIST_KEY] = new MemoryPersistence()
    const wrote = await Sync.seed('doc-a', { title: 'hello', body: '' })
    assert.equal(wrote, true)
    const fields = Sync.readMap('doc-a', 'fields')
    assert.deepEqual(fields, { title: 'hello', body: '' })
  })

  it('skips a doc that already has seeded fields and returns false', async () => {
    g[PERSIST_KEY] = new MemoryPersistence()
    await Sync.seed('doc-b', { title: 'first' })
    const second = await Sync.seed('doc-b', { title: 'second' })
    assert.equal(second, false)
    assert.equal(Sync.readMap('doc-b', 'fields')['title'], 'first', 'second seed must not overwrite')
  })

  it('seeds even when the doc has prior non-fields content (state-vector > 1)', async () => {
    // Reproduces the pre-fix bug: a client had connected (raising the doc's
    // state vector beyond the "empty" threshold), but no `fields` were ever
    // written. The old `sv.length > 1` gate would skip — now we gate on the
    // actual map size and seed correctly.
    g[PERSIST_KEY] = new MemoryPersistence()
    // Simulate prior client activity by writing to a *different* map.
    const persistence = Sync.persistence()
    const yd = await persistence.getYDoc('doc-c')
    yd.getText('chat').insert(0, 'hi')                   // raises state-vector
    await persistence.storeUpdate('doc-c', Y.encodeStateAsUpdate(yd))

    // Now seed `fields` — pre-fix this was silently skipped.
    const wrote = await Sync.seed('doc-c', { title: 'arrived' })
    assert.equal(wrote, true, 'seed must run when fields are empty regardless of other maps')
    assert.equal(Sync.readMap('doc-c', 'fields')['title'], 'arrived')
  })

  it('two concurrent seed callers serialise — exactly one writes', async () => {
    g[PERSIST_KEY] = new MemoryPersistence()
    const [a, b] = await Promise.all([
      Sync.seed('doc-d', { title: 'A' }),
      Sync.seed('doc-d', { title: 'B' }),
    ])
    assert.equal([a, b].filter(Boolean).length, 1, 'exactly one caller writes')
    const winner = Sync.readMap('doc-d', 'fields')['title']
    assert.ok(winner === 'A' || winner === 'B', `winning value was ${String(winner)}`)
  })
})

// ─── Phase 7c: persistence-error observability ──────────────

describe('Phase 7c — persistence errors emit sync.error', () => {
  beforeEach(() => { clearSyncGlobals() })
  afterEach(()  => { clearSyncGlobals() })

  it('storeUpdate failure on Sync.updateMap (SERVER_ORIGIN) emits sync.error with op:storeUpdate', async () => {
    // Sync.updateMap writes inside `doc.transact(..., SERVER_ORIGIN)`,
    // which triggers the doc.on('update') listener in getOrCreateRoom —
    // the path that calls persistence.storeUpdate. (Sync.seed is purely
    // in-memory hydration and intentionally does not touch persistence.)
    const failing: SyncPersistence = {
      async getYDoc()        { return new Y.Doc() },
      async storeUpdate()    { throw new Error('disk full') },
      async getStateVector() { return new Uint8Array() },
      async getDiff()        { return new Uint8Array() },
      async clearDocument()  {},
      async destroy()        {},
    }
    g[PERSIST_KEY] = failing

    const { events, unsubscribe } = captureSyncEvents()
    try {
      await Sync.updateMap('err-doc', 'fields', 'title', 'x')
      // doc.on('update') runs synchronously; the storeUpdate rejection
      // arrives on a microtask.
      await new Promise((r) => setImmediate(r))
      const err = events.find(e => e.kind === 'sync.error' && e.op === 'storeUpdate')
      assert.ok(err, 'expected sync.error with op:storeUpdate')
      if (err?.kind === 'sync.error') {
        assert.equal(err.docName, 'err-doc')
        assert.match(err.error, /disk full/)
      }
    } finally { unsubscribe() }
  })
})

// ─── Phase 7d: room eviction on getYDoc failure ─────────────

describe('Phase 7d — getYDoc failure evicts cached room', () => {
  beforeEach(() => { clearSyncGlobals() })
  afterEach(()  => { clearSyncGlobals() })

  it('does NOT cache a room whose ready promise rejected', async () => {
    const persistence = failingPersistence(1, 'transient')
    g[PERSIST_KEY] = persistence

    // First snapshotAsync — getYDoc rejects, room is evicted.
    await assert.rejects(Sync.snapshotAsync('flaky-doc'), /transient/)

    // Second snapshotAsync — persistence has recovered (failTimes was 1),
    // a fresh room is created, getYDoc succeeds, snapshot resolves.
    const snap = await Sync.snapshotAsync('flaky-doc')
    assert.ok(snap instanceof Uint8Array, 'second call should succeed once persistence recovers')
    assert.equal(persistence.calls, 2, 'persistence.getYDoc should be retried after eviction')
  })

  it('emits sync.error with op:getYDoc on persistence load failure', async () => {
    g[PERSIST_KEY] = failingPersistence(99, 'redis offline')

    const { events, unsubscribe } = captureSyncEvents()
    try {
      await assert.rejects(Sync.snapshotAsync('redis-doc'))
      const err = events.find(e => e.kind === 'sync.error' && e.op === 'getYDoc')
      assert.ok(err, 'expected sync.error with op:getYDoc')
      if (err?.kind === 'sync.error') {
        assert.equal(err.docName, 'redis-doc')
        assert.match(err.error, /redis offline/)
      }
    } finally { unsubscribe() }
  })
})

// ─── Phase 7b: AI awareness clock survives module re-eval ──

describe('Phase 7b — aiAwarenessClock lives on globalThis', () => {
  beforeEach(() => { clearSyncGlobals() })
  afterEach(()  => { clearSyncGlobals() })

  it('starts at 1 when the global slot is empty', () => {
    // First call should observe a fresh counter — but since other tests
    // in this file may have left a counter behind, we explicitly clear
    // and assert from a known baseline.
    delete g[AI_CLOCK_KEY]
    encodeAiAwareness({ name: 'AI: test', color: '#fff' })
    assert.equal(g[AI_CLOCK_KEY], 1)
  })

  it('increments monotonically across calls and reads the global slot', () => {
    delete g[AI_CLOCK_KEY]
    encodeAiAwareness({ name: 'a', color: '#fff' })
    encodeAiAwareness({ name: 'b', color: '#fff' })
    encodeAiAwareness({ name: 'c', color: '#fff' })
    assert.equal(g[AI_CLOCK_KEY], 3)
  })

  it('resumes from the global counter (simulates HMR survival)', () => {
    // Pre-seed the counter as if a previous module load had emitted
    // 42 awareness messages. After "re-eval" (which a real HMR would
    // perform via re-importing the module), the next call should be 43.
    g[AI_CLOCK_KEY] = 42
    encodeAiAwareness({ name: 'survives-hmr', color: '#fff' })
    assert.equal(g[AI_CLOCK_KEY], 43)
  })
})
