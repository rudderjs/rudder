import { randomUUID } from 'node:crypto'

// ─── Public types ──────────────────────────────────────────

/**
 * A coordinated, owner-scoped lock backed by a cache driver.
 *
 * Acquire is explicit — calling `Cache.lock(name, ttl)` does NOT acquire.
 * Use `.get()` for non-blocking try-acquire, `.block(seconds)` to wait.
 *
 * Release is owner-checked: `release()` only releases if THIS instance still
 * owns the lock. Use `forceRelease()` to bypass the owner check.
 */
export interface Lock {
  /** Try to acquire. Returns true on success, false if held by someone else. */
  get(): Promise<boolean>

  /**
   * Try to acquire and run callback. Auto-releases (try/finally).
   * Returns the callback's return value on success, false if not acquired.
   */
  get<T>(callback: () => T | Promise<T>): Promise<T | false>

  /**
   * Wait up to `seconds` for the lock to free, then acquire.
   * Polls every ~250ms. Throws `LockTimeoutError` on timeout.
   */
  block(seconds: number): Promise<void>
  block<T>(seconds: number, callback: () => T | Promise<T>): Promise<T>

  /** Release the lock — only if THIS instance still owns it (owner check). */
  release(): Promise<boolean>

  /** Release unconditionally — for stuck/orphaned locks. Use sparingly. */
  forceRelease(): Promise<void>

  /** Owner token. Stable across the Lock's lifetime; unique per instance. */
  owner(): string
}

export class LockTimeoutError extends Error {
  constructor(
    public readonly lockName: string,
    public readonly waitedSeconds: number,
  ) {
    super(`[RudderJS Cache] Could not acquire lock "${lockName}" within ${waitedSeconds}s.`)
    this.name = 'LockTimeoutError'
  }
}

/** Generate a 128-bit random owner token. */
export function newOwnerToken(): string {
  // randomUUID is 128 bits of entropy in Node's crypto. Hex would also work; UUID is fine.
  return randomUUID()
}

// ─── BaseLock ──────────────────────────────────────────────

/**
 * Shared overload + auto-release plumbing. Concrete drivers override
 * `acquire()`, `release()`, and `forceRelease()` only — the `get(callback?)`
 * and `block(seconds, callback?)` shapes live here so subclasses don't
 * repeat the overload pattern.
 */
export abstract class BaseLock implements Lock {
  protected constructor(
    protected readonly _name:    string,
    protected readonly _seconds: number,
    protected readonly _owner:   string,
  ) {}

  owner(): string { return this._owner }

  /** Driver-specific atomic try-acquire. true = acquired. */
  protected abstract acquire(): Promise<boolean>

  abstract release(): Promise<boolean>
  abstract forceRelease(): Promise<void>

  get(): Promise<boolean>
  get<T>(callback: () => T | Promise<T>): Promise<T | false>
  async get<T>(callback?: () => T | Promise<T>): Promise<T | false | boolean> {
    const acquired = await this.acquire()
    if (!acquired) return false
    if (!callback) return true
    try {
      return await callback()
    } finally {
      await this.release()
    }
  }

  block(seconds: number): Promise<void>
  block<T>(seconds: number, callback: () => T | Promise<T>): Promise<T>
  async block<T>(seconds: number, callback?: () => T | Promise<T>): Promise<T | void> {
    const deadline = Date.now() + seconds * 1_000
    const interval = 250
    while (true) {
      if (await this.acquire()) {
        if (!callback) return
        try {
          return await callback()
        } finally {
          await this.release()
        }
      }
      if (Date.now() >= deadline) break
      await new Promise<void>(r => setTimeout(r, interval))
    }
    throw new LockTimeoutError(this._name, seconds)
  }
}

// ─── MemoryLock ────────────────────────────────────────────

/**
 * Lock entry stored in `MemoryAdapter`'s shared `store` Map under
 * the `__lock__:` prefix. The existing `MemoryEntry.value` field
 * holds the owner token; `expiresAt` is the lock's TTL.
 */
interface LockBackedEntry {
  value:     unknown   // owner token (string) for lock entries
  expiresAt: number | null
}

export class MemoryLock extends BaseLock {
  constructor(
    name:    string,
    seconds: number,
    owner:   string,
    private readonly store: Map<string, LockBackedEntry>,
  ) {
    super(name, seconds, owner)
  }

  private key(): string { return `__lock__:${this._name}` }

  private readEntry(): LockBackedEntry | null {
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
    if (this.readEntry()) return false
    const expiresAt = this._seconds > 0 ? Date.now() + this._seconds * 1_000 : null
    this.store.set(this.key(), { value: this._owner, expiresAt })
    return true
  }

  async release(): Promise<boolean> {
    const entry = this.readEntry()
    if (!entry || entry.value !== this._owner) return false
    this.store.delete(this.key())
    return true
  }

  async forceRelease(): Promise<void> {
    this.store.delete(this.key())
  }
}

// ─── RedisLock ─────────────────────────────────────────────

/** Lua: compare-and-delete — atomic on Redis. */
export const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`.trim()

export interface RedisLockClient {
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>
  eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>
  del(...keys: string[]): Promise<unknown>
}

export class RedisLock extends BaseLock {
  constructor(
    name:    string,
    seconds: number,
    owner:   string,
    private readonly clientFactory: () => Promise<RedisLockClient>,
    private readonly prefix: string,
  ) {
    super(name, seconds, owner)
  }

  private key(): string { return `${this.prefix}__lock__:${this._name}` }

  protected async acquire(): Promise<boolean> {
    if (this._seconds <= 0) return false
    const client = await this.clientFactory()
    const result = await client.set(this.key(), this._owner, 'NX', 'EX', this._seconds)
    return result === 'OK'
  }

  async release(): Promise<boolean> {
    const client = await this.clientFactory()
    const result = await client.eval(RELEASE_LUA, 1, this.key(), this._owner)
    return result === 1
  }

  async forceRelease(): Promise<void> {
    const client = await this.clientFactory()
    await client.del(this.key())
  }
}
