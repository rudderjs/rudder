import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Cache, CacheRegistry, MemoryAdapter, FakeCacheAdapter, LockTimeoutError } from './index.js'

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Run the full matrix against both MemoryAdapter and FakeCacheAdapter to
// guarantee the fake mirrors real driver semantics. (Redis lives behind
// REDIS_TEST=1 in the integration block at the bottom.)
const drivers: Array<[name: string, build: () => MemoryAdapter | FakeCacheAdapter]> = [
  ['MemoryAdapter', () => new MemoryAdapter()],
  ['FakeCacheAdapter', () => new FakeCacheAdapter()],
]

for (const [name, build] of drivers) {
  describe(`Lock — ${name}`, () => {
    let adapter: MemoryAdapter | FakeCacheAdapter

    beforeEach(() => { adapter = build() })

    it('get() returns true on first acquire', async () => {
      const lock = adapter.lock('thing', 60)
      assert.strictEqual(await lock.get(), true)
    })

    it('get() returns false when held by someone else', async () => {
      const a = adapter.lock('thing', 60)
      const b = adapter.lock('thing', 60)
      assert.strictEqual(await a.get(), true)
      assert.strictEqual(await b.get(), false)
    })

    it('get(callback) runs callback + auto-releases', async () => {
      const lock = adapter.lock('thing', 60)
      const result = await lock.get(async () => 'computed')
      assert.strictEqual(result, 'computed')
      // Lock released; next acquire should succeed.
      const next = adapter.lock('thing', 60)
      assert.strictEqual(await next.get(), true)
    })

    it('get(callback) auto-releases even when the callback throws', async () => {
      const lock = adapter.lock('thing', 60)
      await assert.rejects(
        lock.get(async () => { throw new Error('boom') }),
        /boom/,
      )
      const next = adapter.lock('thing', 60)
      assert.strictEqual(await next.get(), true)
    })

    it('release() only succeeds for the owner', async () => {
      const a = adapter.lock('thing', 60)
      const b = adapter.lock('thing', 60)
      await a.get()
      assert.strictEqual(await b.release(), false, 'cross-owner release must be a no-op')
      // Lock still held by A.
      assert.strictEqual(await b.get(), false)
      // A can release.
      assert.strictEqual(await a.release(), true)
    })

    it('restoreLock(name, owner).release() works across instances', async () => {
      const a = adapter.lock('thing', 60)
      assert.strictEqual(await a.get(), true)
      const owner = a.owner()

      const restored = adapter.restoreLock('thing', owner)
      assert.strictEqual(await restored.release(), true)

      // Now free.
      const next = adapter.lock('thing', 60)
      assert.strictEqual(await next.get(), true)
    })

    it('restoreLock(name, wrongOwner).release() returns false', async () => {
      const a = adapter.lock('thing', 60)
      await a.get()
      const fake = adapter.restoreLock('thing', 'not-the-owner')
      assert.strictEqual(await fake.release(), false)
      // Lock still held.
      assert.strictEqual(await adapter.lock('thing', 60).get(), false)
    })

    it('forceRelease() always wipes the lock', async () => {
      const a = adapter.lock('thing', 60)
      await a.get()
      const stranger = adapter.lock('thing', 60)
      await stranger.forceRelease()
      // Now anyone can acquire.
      assert.strictEqual(await adapter.lock('thing', 60).get(), true)
    })

    it('block(seconds, cb) waits for the lock to free, then acquires', async () => {
      const holder = adapter.lock('thing', 60)
      assert.strictEqual(await holder.get(), true)

      // Release after 100ms.
      void sleep(100).then(() => holder.release())

      const start = Date.now()
      const result = await adapter.lock('thing', 60).block(2, async () => 'won')
      const elapsed = Date.now() - start
      assert.strictEqual(result, 'won')
      assert.ok(elapsed >= 100, 'should have waited at least the holder duration')
      assert.ok(elapsed < 1500, `should not have waited the full 2s, got ${elapsed}ms`)
    })

    it('block(seconds) without a callback acquires and returns void', async () => {
      const lock = adapter.lock('thing', 60)
      const ret  = await lock.block(1)
      assert.strictEqual(ret, undefined)
      // Caller must release manually.
      assert.strictEqual(await adapter.lock('thing', 60).get(), false)
      assert.strictEqual(await lock.release(), true)
    })

    it('block() throws LockTimeoutError when the wait deadline elapses', async () => {
      const holder = adapter.lock('thing', 60)
      assert.strictEqual(await holder.get(), true)

      try {
        await adapter.lock('thing', 60).block(0.5)
        assert.fail('should have thrown')
      } catch (err) {
        assert.ok(err instanceof LockTimeoutError, 'should be LockTimeoutError')
        assert.strictEqual((err as LockTimeoutError).lockName, 'thing')
        assert.strictEqual((err as LockTimeoutError).waitedSeconds, 0.5)
      }
    })

    it('TTL expiry frees the lock for the next caller', async () => {
      // TTL + sleep need to comfortably exceed Date.now() / setTimeout
      // resolution. Windows Node 20 quantizes both to ~15-32ms; a 50ms TTL
      // with a 30ms buffer flaked because the wall clock could advance past
      // expiresAt before the competing get() ran. 300ms TTL with a 100ms
      // buffer leaves headroom on every platform we test.
      const a = adapter.lock('thing', 0.3) // 300ms
      assert.strictEqual(await a.get(), true)
      assert.strictEqual(await adapter.lock('thing', 60).get(), false)
      await sleep(400)
      assert.strictEqual(await adapter.lock('thing', 60).get(), true)
    })

    it('owner() is stable across the lock\'s lifetime + unique per instance', async () => {
      const a = adapter.lock('thing', 60)
      const b = adapter.lock('thing', 60)
      assert.notStrictEqual(a.owner(), b.owner())
      assert.strictEqual(a.owner(), a.owner())
    })

    it('locks under different names do not interfere', async () => {
      const a = adapter.lock('a', 60)
      const b = adapter.lock('b', 60)
      assert.strictEqual(await a.get(), true)
      assert.strictEqual(await b.get(), true)
    })

    it('flush() wipes lock state', async () => {
      const a = adapter.lock('thing', 60)
      await a.get()
      await adapter.flush()
      // Lock state gone.
      assert.strictEqual(await adapter.lock('thing', 60).get(), true)
    })
  })
}

// ─── Cache facade integration ──────────────────────────────

describe('Cache.lock + Cache.restoreLock (facade)', () => {
  beforeEach(() => CacheRegistry.reset())

  it('Cache.lock() throws when no adapter is registered', () => {
    assert.throws(() => Cache.lock('foo', 60), /No cache adapter registered/)
  })

  it('Cache.lock() builds a Lock from the registered adapter', async () => {
    const adapter = new MemoryAdapter()
    CacheRegistry.set(adapter)

    const lock = Cache.lock('foo', 60)
    assert.strictEqual(await lock.get(), true)
    assert.strictEqual(await lock.release(), true)
  })

  it('Cache.restoreLock() releases by owner across handle instances', async () => {
    const adapter = new MemoryAdapter()
    CacheRegistry.set(adapter)

    const lock  = Cache.lock('foo', 60)
    assert.strictEqual(await lock.get(), true)
    const owner = lock.owner()

    const restored = Cache.restoreLock('foo', owner)
    assert.strictEqual(await restored.release(), true)
  })
})

// ─── FakeCacheAdapter lock assertions ──────────────────────

describe('FakeCacheAdapter — lock assertions', () => {
  it('records lock-acquire and lock-release ops', async () => {
    const fake = new FakeCacheAdapter()
    const lock = fake.lock('thing', 60)
    await lock.get()
    await lock.release()

    fake.assertLockAcquired('thing')
    fake.assertLockReleased('thing')

    const ops = fake.operations()
    const acquireOp = ops.find(o => o.type === 'lock-acquire')
    const releaseOp = ops.find(o => o.type === 'lock-release')
    assert.ok(acquireOp)
    assert.ok(releaseOp)
    assert.strictEqual(acquireOp!.value, true) // success flag
    assert.strictEqual(releaseOp!.value, true)
  })

  it('records lock-force-release as a release', async () => {
    const fake = new FakeCacheAdapter()
    const lock = fake.lock('thing', 60)
    await lock.get()
    await lock.forceRelease()
    fake.assertLockReleased('thing') // counts force-release too
  })

  it('assertLockAcquired throws when no acquire happened', () => {
    const fake = new FakeCacheAdapter()
    assert.throws(() => fake.assertLockAcquired('never'), /Expected lock "never" to be acquired/)
  })

  it('assertLockReleased throws when no release happened', () => {
    const fake = new FakeCacheAdapter()
    assert.throws(() => fake.assertLockReleased('never'), /Expected lock "never" to be released/)
  })
})
