import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle, DrizzleTableRegistry, type DrizzleConfig } from './index.js'

// Note: tests that actually query a database require a running DB instance
// and are covered by integration tests. These tests verify factory contracts,
// DrizzleTableRegistry, and adapter/query-builder shapes without opening any
// connections (by passing a pre-built client stub).

// ─── Minimal Drizzle DB stub ───────────────────────────────

function makeDb() {
  return {}   // DrizzleAdapter only stores it — never calls methods during construction
}

// ─── DrizzleTableRegistry ──────────────────────────────────

describe('DrizzleTableRegistry', () => {
  beforeEach(() => {
    // Reset between tests by registering a known sentinel
    DrizzleTableRegistry.register('__reset__', null)
  })

  it('register() and get() round-trip', () => {
    const fakeTable = { id: 'col' }
    DrizzleTableRegistry.register('users', fakeTable)
    assert.strictEqual(DrizzleTableRegistry.get('users'), fakeTable)
  })

  it('get() returns undefined for unknown table', () => {
    assert.strictEqual(DrizzleTableRegistry.get('__nonexistent__'), undefined)
  })

  it('register() overwrites an existing entry', () => {
    const a = { id: 'a' }
    const b = { id: 'b' }
    DrizzleTableRegistry.register('posts', a)
    DrizzleTableRegistry.register('posts', b)
    assert.strictEqual(DrizzleTableRegistry.get('posts'), b)
  })
})

// ─── drizzle() factory ─────────────────────────────────────

describe('drizzle() factory', () => {
  it('is a function', () => {
    assert.strictEqual(typeof drizzle, 'function')
  })

  it('returns an object with a create() method', () => {
    const provider = drizzle({})
    assert.strictEqual(typeof provider.create, 'function')
  })

  it('works with empty config', () => {
    assert.doesNotThrow(() => drizzle({}))
  })

  it('works with all config options', () => {
    const cfg: DrizzleConfig = {
      client:     makeDb(),
      driver:     'sqlite',
      url:        'file:./test.db',
      tables:     { users: {} },
      primaryKey: 'uuid',
    }
    assert.doesNotThrow(() => drizzle(cfg))
  })

  it('each call returns a new provider instance', () => {
    const a = drizzle({})
    const b = drizzle({})
    assert.notStrictEqual(a, b)
  })
})

// ─── DrizzleAdapter (via pre-built client) ─────────────────

describe('DrizzleAdapter', () => {
  it('create() resolves when a client is provided', async () => {
    const adapter = await drizzle({ client: makeDb(), tables: {} }).create()
    assert.ok(adapter, 'adapter should be defined')
  })

  it('adapter has connect() and disconnect() methods', async () => {
    const adapter = await drizzle({ client: makeDb(), tables: {} }).create()
    assert.strictEqual(typeof adapter.connect,    'function')
    assert.strictEqual(typeof adapter.disconnect, 'function')
  })

  it('adapter has query() method', async () => {
    const adapter = await drizzle({ client: makeDb(), tables: {} }).create()
    assert.strictEqual(typeof adapter.query, 'function')
  })

  it('query() throws when table is not registered', async () => {
    const adapter = await drizzle({ client: makeDb(), tables: {} }).create()
    assert.throws(
      () => adapter.query('nonexistent'),
      /No table schema registered for "nonexistent"/,
    )
  })

  it('query() returns a QueryBuilder-shaped object for a registered table', async () => {
    const fakeTable = { id: {}, name: {} }
    const adapter   = await drizzle({ client: makeDb(), tables: { items: fakeTable } }).create()
    const qb        = adapter.query('items') as unknown as Record<string, unknown>

    const methods = ['where', 'orWhere', 'orderBy', 'limit', 'offset', 'with',
                     'first', 'find', 'get', 'all', 'count', 'create', 'update',
                     'delete', 'paginate']
    for (const method of methods) {
      assert.strictEqual(typeof qb[method], 'function', `missing method: ${method}`)
    }
  })

  it('query() falls back to DrizzleTableRegistry', async () => {
    const fakeTable = { id: {} }
    DrizzleTableRegistry.register('fallback_table', fakeTable)
    const adapter = await drizzle({ client: makeDb(), tables: {} }).create()
    assert.doesNotThrow(() => adapter.query('fallback_table'))
  })

  it('connect() resolves without error (no-op)', async () => {
    const adapter = await drizzle({ client: makeDb(), tables: {} }).create()
    await assert.doesNotReject(() => adapter.connect())
  })
})
