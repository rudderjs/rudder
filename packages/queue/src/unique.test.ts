import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { FakeCacheAdapter } from '@rudderjs/cache'
import { Job } from './index.js'
import { acquireUniqueLock, releaseUniqueLock, _clearLocks, type ShouldBeUnique } from './unique.js'

class UniqueJob extends Job implements ShouldBeUnique {
  constructor(private readonly _id: string, private readonly _ttl = 0) { super() }
  uniqueId(): string { return this._id }
  uniqueFor(): number { return this._ttl }
  async handle(): Promise<void> { /* noop */ }
}

describe('acquireUniqueLock — cache backed', () => {
  let fake: FakeCacheAdapter
  beforeEach(() => { fake = FakeCacheAdapter.fake(); _clearLocks() })
  afterEach(()  => fake.restore())

  it('acquires the lock through @rudderjs/cache when an adapter is registered', async () => {
    const job = new UniqueJob('sync-inventory-1', 60)
    assert.strictEqual(await acquireUniqueLock(job), true)
    fake.assertSet('rudderjs:unique:sync-inventory-1', v => v === '1')
  })

  it('returns false when the cache key is already held', async () => {
    await fake.set('rudderjs:unique:sync-inventory-1', '1', 60)
    const job = new UniqueJob('sync-inventory-1', 60)
    assert.strictEqual(await acquireUniqueLock(job), false)
  })

  it('releaseUniqueLock forgets the cache key', async () => {
    const job = new UniqueJob('sync-inventory-1', 60)
    await acquireUniqueLock(job)
    await releaseUniqueLock(job)
    fake.assertForgotten('rudderjs:unique:sync-inventory-1')
  })
})

describe('acquireUniqueLock — in-memory fallback', () => {
  beforeEach(() => { _clearLocks() })

  it('falls back to the in-memory map when no cache adapter is registered', async () => {
    const job = new UniqueJob('sync-inventory-2', 60)
    assert.strictEqual(await acquireUniqueLock(job), true)
    // Second acquire on the same id within TTL must fail.
    assert.strictEqual(await acquireUniqueLock(job), false)
  })

  it('releaseUniqueLock clears the in-memory entry', async () => {
    const job = new UniqueJob('sync-inventory-2', 60)
    await acquireUniqueLock(job)
    await releaseUniqueLock(job)
    assert.strictEqual(await acquireUniqueLock(job), true)
  })
})
