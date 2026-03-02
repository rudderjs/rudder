import { Redis } from 'ioredis'
import type { CacheAdapter, CacheAdapterProvider } from '@forge/cache'

// ─── Config ────────────────────────────────────────────────

export interface RedisCacheConfig {
  driver:    'redis'
  host?:     string
  port?:     number
  password?: string
  db?:       number
  url?:      string     // redis://... overrides host/port/password
  prefix?:   string     // key prefix, e.g. 'myapp:'
}

// ─── Redis Adapter ─────────────────────────────────────────

class RedisAdapter implements CacheAdapter {
  private readonly client: Redis
  private readonly prefix: string

  constructor(config: RedisCacheConfig) {
    this.prefix = config.prefix ?? ''
    this.client = config.url
      ? new Redis(config.url)
      : new Redis({
          host:     config.host     ?? '127.0.0.1',
          port:     config.port     ?? 6379,
          password: config.password,
          db:       config.db       ?? 0,
        })
  }

  private key(k: string): string { return `${this.prefix}${k}` }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.key(key))
    if (raw === null) return null
    return JSON.parse(raw) as T
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialised = JSON.stringify(value)
    if (ttlSeconds) {
      await this.client.set(this.key(key), serialised, 'EX', ttlSeconds)
    } else {
      await this.client.set(this.key(key), serialised)
    }
  }

  async forget(key: string): Promise<void> {
    await this.client.del(this.key(key))
  }

  async has(key: string): Promise<boolean> {
    return (await this.client.exists(this.key(key))) === 1
  }

  async flush(): Promise<void> {
    if (this.prefix) {
      // Only flush keys matching our prefix
      const keys = await this.client.keys(`${this.prefix}*`)
      if (keys.length) await this.client.del(...keys)
    } else {
      await this.client.flushdb()
    }
  }

  /** Expose the raw ioredis client for advanced usage. */
  raw(): Redis { return this.client }
}

// ─── Factory ───────────────────────────────────────────────

/**
 * Named export used by @forge/cache's dynamic import:
 *   const { redis } = await import('@forge/cache-redis')
 */
export function redis(config: RedisCacheConfig): CacheAdapterProvider {
  return {
    create(): CacheAdapter {
      return new RedisAdapter(config)
    },
  }
}
