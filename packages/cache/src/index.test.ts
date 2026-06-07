import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigRepository, setConfigRepository, getConfigRepository, rudder } from '@rudderjs/core'
import { CacheProvider, Cache, CacheRegistry, MemoryAdapter, type CacheConfig } from './index.js'

function withCacheConfig(cfg: CacheConfig): () => void {
  const previous = getConfigRepository()
  setConfigRepository(new ConfigRepository({ cache: cfg }))
  return () => setConfigRepository(previous ?? new ConfigRepository({}))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── MemoryAdapter (direct) ────────────────────────────────

describe('MemoryAdapter', () => {
  let adapter: MemoryAdapter

  beforeEach(() => { adapter = new MemoryAdapter() })

  it('get() returns null for a missing key', async () => {
    assert.strictEqual(await adapter.get('missing'), null)
  })

  it('set() + get() round-trips any JSON-serialisable value', async () => {
    await adapter.set('str',  'hello')
    await adapter.set('num',  42)
    await adapter.set('obj',  { a: 1 })
    await adapter.set('arr',  [1, 2, 3])
    await adapter.set('bool', true)

    assert.strictEqual(await adapter.get('str'),         'hello')
    assert.strictEqual(await adapter.get('num'),          42)
    assert.deepStrictEqual(await adapter.get('obj'),     { a: 1 })
    assert.deepStrictEqual(await adapter.get('arr'),     [1, 2, 3])
    assert.strictEqual(await adapter.get('bool'),        true)
  })

  it('has() returns true for an existing key', async () => {
    await adapter.set('k', 'v')
    assert.strictEqual(await adapter.has('k'), true)
  })

  it('has() returns false for a missing key', async () => {
    assert.strictEqual(await adapter.has('missing'), false)
  })

  it('forget() removes a key', async () => {
    await adapter.set('k', 'v')
    await adapter.forget('k')
    assert.strictEqual(await adapter.get('k'), null)
    assert.strictEqual(await adapter.has('k'), false)
  })

  it('forget() on a non-existent key is a no-op', async () => {
    await assert.doesNotReject(() => adapter.forget('ghost'))
  })

  it('flush() removes all keys', async () => {
    await adapter.set('a', 1)
    await adapter.set('b', 2)
    await adapter.flush()
    assert.strictEqual(await adapter.get('a'), null)
    assert.strictEqual(await adapter.get('b'), null)
  })

  it('set() without TTL stores value permanently', async () => {
    await adapter.set('forever', 'value')
    await sleep(20)
    assert.strictEqual(await adapter.get('forever'), 'value')
  })

  it('get() returns null after TTL expires', async () => {
    await adapter.set('ttl', 'temp', 0.1)
    assert.strictEqual(await adapter.get('ttl'), 'temp')
    await sleep(200)
    assert.strictEqual(await adapter.get('ttl'), null)
  })

  it('has() returns false and cleans up an expired key', async () => {
    await adapter.set('ttl', 'temp', 0.01)
    await sleep(20)
    assert.strictEqual(await adapter.has('ttl'), false)
  })

  it('overwriting a key replaces the value', async () => {
    await adapter.set('k', 'first')
    await adapter.set('k', 'second')
    assert.strictEqual(await adapter.get('k'), 'second')
  })

  it('increment() seeds a missing key to `by` and returns it', async () => {
    assert.strictEqual(await adapter.increment('hits', 1), 1)
    assert.strictEqual(await adapter.get<number>('hits'), 1)
  })

  it('increment() adds to an existing numeric value', async () => {
    await adapter.increment('hits', 3)
    assert.strictEqual(await adapter.increment('hits', 4), 7)
  })

  it('increment() preserves the original TTL across calls (no refresh)', async () => {
    await adapter.increment('hits', 1, 0.1)
    await adapter.increment('hits', 1, 60)   // larger TTL should NOT extend
    await sleep(200)
    assert.strictEqual(await adapter.get<number>('hits'), null)
  })

  it('increment() reseeds when the existing value is non-numeric', async () => {
    await adapter.set('hits', 'oops')
    assert.strictEqual(await adapter.increment('hits', 5), 5)
  })

  it('increment() after expiry seeds a fresh counter with the new TTL', async () => {
    await adapter.increment('hits', 1, 0.05)
    await sleep(100)
    assert.strictEqual(await adapter.increment('hits', 2, 60), 2)
  })

  it('increment() under serial concurrent calls produces a deterministic total', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => adapter.increment('hits', 1, 60)),
    )
    assert.strictEqual(await adapter.get<number>('hits'), 25)
    assert.strictEqual(new Set(results).size, 25, 'each call should observe a unique value')
  })

  it('add() stores the value when the key is missing and returns true', async () => {
    assert.strictEqual(await adapter.add('claim', '1', 60), true)
    assert.strictEqual(await adapter.get('claim'), '1')
  })

  it('add() returns false and does not overwrite when the key exists', async () => {
    await adapter.set('claim', 'first')
    assert.strictEqual(await adapter.add('claim', 'second'), false)
    assert.strictEqual(await adapter.get('claim'), 'first')
  })

  it('add() under concurrent callers grants exactly one winner', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => adapter.add('claim', '1', 60)),
    )
    assert.strictEqual(results.filter(Boolean).length, 1, 'exactly one caller wins')
  })

  it('add() after expiry treats the key as missing', async () => {
    await adapter.add('claim', '1', 0.05)
    await sleep(80)
    assert.strictEqual(await adapter.add('claim', '2', 60), true)
    assert.strictEqual(await adapter.get('claim'), '2')
  })
})

// ─── CacheRegistry ─────────────────────────────────────────

describe('CacheRegistry', () => {
  beforeEach(() => CacheRegistry.reset())

  it('get() returns null when no adapter is registered', () => {
    assert.strictEqual(CacheRegistry.get(), null)
  })

  it('set() + get() registers and retrieves the adapter', () => {
    const adapter = new MemoryAdapter()
    CacheRegistry.set(adapter)
    assert.strictEqual(CacheRegistry.get(), adapter)
  })

  it('reset() clears the registered adapter', () => {
    CacheRegistry.set(new MemoryAdapter())
    CacheRegistry.reset()
    assert.strictEqual(CacheRegistry.get(), null)
  })

  it('state lives on globalThis so it survives a second copy of @rudderjs/cache', () => {
    // Vite-bundled server apps inline `@rudderjs/middleware` (which imports
    // `CacheRegistry` for `RateLimit`) into entry.mjs, but `CacheProvider.boot()`
    // runs from a `node_modules` copy of `@rudderjs/cache` resolved via the
    // provider auto-discovery manifest. Without a globalThis-routed store,
    // `set()` from the externalized copy would never be visible to `get()`
    // from the bundled copy. This test pins the contract: writes from this
    // module copy are visible on a global key the second copy would also
    // read from.
    const adapter = new MemoryAdapter()
    CacheRegistry.set(adapter)
    CacheRegistry.setDefaultName('redis')
    const store = (globalThis as Record<string, unknown>)['__rudderjs_cache_registry__'] as { adapter: unknown; defaultName: unknown } | undefined
    assert.ok(store, 'global store should exist after CacheRegistry.set()')
    assert.strictEqual(store.adapter, adapter)
    assert.strictEqual(store.defaultName, 'redis')
  })
})

// ─── Cache facade ──────────────────────────────────────────

describe('Cache facade', () => {
  let restore: () => void

  beforeEach(async () => {
    CacheRegistry.reset()
    restore = withCacheConfig({ default: 'memory', stores: { memory: { driver: 'memory' } } })
    await new CacheProvider({ instance: () => undefined } as never).boot()
  })

  afterEach(() => restore())

  it('throws when no adapter is registered', async () => {
    CacheRegistry.reset()
    await assert.rejects(async () => Cache.get('k'), /No cache adapter registered/)
  })

  it('get() returns null for a missing key', async () => {
    assert.strictEqual(await Cache.get('missing'), null)
  })

  it('set() + get() stores and retrieves a value', async () => {
    await Cache.set('user', { id: 1 })
    assert.deepStrictEqual(await Cache.get('user'), { id: 1 })
  })

  it('has() returns true for an existing key', async () => {
    await Cache.set('k', 'v')
    assert.strictEqual(await Cache.has('k'), true)
  })

  it('has() returns false for a missing key', async () => {
    assert.strictEqual(await Cache.has('missing'), false)
  })

  it('forget() removes a key', async () => {
    await Cache.set('k', 'v')
    await Cache.forget('k')
    assert.strictEqual(await Cache.get('k'), null)
  })

  it('flush() removes all keys', async () => {
    await Cache.set('a', 1)
    await Cache.set('b', 2)
    await Cache.flush()
    assert.strictEqual(await Cache.get('a'), null)
    assert.strictEqual(await Cache.get('b'), null)
  })

  it('get() returns null after TTL expires', async () => {
    await Cache.set('ttl', 'temp', 0.01)
    await sleep(20)
    assert.strictEqual(await Cache.get('ttl'), null)
  })

  // ── remember() ────────────────────────────────────────────

  it('remember() computes and stores on cache miss', async () => {
    let calls = 0
    const val = await Cache.remember('k', 60, () => { calls++; return 'v' })
    assert.strictEqual(val, 'v')
    assert.strictEqual(calls, 1)
  })

  it('remember() returns cached value and skips callback on hit', async () => {
    let calls = 0
    await Cache.remember('k', 60, () => { calls++; return 'first' })
    const val = await Cache.remember('k', 60, () => { calls++; return 'second' })
    assert.strictEqual(val, 'first')
    assert.strictEqual(calls, 1)
  })

  it('remember() re-computes after TTL expires', async () => {
    let calls = 0
    await Cache.remember('k', 0.01, () => { calls++; return 'first' })
    await sleep(20)
    const val = await Cache.remember('k', 60, () => { calls++; return 'second' })
    assert.strictEqual(val, 'second')
    assert.strictEqual(calls, 2)
  })

  it('remember() supports async callbacks', async () => {
    const val = await Cache.remember('k', 60, async () => {
      await Promise.resolve()
      return 42
    })
    assert.strictEqual(val, 42)
  })

  // ── rememberForever() ─────────────────────────────────────

  it('rememberForever() computes and stores without TTL', async () => {
    let calls = 0
    const val = await Cache.rememberForever('k', () => { calls++; return 'v' })
    assert.strictEqual(val, 'v')
    assert.strictEqual(calls, 1)
  })

  it('rememberForever() returns cached value on subsequent calls', async () => {
    let calls = 0
    await Cache.rememberForever('k', () => { calls++; return 'first' })
    const val = await Cache.rememberForever('k', () => { calls++; return 'second' })
    assert.strictEqual(val, 'first')
    assert.strictEqual(calls, 1)
  })

  it('rememberForever() value persists (no expiry)', async () => {
    await Cache.rememberForever('k', () => 'forever')
    await sleep(20)
    assert.strictEqual(await Cache.get('k'), 'forever')
  })

  // ── pull() ────────────────────────────────────────────────

  it('pull() returns the value and removes it', async () => {
    await Cache.set('k', 'v')
    const val = await Cache.pull('k')
    assert.strictEqual(val, 'v')
    assert.strictEqual(await Cache.get('k'), null)
  })

  it('pull() returns null for a missing key', async () => {
    assert.strictEqual(await Cache.pull('missing'), null)
  })

  it('pull() does not affect other keys', async () => {
    await Cache.set('a', 1)
    await Cache.set('b', 2)
    await Cache.pull('a')
    assert.strictEqual(await Cache.get('b'), 2)
  })
})

// ─── CacheProvider class ───────────────────────────────────────────

describe('CacheProvider', () => {
  let restore: () => void

  beforeEach(() => CacheRegistry.reset())
  afterEach(() => restore?.())

  const fakeApp = { instance: () => undefined } as never

  it('boots with memory driver and registers adapter', async () => {
    restore = withCacheConfig({ default: 'memory', stores: { memory: { driver: 'memory' } } })
    await new CacheProvider(fakeApp).boot()
    assert.ok(CacheRegistry.get() !== null)
  })

  it('falls back to memory driver when store config is missing', async () => {
    restore = withCacheConfig({ default: 'missing', stores: {} })
    await new CacheProvider(fakeApp).boot()
    assert.ok(CacheRegistry.get() !== null)
  })

  it('throws on an unknown driver', async () => {
    restore = withCacheConfig({ default: 'bad', stores: { bad: { driver: 'unsupported' } } })
    await assert.rejects(
      () => new CacheProvider(fakeApp).boot(),
      /Unknown driver "unsupported"/
    )
  })

  it('register() is a no-op', () => {
    restore = withCacheConfig({ default: 'memory', stores: { memory: { driver: 'memory' } } })
    assert.doesNotThrow(() => new CacheProvider(fakeApp).register())
  })

  it('boot() registers the cache:clear command, which flushes the live adapter', async () => {
    restore = withCacheConfig({ default: 'memory', stores: { memory: { driver: 'memory' } } })
    await new CacheProvider(fakeApp).boot()

    await Cache.set('key', 'value')
    assert.strictEqual(await Cache.get('key'), 'value')

    const cmd = rudder.getCommands().find(c => c.name === 'cache:clear')
    assert.ok(cmd, 'cache:clear registered during boot')
    await cmd.handler([], {})

    assert.strictEqual(await Cache.get('key'), null)
  })

  it('cache:clear resolves the adapter lazily (acts on a registry swap, not the boot-time closure)', async () => {
    restore = withCacheConfig({ default: 'memory', stores: { memory: { driver: 'memory' } } })
    await new CacheProvider(fakeApp).boot()

    // Swap the adapter after boot — the HMR re-boot / test-fake scenario.
    const swapped = new MemoryAdapter()
    await swapped.set('swapped-key', 1)
    CacheRegistry.set(swapped)

    const cmd = rudder.getCommands().find(c => c.name === 'cache:clear')
    await cmd!.handler([], {})

    assert.strictEqual(await swapped.get('swapped-key'), null, 'the CURRENT adapter was flushed')
  })
})
