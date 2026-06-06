import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { syncDatabase, syncObservers, type SyncEvent } from './index.js'

// ─── Fake ORM adapter ────────────────────────────────────────
//
// Implements the structural query(table) slice syncDatabase() consumes —
// where/orderBy/get/create/deleteAll over an in-memory row array. Keeps the
// suite DB-free: the real adapters' conformance is covered in their own
// packages; here we pin the driver's contract against the QueryBuilder shape.

interface FakeRow extends Record<string, unknown> { id: number }

function fakeAdapter() {
  const tables = new Map<string, FakeRow[]>()
  let nextId = 1
  const queriedTables: string[] = []

  function rowsFor(table: string): FakeRow[] {
    if (!tables.has(table)) tables.set(table, [])
    return tables.get(table) ?? []
  }

  return {
    tables,
    queriedTables,
    query(table: string) {
      queriedTables.push(table)
      const wheres: Array<[string, unknown]> = []
      let order: [string, string] | null = null
      const matches = (row: FakeRow) => wheres.every(([col, val]) => row[col] === val)
      const qb = {
        where(column: string, value: unknown) { wheres.push([column, value]); return qb },
        orderBy(column: string, direction?: string) { order = [column, direction ?? 'ASC']; return qb },
        async get() {
          const out = rowsFor(table).filter(matches)
          if (order) {
            const [col, dir] = order
            out.sort((a, b) => {
              const av = a[col] as number, bv = b[col] as number
              return dir === 'DESC' ? bv - av : av - bv
            })
          }
          return out
        },
        async create(data: Record<string, unknown>) {
          const row: FakeRow = { id: nextId++, ...data }
          rowsFor(table).push(row)
          return row
        },
        async deleteAll() {
          const all = rowsFor(table)
          const keep = all.filter((r) => !matches(r))
          const deleted = all.length - keep.length
          tables.set(table, keep)
          return deleted
        },
      }
      return qb
    },
  }
}

function updateFor(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('content').insert(doc.getText('content').length, text)
  return Y.encodeStateAsUpdate(doc)
}

function captureSyncEvents(): { events: SyncEvent[]; unsubscribe: () => void } {
  const events: SyncEvent[] = []
  const unsubscribe = syncObservers.subscribe((e) => events.push(e))
  return { events, unsubscribe }
}

// ─── Round-trip ──────────────────────────────────────────────

describe('syncDatabase — store/load round-trip', () => {
  it('storeUpdate + getYDoc replays the update log', async () => {
    const db = fakeAdapter()
    const p  = syncDatabase({ adapter: db })

    const source = new Y.Doc()
    source.getText('content').insert(0, 'hello')
    await p.storeUpdate('doc-a', Y.encodeStateAsUpdate(source))
    source.getText('content').insert(5, ' world')
    await p.storeUpdate('doc-a', Y.encodeStateAsUpdate(source, Y.encodeStateVector(new Y.Doc())))

    // Evict the doc cache so the read goes through the adapter
    await p.destroy()
    const loaded = await p.getYDoc('doc-a')
    assert.equal(loaded.getText('content').toString(), 'hello world')
  })

  it('stores one row per update on the default syncDocument table, as a Buffer', async () => {
    const db = fakeAdapter()
    const p  = syncDatabase({ adapter: db })

    const update = updateFor('abc')
    await p.storeUpdate('doc-b', update)

    assert.deepEqual(db.queriedTables, ['syncDocument'])
    const rows = db.tables.get('syncDocument') ?? []
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.['docName'], 'doc-b')
    // better-sqlite3 binds Buffers only — a plain Uint8Array throws at the driver
    assert.ok(Buffer.isBuffer(rows[0]?.['update']), 'update column must be a Buffer')
    assert.deepEqual(new Uint8Array(rows[0]?.['update'] as Buffer), update)
    // No app-side timestamp: createdAt is the table's database-side default
    assert.equal('createdAt' in (rows[0] ?? {}), false)
  })

  it('wraps a subarray view without dragging in the whole backing buffer', async () => {
    const db = fakeAdapter()
    const p  = syncDatabase({ adapter: db })

    const full = updateFor('xy')
    const padded = new Uint8Array(full.length + 8)
    padded.set(full, 4)
    const view = padded.subarray(4, 4 + full.length)

    await p.storeUpdate('doc-view', view)
    const stored = (db.tables.get('syncDocument') ?? [])[0]?.['update'] as Buffer
    assert.equal(stored.length, full.length, 'Buffer must respect byteOffset/byteLength')
    assert.deepEqual(new Uint8Array(stored), full)
  })

  it('honors a custom table name', async () => {
    const db = fakeAdapter()
    const p  = syncDatabase({ adapter: db, table: 'collabUpdates' })
    await p.storeUpdate('doc-c', updateFor('z'))
    assert.deepEqual(db.queriedTables, ['collabUpdates'])
    assert.equal((db.tables.get('collabUpdates') ?? []).length, 1)
  })
})

// ─── Doc cache ───────────────────────────────────────────────

describe('syncDatabase — doc cache', () => {
  it('getYDoc returns the same instance on repeated calls', async () => {
    const p = syncDatabase({ adapter: fakeAdapter() })
    const a = await p.getYDoc('same')
    const b = await p.getYDoc('same')
    assert.strictEqual(a, b)
  })

  it('storeUpdate applies the update to the cached doc', async () => {
    const p   = syncDatabase({ adapter: fakeAdapter() })
    const doc = await p.getYDoc('cached')
    await p.storeUpdate('cached', updateFor('live'))
    assert.equal(doc.getText('content').toString(), 'live')
  })

  it('evicts the cached doc and emits sync.error when a cached apply fails', async () => {
    const db  = fakeAdapter()
    const p   = syncDatabase({ adapter: db })
    const doc = await p.getYDoc('corrupt')
    const { events, unsubscribe } = captureSyncEvents()
    try {
      // Garbage bytes: the row still inserts, but Y.applyUpdate on the cached doc throws
      await p.storeUpdate('corrupt', new Uint8Array([255, 255, 255, 255]))
      const errors = events.filter((e) => e.kind === 'sync.error')
      assert.equal(errors.length, 1)
      assert.equal((errors[0] as { op?: string }).op, 'storeUpdate')
      // Evicted: next getYDoc rebuilds from the adapter, not the poisoned
      // instance. Drop the garbage row first so the rebuild replays cleanly.
      db.tables.set('syncDocument', [])
      const fresh = await p.getYDoc('corrupt')
      assert.notStrictEqual(fresh, doc)
    } finally {
      unsubscribe()
    }
  })
})

// ─── Missing-table tolerance ─────────────────────────────────

describe('syncDatabase — missing-table tolerance on reads', () => {
  function throwingAdapter(error: unknown) {
    let calls = 0
    return {
      get calls() { return calls },
      query() {
        const qb = {
          where: () => qb,
          orderBy: () => qb,
          async get(): Promise<Array<{ update: unknown }>> { calls++; throw error },
          async create() { return {} },
          async deleteAll() { return 0 },
        }
        return qb
      },
    }
  }

  const missingTableErrors: Array<[string, unknown]> = [
    ['sqlite message',        new Error('no such table: syncDocument')],
    ['postgres 42P01 code',   Object.assign(new Error('relation "syncDocument" does not exist'), { code: '42P01' })],
    ['mysql errno 1146',      Object.assign(new Error("Table 'app.syncDocument' doesn't exist"), { errno: 1146 })],
    ['nested under .cause',   new Error('query failed', { cause: new Error('no such table: syncDocument') })],
  ]

  for (const [label, error] of missingTableErrors) {
    it(`returns an empty doc for ${label}`, async () => {
      const p   = syncDatabase({ adapter: throwingAdapter(error) })
      const doc = await p.getYDoc('not-yet-migrated')
      assert.ok(doc instanceof Y.Doc)
      assert.equal(Y.encodeStateVector(doc).length, 1, 'doc must be empty')
    })
  }

  it('does NOT cache the empty doc — the next read retries the adapter', async () => {
    const adapter = throwingAdapter(new Error('no such table: syncDocument'))
    const p = syncDatabase({ adapter })
    await p.getYDoc('retry-me')
    await p.getYDoc('retry-me')
    assert.equal(adapter.calls, 2, 'both reads must hit the adapter')
  })

  it('rethrows non-missing-table errors', async () => {
    const p = syncDatabase({ adapter: throwingAdapter(new Error('connection refused')) })
    await assert.rejects(() => p.getYDoc('boom'), /connection refused/)
  })
})

// ─── clearDocument / destroy / resolution ───────────────────

describe('syncDatabase — clearDocument, destroy, adapter resolution', () => {
  it('clearDocument deletes the rows and evicts the cache', async () => {
    const db = fakeAdapter()
    const p  = syncDatabase({ adapter: db })
    await p.storeUpdate('doc-x', updateFor('a'))
    await p.storeUpdate('doc-y', updateFor('b'))
    const before = await p.getYDoc('doc-x')

    await p.clearDocument('doc-x')
    assert.equal((db.tables.get('syncDocument') ?? []).filter((r) => r['docName'] === 'doc-x').length, 0)
    assert.equal((db.tables.get('syncDocument') ?? []).filter((r) => r['docName'] === 'doc-y').length, 1)
    const after = await p.getYDoc('doc-x')
    assert.notStrictEqual(after, before, 'cleared doc must not come back from cache')
    assert.equal(Y.encodeStateVector(after).length, 1)
  })

  it('destroy clears driver state without touching the adapter', async () => {
    const db = fakeAdapter()
    const p  = syncDatabase({ adapter: db })
    await p.storeUpdate('doc-z', updateFor('persisted'))
    await p.destroy()
    // Rows survive destroy — the adapter is app-owned and stays connected
    assert.equal((db.tables.get('syncDocument') ?? []).length, 1)
    const reloaded = await p.getYDoc('doc-z')
    assert.equal(reloaded.getText('content').toString(), 'persisted')
  })

  it('rejects an adapter without query(table)', async () => {
    const p = syncDatabase({ adapter: { notAnAdapter: true } })
    await assert.rejects(() => p.getYDoc('any'), /without a query\(table\) method/)
  })
})
