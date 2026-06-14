import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStorage, PulseRegistry, Pulse, ExceptionRecorder } from './index.js'
import { setExceptionReporter, report } from '@rudderjs/core'
import type { PulseAggregate, PulseEntry, PulseStorage } from './types.js'

// ─── MemoryStorage ────────────────────────────────────────

describe('MemoryStorage', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage(100)
  })

  // Recording aggregates

  it('records a metric and retrieves aggregates', () => {
    storage.record('request_count', 1)
    storage.record('request_count', 1)
    storage.record('request_count', 1)

    const since = new Date(Date.now() - 60_000)
    const aggs = storage.aggregates('request_count', since)

    assert.equal(aggs.length, 1)
    assert.equal(aggs[0]!.count, 3)
    assert.equal(aggs[0]!.sum, 3)
  })

  it('tracks min and max', () => {
    storage.record('request_duration', 100)
    storage.record('request_duration', 50)
    storage.record('request_duration', 200)

    const aggs = storage.aggregates('request_duration', new Date(0))
    assert.equal(aggs[0]!.min, 50)
    assert.equal(aggs[0]!.max, 200)
  })

  it('separates aggregates by key', () => {
    storage.record('cache_hits', 1, 'user-cache')
    storage.record('cache_hits', 1, 'session-cache')
    storage.record('cache_hits', 1, 'user-cache')

    const userAggs = storage.aggregates('cache_hits', new Date(0), 'user-cache')
    assert.equal(userAggs.length, 1)
    assert.equal(userAggs[0]!.count, 2)

    const sessionAggs = storage.aggregates('cache_hits', new Date(0), 'session-cache')
    assert.equal(sessionAggs.length, 1)
    assert.equal(sessionAggs[0]!.count, 1)
  })

  it('separates aggregates by type', () => {
    storage.record('request_count', 1)
    storage.record('exceptions', 1)

    const requestAggs = storage.aggregates('request_count', new Date(0))
    assert.equal(requestAggs.length, 1)

    const exceptionAggs = storage.aggregates('exceptions', new Date(0))
    assert.equal(exceptionAggs.length, 1)
  })

  // Entries

  it('stores and retrieves entries', () => {
    storage.storeEntry('slow_request', { url: '/api/slow', duration: 2000 })
    storage.storeEntry('exception', { message: 'fail' })

    const slowRequests = storage.entries('slow_request')
    assert.equal(slowRequests.length, 1)
    assert.equal(slowRequests[0]!.content['url'], '/api/slow')

    const exceptions = storage.entries('exception')
    assert.equal(exceptions.length, 1)
  })

  it('entries respect maxEntries', () => {
    const small = new MemoryStorage(3)
    for (let i = 0; i < 5; i++) {
      small.storeEntry('slow_request', { i })
    }

    const all = small.entries('slow_request')
    assert.ok(all.length <= 3)
  })

  it('paginates entries', () => {
    for (let i = 0; i < 10; i++) {
      storage.storeEntry('slow_request', { i })
    }

    const page1 = storage.entries('slow_request', { page: 1, perPage: 3 })
    const page2 = storage.entries('slow_request', { page: 2, perPage: 3 })

    assert.equal(page1.length, 3)
    assert.equal(page2.length, 3)
  })

  it('searches entries by content', () => {
    storage.storeEntry('slow_request', { url: '/api/users' })
    storage.storeEntry('slow_request', { url: '/api/products' })

    const results = storage.entries('slow_request', { search: 'users' })
    assert.equal(results.length, 1)
  })

  // Overview

  it('overview returns all aggregates since a date', () => {
    storage.record('request_count', 1)
    storage.record('exceptions', 1)

    const overview = storage.overview(new Date(0))
    assert.equal(overview.length, 2)
  })

  // Pruning

  it('prunes old aggregates and entries', () => {
    // Record data, then prune everything before "now"
    storage.record('request_count', 1)
    storage.storeEntry('exception', { message: 'old' })

    // Prune everything before 1 hour from now (should remove everything since buckets are "now")
    const future = new Date(Date.now() + 3_600_000)
    storage.pruneOlderThan(future)

    const aggs = storage.aggregates('request_count', new Date(0))
    assert.equal(aggs.length, 0)
  })
})

// ─── PulseRegistry ────────────────────────────────────────

describe('PulseRegistry', () => {
  beforeEach(() => {
    PulseRegistry.reset()
  })

  it('starts with null', () => {
    assert.equal(PulseRegistry.get(), null)
  })

  it('set and get round-trips', () => {
    const storage = new MemoryStorage()
    PulseRegistry.set(storage)
    assert.strictEqual(PulseRegistry.get(), storage)
  })

  it('reset clears storage', () => {
    PulseRegistry.set(new MemoryStorage())
    PulseRegistry.reset()
    assert.equal(PulseRegistry.get(), null)
  })
})

// ─── Pulse Facade ─────────────────────────────────────────

describe('Pulse facade', () => {
  beforeEach(() => {
    PulseRegistry.reset()
  })

  it('throws when no storage registered', () => {
    assert.throws(() => Pulse.record('request_count', 1), /No storage registered/)
  })

  it('record() delegates to storage', () => {
    const storage = new MemoryStorage()
    PulseRegistry.set(storage)

    Pulse.record('request_count', 1)
    Pulse.record('request_count', 1)

    const aggs = storage.aggregates('request_count', new Date(0))
    assert.equal(aggs.length, 1)
    assert.equal(aggs[0]!.count, 2)
  })

  it('aggregates() returns aggregates', () => {
    const storage = new MemoryStorage()
    storage.record('request_duration', 100)
    PulseRegistry.set(storage)

    const aggs = Pulse.aggregates('request_duration', new Date(0)) as PulseAggregate[]
    assert.equal(aggs.length, 1)
  })

  it('entries() returns entries', () => {
    const storage = new MemoryStorage()
    storage.storeEntry('slow_request', { url: '/test' })
    PulseRegistry.set(storage)

    const entries = Pulse.entries('slow_request') as PulseEntry[]
    assert.equal(entries.length, 1)
  })

  it('overview() returns all aggregates', () => {
    const storage = new MemoryStorage()
    storage.record('request_count', 1)
    storage.record('exceptions', 1)
    PulseRegistry.set(storage)

    const overview = Pulse.overview(new Date(0)) as PulseAggregate[]
    assert.equal(overview.length, 2)
  })
})

// ─── ExceptionRecorder ────────────────────────────────────

describe('ExceptionRecorder', () => {
  afterEach(() => {
    setExceptionReporter(() => {})
  })

  it('records an exception and forwards to the previous reporter without recursing', async () => {
    const recorded: Array<[string, number]> = []
    const stored: Array<Record<string, unknown>> = []
    const storage = {
      record:     (metric: string, value: number) => { recorded.push([metric, value]) },
      storeEntry: (_type: string, data: Record<string, unknown>) => { stored.push(data) },
    } as unknown as PulseStorage

    // A prior reporter the recorder must chain to (e.g. the log channel).
    const forwarded: unknown[] = []
    setExceptionReporter((err) => { forwarded.push(err) })

    await new ExceptionRecorder(storage).register()

    // Before the fix this re-entered the recorder's own reporter and overflowed
    // the stack. It must now return normally.
    const err = new TypeError('boom')
    report(err)

    assert.deepEqual(recorded, [['exceptions', 1]])
    assert.equal(stored.length, 1)
    assert.equal(stored[0]!['class'], 'TypeError')
    assert.equal(stored[0]!['message'], 'boom')
    // Chained to the reporter installed before us, exactly once.
    assert.deepEqual(forwarded, [err])
  })
})
