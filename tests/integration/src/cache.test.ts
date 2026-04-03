/**
 * Cache integration tests — MemoryAdapter
 *
 * Tests MemoryAdapter directly (set/get/forget/has/flush) and the Cache static
 * facade (remember/rememberForever/pull) after wiring the adapter via CacheRegistry.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryAdapter, CacheRegistry, Cache } from '@rudderjs/cache'

let adapter: MemoryAdapter

describe('cache — MemoryAdapter integration', () => {
  beforeEach(() => {
    adapter = new MemoryAdapter()
    CacheRegistry.set(adapter)
  })

  describe('set() + get()', () => {
    it('stores and retrieves a string value', async () => {
      await adapter.set('key', 'hello', 60)
      assert.equal(await adapter.get('key'), 'hello')
    })

    it('stores and retrieves an object value', async () => {
      const obj = { name: 'Alice', age: 30 }
      await adapter.set('user', obj, 60)
      assert.deepEqual(await adapter.get('user'), obj)
    })

    it('returns null for missing key', async () => {
      assert.strictEqual(await adapter.get<string>('nonexistent'), null)
    })

    it('overwrites an existing key', async () => {
      await adapter.set('key', 'first', 60)
      await adapter.set('key', 'second', 60)
      assert.equal(await adapter.get('key'), 'second')
    })
  })

  describe('has()', () => {
    it('returns true for existing key', async () => {
      await adapter.set('key', 'value', 60)
      assert.equal(await adapter.has('key'), true)
    })

    it('returns false for missing key', async () => {
      assert.equal(await adapter.has('missing'), false)
    })
  })

  describe('forget()', () => {
    it('removes a key', async () => {
      await adapter.set('key', 'value', 60)
      await adapter.forget('key')
      assert.strictEqual(await adapter.get('key'), null)
    })

    it('does not throw for non-existent key', async () => {
      await assert.doesNotReject(() => adapter.forget('ghost'))
    })
  })

  describe('flush()', () => {
    it('removes all keys', async () => {
      await adapter.set('a', 1, 60)
      await adapter.set('b', 2, 60)
      await adapter.set('c', 3, 60)
      await adapter.flush()
      assert.strictEqual(await adapter.get('a'), null)
      assert.strictEqual(await adapter.get('b'), null)
      assert.strictEqual(await adapter.get('c'), null)
    })
  })

  describe('Cache facade — remember()', () => {
    it('stores computed value on first call', async () => {
      let calls = 0
      const value = await Cache.remember('key', 60, async () => { calls++; return 'computed' })
      assert.equal(value, 'computed')
      assert.equal(calls, 1)
    })

    it('returns cached value without recomputing on subsequent calls', async () => {
      let calls = 0
      const compute = async () => { calls++; return 'computed' }
      await Cache.remember('key', 60, compute)
      const second = await Cache.remember('key', 60, compute)
      assert.equal(second, 'computed')
      assert.equal(calls, 1)
    })

    it('recomputes after forget()', async () => {
      let calls = 0
      const compute = async () => { calls++; return 'value' }
      await Cache.remember('key', 60, compute)
      await Cache.forget('key')
      await Cache.remember('key', 60, compute)
      assert.equal(calls, 2)
    })
  })

  describe('Cache facade — pull()', () => {
    it('returns the value and removes the key', async () => {
      await adapter.set('temp', 'once', 60)
      const value = await Cache.pull<string>('temp')
      assert.equal(value, 'once')
      assert.strictEqual(await adapter.get('temp'), null)
    })

    it('returns null when key does not exist', async () => {
      assert.strictEqual(await Cache.pull('nonexistent'), null)
    })
  })

  describe('TTL behaviour', () => {
    it('TTL=0 is treated as no expiry (falsy → null expiresAt)', async () => {
      // ttlSeconds=0 is falsy so expiresAt=null — stored indefinitely
      await adapter.set('ttl-zero', 'kept', 0)
      await new Promise(r => setTimeout(r, 10))
      assert.equal(await adapter.get('ttl-zero'), 'kept')
    })

    it('key without TTL is stored indefinitely', async () => {
      await adapter.set('no-ttl', 'permanent')
      assert.equal(await adapter.get('no-ttl'), 'permanent')
    })
  })
})
