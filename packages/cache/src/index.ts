import { ServiceProvider, rudder, config } from '@rudderjs/core'
import { resolveIoredisClass, reusableConnection } from '@rudderjs/support'

import { FakeCacheAdapter } from './fake.js'
import { MemoryLock, RedisLock, newOwnerToken, LOCK_KEY_PREFIX, type Lock, type RedisLockClient } from './lock.js'
export { FakeCacheAdapter, type CacheOperation } from './fake.js'
export { type Lock, LockTimeoutError, MemoryLock, RedisLock, BaseLock, LOCK_KEY_PREFIX } from './lock.js'

// ─── Reserved-key guard ────────────────────────────────────

/**
 * Reject a value-API key that collides with the lock namespace. Locks live in
 * the same keyspace under `LOCK_KEY_PREFIX` (`__lock__:`), so an un-guarded
 * `Cache.set('__lock__:podcast', token)` could forge a lock's owner token,
 * `Cache.forget('__lock__:podcast')` could destroy a held lock, and
 * `Cache.get('__lock__:podcast')` could read the secret token — all from the
 * ordinary value API with a caller-influenced key. The prefix is reserved.
 */
export function assertValueKey(key: string): void {
  if (key.startsWith(LOCK_KEY_PREFIX)) {
    throw new Error(
      `[RudderJS Cache] Key "${key}" uses the reserved lock prefix "${LOCK_KEY_PREFIX}". ` +
      `Use Cache.lock(name, ttl) for locks; value keys may not start with this prefix.`,
    )
  }
}

/**
 * Escape Redis glob metacharacters so a configured key prefix is matched
 * LITERALLY by `SCAN MATCH`. Without this, a prefix like `app[staging]:` or
 * `team*:` is interpreted as a glob — matching the wrong keys (cross-namespace
 * over-match, or silently missing keys). @internal
 */
export function escapeRedisGlob(value: string): string {
  return value.replace(/[\\*?[\]]/g, '\\$&')
}

interface RedisScanClient {
  scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]>
  del(...keys: string[]): Promise<unknown>
}

/**
 * Non-blocking prefix flush: walk the keyspace with a `SCAN` cursor (NOT the
 * O(N)-blocking `KEYS`, which stalls the whole Redis instance on a large
 * keyspace) and delete matches in batches. @internal
 */
export async function scanAndDelete(client: RedisScanClient, pattern: string): Promise<void> {
  let cursor = '0'
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    if (keys.length) await client.del(...keys)
    cursor = next
  } while (cursor !== '0')
}

// ─── Adapter Contract ──────────────────────────────────────

export interface CacheAdapter {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  forget(key: string): Promise<void>
  has(key: string): Promise<boolean>
  flush(): Promise<void>
  /**
   * Close the underlying connection so one-shot processes (CLI commands) can
   * exit — an open ioredis client keeps the event loop alive. Optional:
   * in-memory stores have nothing to close.
   */
  disconnect?(): Promise<void>
  /**
   * Atomically add `by` (default `1`) to the integer counter at `key` and
   * return the new value. When the key does not exist, it is initialized to
   * `by` and `ttlSeconds` is applied to the new key; subsequent increments
   * preserve the original expiry (the TTL is NOT refreshed). Essential for
   * race-free rate limiting and counters — the prior `get → modify → set`
   * pattern allowed concurrent requests to silently undercount.
   */
  increment(key: string, by?: number, ttlSeconds?: number): Promise<number>
  /**
   * Atomically store `value` at `key` only if the key does not already exist.
   * Returns `true` when the value was stored (caller "won the race"), `false`
   * when another writer was first. TTL is applied on first write. Redis uses
   * `SET NX EX`; in-memory uses a synchronous check-and-set. Use for unique
   * claims (queue unique-jobs, single-leader election, idempotency keys).
   */
  add(key: string, value: unknown, ttlSeconds?: number): Promise<boolean>
  /**
   * Atomically read `key` and remove it in one operation, returning the prior
   * value (or `null`). Optional: adapters that implement it close the
   * get-then-delete race where two concurrent `pull`s both observe the same
   * value (double-redemption of a one-time token). The `Cache.pull` facade
   * falls back to a non-atomic get-then-forget when an adapter omits it.
   */
  pull?<T = unknown>(key: string): Promise<T | null>
  /** Build a lock backed by this driver. Does NOT acquire — call .get() or .block(). */
  lock(name: string, seconds: number): Lock
  /** Rebuild a lock with a specific owner token (cross-process release). */
  restoreLock(name: string, owner: string): Lock
}

export interface CacheAdapterProvider {
  create(): CacheAdapter | Promise<CacheAdapter>
}

// ─── Cache Registry ────────────────────────────────────────

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@rudderjs/cache` is loaded twice — typical in a Vite-bundled
 * server where the framework bundles `@rudderjs/middleware` inline (which
 * imports `CacheRegistry` for `RateLimit`), but `CacheProvider.boot()` runs
 * from a `node_modules` copy of `@rudderjs/cache` resolved via the provider
 * auto-discovery manifest. Without a shared store, `set()` from the
 * externalized copy would land on a different class than the one `Cache.*` /
 * `RateLimit` read from inside the bundle, producing a misleading
 * `No cache adapter registered` error on every rate-limited route in prod.
 * Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`) and PR #500
 * (`@rudderjs/pennant` `PennantRegistry`).
 */
interface CacheRegistryStore {
  adapter:     CacheAdapter | null
  defaultName: string | null
}

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_cache_registry__']) {
  _g['__rudderjs_cache_registry__'] = {
    adapter:     null,
    defaultName: null,
  } satisfies CacheRegistryStore
}
const _store = _g['__rudderjs_cache_registry__'] as CacheRegistryStore

export class CacheRegistry {
  static set(adapter: CacheAdapter): void    { _store.adapter = adapter }
  static get(): CacheAdapter | null          { return _store.adapter }
  static setDefaultName(name: string): void  { _store.defaultName = name }
  static getDefaultName(): string | null     { return _store.defaultName }
  /**
   * Drop the registered cache adapter. Test-cleanup hook — kept on the
   * public API because other packages' test suites (`@rudderjs/auth` is one)
   * reset the registry across the package boundary.
   */
  static reset(): void {
    _store.adapter = null
    _store.defaultName = null
  }
}

// ─── Cache Facade ──────────────────────────────────────────

export class Cache {
  private static store(): CacheAdapter {
    const a = CacheRegistry.get()
    if (!a) throw new Error('[RudderJS Cache] No cache adapter registered. Add cache() to providers.')
    return a
  }

  /** Retrieve a value. Returns null on miss or expiry. */
  static get<T = unknown>(key: string): Promise<T | null> {
    return this.store().get<T>(key)
  }

  /** Store a value, optionally with a TTL in seconds. */
  static set(key: string, value: unknown, ttl?: number): Promise<void> {
    return this.store().set(key, value, ttl)
  }

  /**
   * Atomically increment the integer counter at `key` by `by` (default `1`)
   * and return the new value. When the key is missing it is created with the
   * given `ttl` (seconds); subsequent increments preserve the original expiry
   * (the TTL is NOT refreshed) — matches Redis `INCRBY` + first-write `EXPIRE`
   * semantics. Race-free under concurrent callers.
   *
   * @example
   *   const count = await Cache.increment('rate:1.2.3.4', 1, 60)
   *   if (count > 5) throw new TooManyRequestsError()
   */
  static increment(key: string, by?: number, ttl?: number): Promise<number> {
    return this.store().increment(key, by, ttl)
  }

  /**
   * Atomically claim `key` with `value`. Returns `true` if THIS caller wrote
   * (no prior value), `false` if a concurrent caller got there first. Race-free
   * under concurrent dispatchers — Redis: `SET NX EX`; in-memory: sync CAS.
   *
   * @example
   *   if (await Cache.add('unique:sync-inventory-1', '1', 60)) {
   *     await queue.dispatch(new SyncInventory(1))
   *   } // else: another dispatcher already claimed it
   */
  static add(key: string, value: unknown, ttl?: number): Promise<boolean> {
    return this.store().add(key, value, ttl)
  }

  /**
   * Retrieve a value, or compute + store it if missing.
   * @param ttl Time-to-live in seconds
   */
  static async remember<T = unknown>(
    key: string,
    ttl: number,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) return cached
    const value = await callback()
    await this.set(key, value, ttl)
    return value
  }

  /**
   * Retrieve a value, or compute + store it forever (no TTL) if missing.
   */
  static async rememberForever<T = unknown>(
    key: string,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key)
    if (cached !== null) return cached
    const value = await callback()
    await this.set(key, value)
    return value
  }

  /**
   * Retrieve a value and immediately remove it from the cache.
   * Returns null if the key does not exist.
   *
   * Atomic when the driver supports it (Redis Lua get+del; in-memory sync
   * get+delete) — so two concurrent `pull`s of a one-time token can't both
   * win. Adapters without an atomic `pull` fall back to get-then-forget.
   */
  static async pull<T = unknown>(key: string): Promise<T | null> {
    const store = this.store()
    if (store.pull) return store.pull<T>(key)
    const value = await store.get<T>(key)
    if (value !== null) await store.forget(key)
    return value
  }

  /** Remove a single key. */
  static forget(key: string): Promise<void>  { return this.store().forget(key) }

  /** Check if a key exists (and hasn't expired). */
  static has(key: string): Promise<boolean>  { return this.store().has(key) }

  /** Remove all cached entries. */
  static flush(): Promise<void>              { return this.store().flush() }

  /**
   * Build a lock handle for the given name. Does NOT acquire — call `.get()` or `.block()`.
   *
   * @param seconds Lock TTL once acquired. Required.
   *
   * @example
   *   await Cache.lock('process-podcast:42', 120).get(async () => {
   *     await processPodcast(42)
   *   })
   */
  static lock(name: string, seconds: number): Lock {
    return this.store().lock(name, seconds)
  }

  /**
   * Rebuild a lock handle owned by a specific token (cross-process release).
   * The first call (`release`/`forceRelease`) is what makes the network round-trip.
   *
   * @example
   *   const owner = lock.owner()      // capture before serialising into a job
   *   // ...later, possibly in a different process:
   *   await Cache.restoreLock('process-podcast:42', owner).release()
   */
  static restoreLock(name: string, owner: string): Lock {
    return this.store().restoreLock(name, owner)
  }

  /** Replace the cache adapter with a fake for testing. */
  static fake(): FakeCacheAdapter {
    return FakeCacheAdapter.fake()
  }
}

// ─── Memory Driver (built-in) ──────────────────────────────

interface MemoryEntry {
  value:     unknown
  expiresAt: number | null   // epoch ms; null = never expires
}

/**
 * Validate the `by` argument shared by every adapter's `increment`. Redis
 * `INCRBY` rejects a non-integer outright (the `eval` promise rejects), so an
 * unvalidated float/`NaN`/`Infinity` makes the in-memory drivers DIVERGE from
 * Redis (they would silently corrupt the counter — `+ NaN` poisons it to a
 * permanent `NaN`, which then compares `false` against any limit and silently
 * disables a rate limiter). Reject up front so every driver behaves the same.
 * Negative integers are allowed — that is the decrement use.
 */
const DEFAULT_MAX_ENTRIES = 100_000

function assertIncrementBy(by: number): void {
  if (!Number.isInteger(by)) {
    throw new TypeError(
      `[RudderJS Cache] increment(by) must be an integer, got ${by}.`,
    )
  }
}

export interface MemoryAdapterOptions {
  /**
   * Hard cap on the number of live entries. The in-process Map evicts (expired
   * entries first, then oldest-inserted) once this is reached, so a flood of
   * write-once keys — IP-keyed rate-limit counters under a rotating-source
   * attack is the canonical case — can't grow the heap without bound. Default
   * 100,000. Set higher for large in-memory working sets, or move to the redis
   * driver.
   */
  maxEntries?: number
}

/**
 * In-process cache driver — the default if no other driver is configured.
 *
 * Resets on restart. Single-process only: locks built via `lock()` coordinate
 * within ONE Node process. Across `pm2 cluster`, multiple containers, or
 * multiple `tsx` invocations they are independent — each process holds its
 * own copy of the Map. Use the `redis` driver for real cross-process locks.
 */
export class MemoryAdapter implements CacheAdapter {
  private readonly store = new Map<string, MemoryEntry>()
  private readonly maxEntries: number

  constructor(options: MemoryAdapterOptions = {}) {
    const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxEntries = Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_ENTRIES
  }

  private expired(entry: MemoryEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt
  }

  /**
   * Bound the Map before inserting a NEW key. Expired entries are only swept
   * lazily on read, so a write-only flood of distinct keys (the rotating-IP
   * rate-limit case) would otherwise grow the heap until OOM. When at the cap,
   * evict one victim: prefer an expired entry near the front (oldest-inserted,
   * most likely to be stale — bounded scan keeps this O(1) amortized), else
   * drop the oldest-inserted live entry (FIFO). Memory is hard-bounded at
   * `maxEntries`.
   */
  private evictIfFull(): void {
    if (this.store.size < this.maxEntries) return
    const now = Date.now()
    let scanned = 0
    for (const [k, entry] of this.store) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(k)
        return
      }
      if (++scanned >= 64) break
    }
    const oldest = this.store.keys().next().value
    if (oldest !== undefined) this.store.delete(oldest)
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    assertValueKey(key)
    const entry = this.store.get(key)
    if (!entry) return null
    if (this.expired(entry)) { this.store.delete(key); return null }
    return entry.value as T
  }

  /** Atomic read-and-remove — synchronous in-process, so concurrent pulls can't both win. */
  async pull<T = unknown>(key: string): Promise<T | null> {
    assertValueKey(key)
    const entry = this.store.get(key)
    if (!entry) return null
    this.store.delete(key)
    if (this.expired(entry)) return null
    return entry.value as T
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    assertValueKey(key)
    if (!this.store.has(key)) this.evictIfFull()
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1_000 : null
    this.store.set(key, { value, expiresAt })
  }

  async increment(key: string, by = 1, ttlSeconds?: number): Promise<number> {
    assertValueKey(key)
    assertIncrementBy(by)
    const existing = this.store.get(key)
    if (existing && !this.expired(existing) && typeof existing.value === 'number') {
      const next = existing.value + by
      this.store.set(key, { value: next, expiresAt: existing.expiresAt })
      return next
    }
    if (!this.store.has(key)) this.evictIfFull()
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1_000 : null
    this.store.set(key, { value: by, expiresAt })
    return by
  }

  async add(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    assertValueKey(key)
    const existing = this.store.get(key)
    if (existing && !this.expired(existing)) return false
    if (!this.store.has(key)) this.evictIfFull()
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1_000 : null
    this.store.set(key, { value, expiresAt })
    return true
  }

  async forget(key: string): Promise<void>  { assertValueKey(key); this.store.delete(key) }

  async has(key: string): Promise<boolean> {
    assertValueKey(key)
    const entry = this.store.get(key)
    if (!entry) return false
    if (this.expired(entry)) { this.store.delete(key); return false }
    return true
  }

  async flush(): Promise<void> { this.store.clear() }

  lock(name: string, seconds: number): Lock {
    return new MemoryLock(name, seconds, newOwnerToken(), this.store)
  }

  restoreLock(name: string, owner: string): Lock {
    return new MemoryLock(name, 0, owner, this.store)
  }
}

// ─── Redis Driver (built-in, requires ioredis) ─────────────

export interface RedisCacheConfig {
  driver:    'redis'
  host?:     string
  port?:     number
  password?: string
  db?:       number
  url?:      string    // redis://... overrides host/port/password
  prefix?:   string    // key prefix, e.g. 'myapp:'
}

class RedisAdapter implements CacheAdapter {
  private client:       unknown
  private readonly prefix: string

  constructor(private readonly config: RedisCacheConfig) {
    this.prefix = config.prefix ?? ''
  }

  private async getClient(): Promise<{
    get(key: string): Promise<string | null>
    set(key: string, value: string, ...args: unknown[]): Promise<unknown>
    del(...keys: string[]): Promise<unknown>
    exists(...keys: string[]): Promise<number>
    scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]>
    flushdb(): Promise<unknown>
    eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>
  }> {
    if (!this.client) {
      // Reuse one ioredis client across dev HMR re-boots — CacheProvider.boot()
      // rebuilds this RedisAdapter on every edit, so without reuse each re-boot
      // opens (and leaks) a fresh Redis connection. See reusableConnection().
      const signature = this.config.url
        ?? `${this.config.host ?? '127.0.0.1'}:${this.config.port ?? 6379}:${this.config.db ?? 0}:${this.config.password ?? ''}`
      this.client = await reusableConnection<import('ioredis').Redis>(
        '__rudderjs_cache_redis__',
        signature,
        async () => {
          const Redis = resolveIoredisClass<import('ioredis').Redis>(await import('ioredis'))
          return this.config.url
            ? new Redis(this.config.url)
            : new Redis({
                host:     this.config.host     ?? '127.0.0.1',
                port:     this.config.port     ?? 6379,
                password: this.config.password,
                db:       this.config.db       ?? 0,
              })
        },
        (client) => client.quit(),
      )
    }
    return this.client as Awaited<ReturnType<RedisAdapter['getClient']>>
  }

  private k(key: string): string { assertValueKey(key); return `${this.prefix}${key}` }

  async get<T = unknown>(key: string): Promise<T | null> {
    const client = await this.getClient()
    const raw = await client.get(this.k(key))
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      await this.forget(key)
      return null
    }
  }

  async pull<T = unknown>(key: string): Promise<T | null> {
    const client = await this.getClient()
    // Atomic get-and-delete via Lua (portable across Redis versions — GETDEL
    // needs 6.2). Returns the prior value or nil, deleting in the same call so
    // two concurrent pulls can't both observe it.
    const script = `local v = redis.call('GET', KEYS[1])
                    if v then redis.call('DEL', KEYS[1]) end
                    return v`
    const raw = await client.eval(script, 1, this.k(key)) as string | null
    if (raw === null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const client = await this.getClient()
    const serialised = JSON.stringify(value)
    if (ttlSeconds) {
      await client.set(this.k(key), serialised, 'EX', ttlSeconds)
    } else {
      await client.set(this.k(key), serialised)
    }
  }

  async increment(key: string, by = 1, ttlSeconds?: number): Promise<number> {
    assertIncrementBy(by)
    const client = await this.getClient()
    // Atomic INCRBY + EXPIRE-only-on-create via Lua. Setting EXPIRE only when
    // the existing TTL is -1 (no TTL set) preserves the window's original
    // expiry across subsequent increments — matches Laravel's `Cache::increment`
    // semantics.
    const script = ttlSeconds && ttlSeconds > 0
      ? `local new = redis.call('INCRBY', KEYS[1], ARGV[1])
         if redis.call('TTL', KEYS[1]) == -1 then
           redis.call('EXPIRE', KEYS[1], ARGV[2])
         end
         return new`
      : `return redis.call('INCRBY', KEYS[1], ARGV[1])`
    const args = ttlSeconds && ttlSeconds > 0
      ? [String(by), String(ttlSeconds)]
      : [String(by)]
    const result = await client.eval(script, 1, this.k(key), ...args)
    return Number(result)
  }

  async add(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    const client = await this.getClient()
    const serialised = JSON.stringify(value)
    // `SET NX` returns 'OK' on first-write and null when the key already
    // exists. Pair with `EX <ttl>` for an atomic claim with expiry.
    const args = ttlSeconds && ttlSeconds > 0
      ? ['NX', 'EX', ttlSeconds]
      : ['NX']
    const result = await client.set(this.k(key), serialised, ...args)
    return result !== null
  }

  async forget(key: string): Promise<void> {
    const client = await this.getClient()
    await client.del(this.k(key))
  }

  async has(key: string): Promise<boolean> {
    const client = await this.getClient()
    return (await client.exists(this.k(key))) === 1
  }

  async flush(): Promise<void> {
    const client = await this.getClient()
    if (this.prefix) {
      // Non-blocking SCAN over the escaped prefix (KEYS is O(N) and stalls the
      // whole instance; an un-escaped prefix with glob metachars would match
      // the wrong keys). Only this adapter's namespace is touched.
      await scanAndDelete(client, `${escapeRedisGlob(this.prefix)}*`)
    } else {
      await client.flushdb()
    }
  }

  lock(name: string, seconds: number): Lock {
    return new RedisLock(
      name,
      seconds,
      newOwnerToken(),
      () => this.getClient() as unknown as Promise<RedisLockClient>,
      this.prefix,
    )
  }

  restoreLock(name: string, owner: string): Lock {
    return new RedisLock(
      name,
      0,
      owner,
      () => this.getClient() as unknown as Promise<RedisLockClient>,
      this.prefix,
    )
  }

  async disconnect(): Promise<void> {
    // Quit the shared client AND clear the reusableConnection slot so a later
    // boot (dev re-boot, next command) rebuilds instead of reusing a closed
    // connection.
    const g = globalThis as Record<string, unknown>
    const entry = g['__rudderjs_cache_redis__'] as { promise: Promise<{ quit(): Promise<unknown> }> } | undefined
    if (entry) {
      delete g['__rudderjs_cache_redis__']
      try { await (await entry.promise).quit() } catch { /* best effort — connection may already be gone */ }
    }
    this.client = undefined
  }
}

// ─── Config ────────────────────────────────────────────────

export interface CacheStoreConfig {
  driver: string
  [key: string]: unknown
}

export interface CacheConfig {
  /** The default cache store name */
  default: string
  /** Named cache stores */
  stores: Record<string, CacheStoreConfig>
}

// ─── Service Provider ──────────────────────────────────────

/**
 * Service provider for the cache subsystem.
 *
 * Built-in drivers:  memory (in-process — resets on restart, great for dev)
 *                    redis  (requires ioredis: pnpm add ioredis)
 *
 * Usage in bootstrap/providers.ts:
 *   import { CacheProvider } from '@rudderjs/cache'
 *   export default [..., CacheProvider, ...]
 *
 * Reads its config from `config('cache')` at boot time.
 */
export class CacheProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const cfg         = config<CacheConfig>('cache')
    const storeName   = cfg.default
    const definedStore = cfg.stores[storeName]
    const storeConfig = definedStore ?? { driver: 'memory' }
    const driver      = storeConfig['driver'] as string

    // A default store name that isn't defined falls back to an in-process
    // memory driver. That is a real isolation downgrade in production (locks
    // and rate-limit counters become per-process, so each cluster worker /
    // container gets its own bucket and an attacker gets N× the allowance), so
    // surface it loudly instead of degrading silently on a config typo.
    if (!definedStore) {
      console.warn(
        `[RudderJS Cache] Default store "${storeName}" is not defined in config.cache.stores — ` +
        `falling back to the in-process "memory" driver. Locks and rate-limit counters will ` +
        `NOT be shared across processes. Define the store or fix config.cache.default.`,
      )
    }

    let adapter: CacheAdapter

    if (driver === 'memory') {
      const maxEntries = storeConfig['maxEntries']
      adapter = new MemoryAdapter(typeof maxEntries === 'number' ? { maxEntries } : {})
    } else if (driver === 'redis') {
      adapter = new RedisAdapter(storeConfig as RedisCacheConfig)
    } else {
      throw new Error(`[RudderJS Cache] Unknown driver "${driver}". Available: memory, redis`)
    }

    CacheRegistry.set(adapter)
    CacheRegistry.setDefaultName(storeName)
    this.app.instance('cache', adapter)

    // Lazy registry lookup (not the `adapter` closure) — dev HMR re-boots
    // re-run boot() and rudder.command() dedupes by name; a stale closure
    // would flush the previous adapter. Same pattern as @rudderjs/queue.
    rudder.command('cache:clear', async () => {
      const a = CacheRegistry.get()
      if (!a) throw new Error('[RudderJS Cache] No cache adapter registered. Add cache() to providers.')
      await a.flush()
      console.log(`Cache store "${CacheRegistry.getDefaultName() ?? 'default'}" cleared.`)
      // Close the connection so this one-shot command exits — an open ioredis
      // client keeps the event loop alive and hangs the CLI.
      await a.disconnect?.()
    }).description('Flush the application cache store — pnpm rudder cache:clear')
  }
}
