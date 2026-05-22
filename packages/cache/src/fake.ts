import assert from 'node:assert/strict'
import { CacheRegistry } from './index.js'
import type { CacheAdapter } from './index.js'
import { BaseLock, newOwnerToken, type Lock } from './lock.js'

// ─── Types ────────────────────────────────────────────────

export interface CacheOperation {
  type:   'get' | 'set' | 'forget' | 'has' | 'flush' | 'increment' | 'add' | 'lock-acquire' | 'lock-release' | 'lock-force-release'
  key?:   string | undefined
  value?: unknown
  ttl?:   number | undefined
  owner?: string | undefined
}

// ─── Fake Adapter ─────────────────────────────────────────

interface FakeEntry {
  value:     unknown
  expiresAt: number | null
}

/**
 * Testing fake for @rudderjs/cache.
 *
 * Actually stores and retrieves values (so cache-dependent logic works in tests)
 * while also recording every operation for assertion.
 *
 * @example
 * const fake = Cache.fake()
 *
 * await Cache.set('user:1', { name: 'Alice' }, 60)
 * await Cache.get('user:1')
 *
 * fake.assertSet('user:1')
 * fake.assertGet('user:1')
 * fake.assertHas('user:1')
 *
 * fake.restore()
 */
export class FakeCacheAdapter implements CacheAdapter {
  private readonly _store = new Map<string, FakeEntry>()
  private readonly _operations: CacheOperation[] = []

  // ─── CacheAdapter ───────────────────────────────────────

  async get<T = unknown>(key: string): Promise<T | null> {
    this._operations.push({ type: 'get', key })
    const entry = this._store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this._store.delete(key)
      return null
    }
    return entry.value as T
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this._operations.push({ type: 'set', key, value, ttl: ttlSeconds })
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1_000 : null
    this._store.set(key, { value, expiresAt })
  }

  async increment(key: string, by = 1, ttlSeconds?: number): Promise<number> {
    this._operations.push({ type: 'increment', key, value: by, ttl: ttlSeconds })
    const existing = this._store.get(key)
    const now = Date.now()
    if (existing && (existing.expiresAt === null || now <= existing.expiresAt) && typeof existing.value === 'number') {
      const next = existing.value + by
      this._store.set(key, { value: next, expiresAt: existing.expiresAt })
      return next
    }
    const expiresAt = ttlSeconds ? now + ttlSeconds * 1_000 : null
    this._store.set(key, { value: by, expiresAt })
    return by
  }

  async add(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    this._operations.push({ type: 'add', key, value, ttl: ttlSeconds })
    const existing = this._store.get(key)
    const now = Date.now()
    if (existing && (existing.expiresAt === null || now <= existing.expiresAt)) {
      return false
    }
    const expiresAt = ttlSeconds ? now + ttlSeconds * 1_000 : null
    this._store.set(key, { value, expiresAt })
    return true
  }

  async forget(key: string): Promise<void> {
    this._operations.push({ type: 'forget', key })
    this._store.delete(key)
  }

  async has(key: string): Promise<boolean> {
    this._operations.push({ type: 'has', key })
    const entry = this._store.get(key)
    if (!entry) return false
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this._store.delete(key)
      return false
    }
    return true
  }

  async flush(): Promise<void> {
    this._operations.push({ type: 'flush' })
    this._store.clear()
  }

  lock(name: string, seconds: number): Lock {
    return new FakeLock(name, seconds, newOwnerToken(), this._store, this._operations)
  }

  restoreLock(name: string, owner: string): Lock {
    return new FakeLock(name, 0, owner, this._store, this._operations)
  }

  // ─── Assertions ─────────────────────────────────────────

  /** Assert that `set` was called for the given key. Optionally check the stored value with a predicate. */
  assertSet(key: string, predicate?: (value: unknown) => boolean): void {
    const op = this._operations.find(o => o.type === 'set' && o.key === key)
    assert.ok(op, `[RudderJS Cache] Expected key "${key}" to be set, but it was not.`)
    if (predicate) {
      assert.ok(
        predicate(op.value),
        `[RudderJS Cache] Key "${key}" was set, but the value did not match the predicate.`,
      )
    }
  }

  /** Assert that `get` was called for the given key. */
  assertGet(key: string): void {
    const op = this._operations.find(o => o.type === 'get' && o.key === key)
    assert.ok(op, `[RudderJS Cache] Expected key "${key}" to be retrieved, but it was not.`)
  }

  /** Assert that `forget` was called for the given key. */
  assertForgotten(key: string): void {
    const op = this._operations.find(o => o.type === 'forget' && o.key === key)
    assert.ok(op, `[RudderJS Cache] Expected key "${key}" to be forgotten, but it was not.`)
  }

  /** Assert that `flush` was called at least once. */
  assertFlushed(): void {
    const op = this._operations.find(o => o.type === 'flush')
    assert.ok(op, '[RudderJS Cache] Expected cache to be flushed, but it was not.')
  }

  /** Assert that a key is NOT currently in the store. */
  assertMissing(key: string): void {
    const entry = this._store.get(key)
    const exists = entry && (entry.expiresAt === null || Date.now() <= entry.expiresAt)
    assert.ok(!exists, `[RudderJS Cache] Expected key "${key}" to be missing, but it exists in the store.`)
  }

  /** Assert that a key IS currently in the store (and not expired). */
  assertHas(key: string): void {
    const entry = this._store.get(key)
    const exists = entry && (entry.expiresAt === null || Date.now() <= entry.expiresAt)
    assert.ok(exists, `[RudderJS Cache] Expected key "${key}" to exist in the store, but it does not.`)
  }

  /** Assert that a lock with this name was acquired at least once. */
  assertLockAcquired(name: string): void {
    const op = this._operations.find(o => o.type === 'lock-acquire' && o.key === name)
    assert.ok(op, `[RudderJS Cache] Expected lock "${name}" to be acquired, but it was not.`)
  }

  /** Assert that a lock with this name was released at least once. */
  assertLockReleased(name: string): void {
    const op = this._operations.find(o => (o.type === 'lock-release' || o.type === 'lock-force-release') && o.key === name)
    assert.ok(op, `[RudderJS Cache] Expected lock "${name}" to be released, but it was not.`)
  }

  // ─── Access ─────────────────────────────────────────────

  /** Return all recorded operations. */
  operations(): CacheOperation[] {
    return [...this._operations]
  }

  // ─── Install ─────────────────────────────────────────────

  /** Install the fake — replaces the registered cache adapter with this fake. */
  static fake(): FakeCacheAdapter {
    const fake = new FakeCacheAdapter()
    CacheRegistry.set(fake)
    return fake
  }

  // ─── Cleanup ────────────────────────────────────────────

  /** Restore the cache registry to its original state (no adapter). */
  restore(): void {
    CacheRegistry.reset()
  }
}

// ─── Fake Lock ────────────────────────────────────────────

class FakeLock extends BaseLock {
  constructor(
    name:    string,
    seconds: number,
    owner:   string,
    private readonly store: Map<string, FakeEntry>,
    private readonly ops:   CacheOperation[],
  ) {
    super(name, seconds, owner)
  }

  private key(): string { return `__lock__:${this._name}` }

  private readEntry(): FakeEntry | null {
    const k = this.key()
    const entry = this.store.get(k)
    if (!entry) return null
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(k)
      return null
    }
    return entry
  }

  protected async acquire(): Promise<boolean> {
    if (this.readEntry()) {
      this.ops.push({ type: 'lock-acquire', key: this._name, owner: this._owner, value: false })
      return false
    }
    const expiresAt = this._seconds > 0 ? Date.now() + this._seconds * 1_000 : null
    this.store.set(this.key(), { value: this._owner, expiresAt })
    this.ops.push({ type: 'lock-acquire', key: this._name, owner: this._owner, value: true, ttl: this._seconds })
    return true
  }

  async release(): Promise<boolean> {
    const entry = this.readEntry()
    if (!entry || entry.value !== this._owner) {
      this.ops.push({ type: 'lock-release', key: this._name, owner: this._owner, value: false })
      return false
    }
    this.store.delete(this.key())
    this.ops.push({ type: 'lock-release', key: this._name, owner: this._owner, value: true })
    return true
  }

  async forceRelease(): Promise<void> {
    this.store.delete(this.key())
    this.ops.push({ type: 'lock-force-release', key: this._name, owner: this._owner })
  }
}
