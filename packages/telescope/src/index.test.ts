import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStorage, createEntry, TelescopeRegistry, Telescope, CommandCollector, BroadcastCollector } from './index.js'
import { commandObservers } from '@rudderjs/rudder'
import { broadcastObservers } from '@rudderjs/broadcast'
import type { TelescopeEntry } from './types.js'

// ─── createEntry helper ───────────────────────────────────

describe('createEntry', () => {
  it('creates an entry with required fields', () => {
    const entry = createEntry('request', { url: '/api/test', method: 'GET' })

    assert.ok(entry.id)
    assert.equal(entry.type, 'request')
    assert.equal(entry.content['url'], '/api/test')
    assert.ok(entry.createdAt instanceof Date)
    assert.deepStrictEqual(entry.tags, [])
    assert.equal(entry.batchId, null)
    assert.equal(entry.familyHash, null)
  })

  it('accepts optional batchId, tags, familyHash', () => {
    const entry = createEntry('query', { sql: 'SELECT 1' }, {
      batchId: 'batch-1',
      tags: ['slow', 'auth'],
      familyHash: 'abc',
    })

    assert.equal(entry.batchId, 'batch-1')
    assert.deepStrictEqual(entry.tags, ['slow', 'auth'])
    assert.equal(entry.familyHash, 'abc')
  })
})

// ─── MemoryStorage ────────────────────────────────────────

describe('MemoryStorage', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage(100)
  })

  // Store and find

  it('stores and finds an entry by ID', () => {
    const entry = createEntry('request', { url: '/test' })
    storage.store(entry)

    const found = storage.find(entry.id)
    assert.ok(found)
    assert.equal(found.id, entry.id)
    assert.equal(found.type, 'request')
  })

  it('returns null for unknown ID', () => {
    assert.equal(storage.find('nonexistent'), null)
  })

  it('stores batch of entries', () => {
    const entries = [
      createEntry('request', { url: '/a' }),
      createEntry('query', { sql: 'SELECT 1' }),
      createEntry('log', { message: 'hello' }),
    ]
    storage.storeBatch(entries)

    assert.equal(storage.count(), 3)
  })

  // List with filters

  it('lists entries by type', () => {
    storage.store(createEntry('request', { url: '/a' }))
    storage.store(createEntry('query', { sql: 'SELECT 1' }))
    storage.store(createEntry('request', { url: '/b' }))

    const requests = storage.list({ type: 'request' })
    assert.equal(requests.length, 2)

    const queries = storage.list({ type: 'query' })
    assert.equal(queries.length, 1)
  })

  it('lists entries with search filter', () => {
    storage.store(createEntry('request', { url: '/api/users' }))
    storage.store(createEntry('request', { url: '/api/products' }))

    const results = storage.list({ type: 'request', search: 'users' })
    assert.equal(results.length, 1)
    assert.equal(results[0]!.content['url'], '/api/users')
  })

  it('lists entries by batchId', () => {
    storage.store(createEntry('request', { url: '/a' }, { batchId: 'b1' }))
    storage.store(createEntry('query', { sql: 'x' }, { batchId: 'b1' }))
    storage.store(createEntry('request', { url: '/c' }, { batchId: 'b2' }))

    const batch1 = storage.list({ batchId: 'b1' })
    assert.equal(batch1.length, 2)
  })

  it('lists entries by tag', () => {
    storage.store(createEntry('query', { sql: 'x' }, { tags: ['slow'] }))
    storage.store(createEntry('query', { sql: 'y' }, { tags: ['fast'] }))

    const slow = storage.list({ tag: 'slow' })
    assert.equal(slow.length, 1)
  })

  it('paginates list results', () => {
    for (let i = 0; i < 10; i++) {
      storage.store(createEntry('request', { i }))
    }

    const page1 = storage.list({ page: 1, perPage: 3 })
    const page2 = storage.list({ page: 2, perPage: 3 })

    assert.equal(page1.length, 3)
    assert.equal(page2.length, 3)
  })

  // Count

  it('counts all entries', () => {
    storage.store(createEntry('request', {}))
    storage.store(createEntry('query', {}))
    storage.store(createEntry('request', {}))

    assert.equal(storage.count(), 3)
  })

  it('counts by type', () => {
    storage.store(createEntry('request', {}))
    storage.store(createEntry('query', {}))
    storage.store(createEntry('request', {}))

    assert.equal(storage.count('request'), 2)
    assert.equal(storage.count('query'), 1)
    assert.equal(storage.count('job'), 0)
  })

  // Prune

  it('prunes all entries', () => {
    storage.store(createEntry('request', {}))
    storage.store(createEntry('query', {}))

    storage.prune()
    assert.equal(storage.count(), 0)
  })

  it('prunes by type', () => {
    storage.store(createEntry('request', {}))
    storage.store(createEntry('query', {}))

    storage.prune('request')
    assert.equal(storage.count(), 1)
    assert.equal(storage.count('query'), 1)
  })

  it('prunes older than date', () => {
    const entry = createEntry('request', {})
    storage.store(entry)

    // Prune everything before a future date
    storage.pruneOlderThan(new Date(Date.now() + 1000))
    assert.equal(storage.count(), 0)
  })

  // Max entries

  it('respects maxEntries limit', () => {
    const small = new MemoryStorage(3)
    for (let i = 0; i < 5; i++) {
      small.store(createEntry('request', { i }))
    }
    assert.equal(small.count(), 3)
  })
})

// ─── TelescopeRegistry ───────────────────────────────────

describe('TelescopeRegistry', () => {
  beforeEach(() => {
    TelescopeRegistry.reset()
  })

  it('starts with null', () => {
    assert.equal(TelescopeRegistry.get(), null)
  })

  it('set and get round-trips', () => {
    const storage = new MemoryStorage()
    TelescopeRegistry.set(storage)
    assert.strictEqual(TelescopeRegistry.get(), storage)
  })

  it('reset clears storage', () => {
    TelescopeRegistry.set(new MemoryStorage())
    TelescopeRegistry.reset()
    assert.equal(TelescopeRegistry.get(), null)
  })
})

// ─── Telescope Facade ────────────────────────────────────

describe('Telescope facade', () => {
  beforeEach(() => {
    TelescopeRegistry.reset()
  })

  it('throws when no storage registered', () => {
    assert.throws(() => Telescope.list(), /No storage registered/)
  })

  it('list() delegates to storage', () => {
    const storage = new MemoryStorage()
    storage.store(createEntry('request', { url: '/test' }))
    TelescopeRegistry.set(storage)

    const entries = Telescope.list({ type: 'request' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
  })

  it('find() returns entry by ID', () => {
    const storage = new MemoryStorage()
    const entry = createEntry('query', { sql: 'SELECT 1' })
    storage.store(entry)
    TelescopeRegistry.set(storage)

    const found = Telescope.find(entry.id) as TelescopeEntry | null
    assert.ok(found)
    assert.equal(found.type, 'query')
  })

  it('count() returns total entries', () => {
    const storage = new MemoryStorage()
    storage.store(createEntry('request', {}))
    storage.store(createEntry('query', {}))
    TelescopeRegistry.set(storage)

    assert.equal(Telescope.count() as number, 2)
    assert.equal(Telescope.count('request') as number, 1)
  })

  it('prune() clears entries', () => {
    const storage = new MemoryStorage()
    storage.store(createEntry('request', {}))
    storage.store(createEntry('query', {}))
    TelescopeRegistry.set(storage)

    Telescope.prune('request')
    assert.equal(Telescope.count() as number, 1)
  })

  it('record() stores an entry', () => {
    const storage = new MemoryStorage()
    TelescopeRegistry.set(storage)

    const entry = createEntry('log', { message: 'test' })
    Telescope.record(entry)

    assert.equal(Telescope.count() as number, 1)
  })
})

// ─── CommandCollector ─────────────────────────────────────

describe('CommandCollector', () => {
  beforeEach(() => {
    commandObservers.reset()
  })

  it('records a successful command observation', async () => {
    const storage = new MemoryStorage()
    const collector = new CommandCollector(storage)
    await collector.register()

    commandObservers.emit({
      name:     'inspire',
      args:     {},
      opts:     {},
      duration: 12,
      exitCode: 0,
      source:   'inline',
    })

    const entries = storage.list({ type: 'command' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    const entry = entries[0]!
    assert.equal(entry.content['name'], 'inspire')
    assert.equal(entry.content['exitCode'], 0)
    assert.equal(entry.content['source'], 'inline')
    assert.deepEqual(entry.tags.sort(), ['source:inline', 'status:success'].sort())
  })

  it('records a failed command observation with error', async () => {
    const storage = new MemoryStorage()
    const collector = new CommandCollector(storage)
    await collector.register()

    commandObservers.emit({
      name:     'migrate',
      args:     {},
      opts:     {},
      duration: 50,
      exitCode: 1,
      source:   'class',
      error:    new Error('boom'),
    })

    const entries = storage.list({ type: 'command' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    const entry = entries[0]!
    assert.equal(entry.content['exitCode'], 1)
    const err = entry.content['error'] as { message: string; stack?: string }
    assert.equal(err.message, 'boom')
    assert.ok(err.stack)
    assert.ok(entry.tags.includes('status:failed'))
    assert.ok(entry.tags.includes('error'))
  })

  it('tags cancelled commands (exit 130)', async () => {
    const storage = new MemoryStorage()
    const collector = new CommandCollector(storage)
    await collector.register()

    commandObservers.emit({
      name:     'mail:send',
      args:     {},
      opts:     {},
      duration: 5,
      exitCode: 130,
      source:   'class',
    })

    const entries = storage.list({ type: 'command' }) as TelescopeEntry[]
    assert.ok(entries[0]!.tags.includes('cancelled'))
  })
})

// ─── BroadcastCollector ───────────────────────────────────

describe('BroadcastCollector', () => {
  beforeEach(() => {
    broadcastObservers.reset()
  })

  it('records a connection.opened event with batchId set to connectionId', async () => {
    const storage = new MemoryStorage()
    const collector = new BroadcastCollector(storage)
    await collector.register()

    broadcastObservers.emit({
      kind:         'connection.opened',
      connectionId: 'bk123abc',
      url:          '/ws',
      ip:           '127.0.0.1',
      userAgent:    'curl/8.7.1',
    })

    const entries = storage.list({ type: 'broadcast' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    const entry = entries[0]!
    assert.equal(entry.content['kind'], 'connection.opened')
    assert.equal(entry.content['connectionId'], 'bk123abc')
    assert.equal(entry.content['ip'], '127.0.0.1')
    assert.equal(entry.batchId, 'bk123abc')
    assert.ok(entry.tags.includes('kind:connection.opened'))
    assert.ok(entry.tags.includes('opened'))
  })

  it('records a denied subscribe with allowed/denied tag', async () => {
    const storage = new MemoryStorage()
    const collector = new BroadcastCollector(storage)
    await collector.register()

    broadcastObservers.emit({
      kind:         'subscribe',
      connectionId: 'bk1',
      channel:      'private-orders.99',
      channelType:  'private',
      allowed:      false,
      authMs:       12,
      reason:       'Auth callback returned false',
    })

    const entries = storage.list({ type: 'broadcast' }) as TelescopeEntry[]
    assert.equal(entries.length, 1)
    const entry = entries[0]!
    assert.equal(entry.content['allowed'], false)
    assert.equal(entry.content['authMs'], 12)
    assert.ok(entry.tags.includes('denied'))
    assert.ok(entry.tags.includes('channel:private'))
  })

  it('records a server-initiated broadcast with payloadSize and recipientCount', async () => {
    const storage = new MemoryStorage()
    const collector = new BroadcastCollector(storage)
    await collector.register()

    broadcastObservers.emit({
      kind:           'broadcast',
      channel:        'orders',
      event:          'created',
      recipientCount: 7,
      payloadSize:    256,
      source:         'server',
    })

    const entries = storage.list({ type: 'broadcast' }) as TelescopeEntry[]
    const entry = entries[0]!
    assert.equal(entry.content['source'], 'server')
    assert.equal(entry.content['recipientCount'], 7)
    assert.ok(entry.tags.includes('source:server'))
    assert.equal(entry.batchId, null) // server broadcasts have no connectionId
  })

  it('records presence.join/leave with member info', async () => {
    const storage = new MemoryStorage()
    const collector = new BroadcastCollector(storage)
    await collector.register()

    broadcastObservers.emit({
      kind:         'presence.join',
      connectionId: 'bk2',
      channel:      'presence-room.42',
      member:       { id: 'user-1', name: 'Alice' },
    })

    const entries = storage.list({ type: 'broadcast' }) as TelescopeEntry[]
    const entry = entries[0]!
    const member = entry.content['member'] as { id: string; name: string }
    assert.equal(member.name, 'Alice')
    assert.equal(entry.batchId, 'bk2')
  })
})
