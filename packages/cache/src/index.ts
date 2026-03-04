import { ServiceProvider, type Application } from '@boostkit/core'

// ─── Adapter Contract ──────────────────────────────────────

export interface CacheAdapter {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  forget(key: string): Promise<void>
  has(key: string): Promise<boolean>
  flush(): Promise<void>
}

export interface CacheAdapterProvider {
  create(): CacheAdapter | Promise<CacheAdapter>
}

// ─── Cache Registry ────────────────────────────────────────

export class CacheRegistry {
  private static adapter: CacheAdapter | null = null

  static set(adapter: CacheAdapter): void { this.adapter = adapter }
  static get(): CacheAdapter | null        { return this.adapter }
}

// ─── Cache Facade ──────────────────────────────────────────

export class Cache {
  private static store(): CacheAdapter {
    const a = CacheRegistry.get()
    if (!a) throw new Error('[BoostKit Cache] No cache adapter registered. Add cache() to providers.')
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

  /** Remove a single key. */
  static forget(key: string): Promise<void>  { return this.store().forget(key) }

  /** Check if a key exists (and hasn't expired). */
  static has(key: string): Promise<boolean>  { return this.store().has(key) }

  /** Remove all cached entries. */
  static flush(): Promise<void>              { return this.store().flush() }
}

// ─── Memory Driver (built-in) ──────────────────────────────

interface MemoryEntry {
  value:     unknown
  expiresAt: number | null   // epoch ms; null = never expires
}

class MemoryAdapter implements CacheAdapter {
  private readonly store = new Map<string, MemoryEntry>()

  private expired(entry: MemoryEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (this.expired(entry)) { this.store.delete(key); return null }
    return entry.value as T
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1_000 : null
    this.store.set(key, { value, expiresAt })
  }

  async forget(key: string): Promise<void>  { this.store.delete(key) }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key)
    if (!entry) return false
    if (this.expired(entry)) { this.store.delete(key); return false }
    return true
  }

  async flush(): Promise<void> { this.store.clear() }
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
    keys(pattern: string): Promise<string[]>
    flushdb(): Promise<unknown>
  }> {
    if (!this.client) {
      const { Redis } = await import('ioredis') as any
      this.client = this.config.url
        ? new Redis(this.config.url)
        : new Redis({
            host:     this.config.host     ?? '127.0.0.1',
            port:     this.config.port     ?? 6379,
            password: this.config.password,
            db:       this.config.db       ?? 0,
          })
    }
    return this.client as Awaited<ReturnType<RedisAdapter['getClient']>>
  }

  private k(key: string): string { return `${this.prefix}${key}` }

  async get<T = unknown>(key: string): Promise<T | null> {
    const client = await this.getClient()
    const raw = await client.get(this.k(key))
    if (raw === null) return null
    return JSON.parse(raw) as T
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
      const keys = await client.keys(`${this.prefix}*`)
      if (keys.length) await client.del(...keys)
    } else {
      await client.flushdb()
    }
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

// ─── Service Provider Factory ──────────────────────────────

/**
 * Returns a CacheServiceProvider class configured for the given cache config.
 *
 * Built-in drivers:  memory (in-process — resets on restart, great for dev)
 *                    redis  (requires ioredis: pnpm add ioredis)
 *
 * Usage in bootstrap/providers.ts:
 *   import { cache } from '@boostkit/cache'
 *   import configs from '../config/index.js'
 *   export default [..., cache(configs.cache), ...]
 */
export function cache(config: CacheConfig): new (app: Application) => ServiceProvider {
  class CacheServiceProvider extends ServiceProvider {
    register(): void {}

    async boot(): Promise<void> {
      const storeName   = config.default
      const storeConfig = config.stores[storeName] ?? { driver: 'memory' }
      const driver      = storeConfig['driver'] as string

      let adapter: CacheAdapter

      if (driver === 'memory') {
        adapter = new MemoryAdapter()
      } else if (driver === 'redis') {
        adapter = new RedisAdapter(storeConfig as RedisCacheConfig)
      } else {
        throw new Error(`[BoostKit Cache] Unknown driver "${driver}". Available: memory, redis`)
      }

      CacheRegistry.set(adapter)
      this.app.instance('cache', adapter)

      console.log(`[CacheServiceProvider] booted — driver: ${driver}`)
    }
  }

  return CacheServiceProvider
}
