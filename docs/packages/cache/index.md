# @rudderjs/cache

Cache facade, registry, and provider factory with in-memory built-in driver.

## Installation

```bash
pnpm add @rudderjs/cache
```

## Setup

### 1. Configure cache

```ts
// config/cache.ts
import type { CacheConfig } from '@rudderjs/cache'

export default {
  default: Env.get('CACHE_DRIVER', 'memory'),
  stores: {
    memory: {
      driver: 'memory',
    },
  },
} satisfies CacheConfig
```

### 2. Register the provider

```ts
// bootstrap/providers.ts
import { cache } from '@rudderjs/cache'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,
  cache(configs.cache),
  AppServiceProvider,
]
```

## Cache Facade

Import `Cache` and call methods directly — it operates on the configured `default` store.

```ts
import { Cache } from '@rudderjs/cache'

// Store a value
await Cache.set('key', 'value')

// Store with TTL (seconds)
await Cache.set('key', 'value', 300)

// Retrieve a value
const value = await Cache.get<string>('key')

// Check existence
const exists = await Cache.has('key')

// Remove a value
await Cache.forget('key')

// Remember pattern — fetch from cache or compute and store
const user = await Cache.remember('user:1', 60, async () => {
  return await User.find('1')
})

// Clear all entries in the store
await Cache.flush()
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `get<T>(key)` | `Promise<T \| null>` | Retrieve a value. Returns `null` if not found or expired. |
| `set(key, value, ttl?)` | `Promise<void>` | Store a value. Omit `ttl` to store indefinitely. |
| `has(key)` | `Promise<boolean>` | Check whether a key exists and has not expired. |
| `forget(key)` | `Promise<void>` | Remove a single key. |
| `flush()` | `Promise<void>` | Clear all entries in the store. |
| `remember<T>(key, ttl, fn)` | `Promise<T>` | Return cached value or compute, store with TTL, and return. |
| `rememberForever<T>(key, fn)` | `Promise<T>` | Return cached value or compute, store without TTL, and return. |
| `pull<T>(key)` | `Promise<T \| null>` | Get and immediately remove the value. `null` if missing. |

```ts
// remember — fetch from cache or compute and store with TTL
const user = await Cache.remember('user:1', 60, async () => {
  return await User.find('1')
})

// rememberForever — compute once, cache indefinitely
const config = await Cache.rememberForever('app:config', async () => {
  return await loadConfig()
})

// pull — one-time use values
const token = await Cache.pull<string>('one-time-token')
if (token) await processToken(token)
```

## Configuration

### `CacheConfig`

```ts
interface CacheConfig {
  default: string
  stores: Record<string, CacheStoreConfig>
}
```

| Field     | Type                              | Description                          |
|-----------|-----------------------------------|--------------------------------------|
| `default` | `string`                          | Name of the default store to use.    |
| `stores`  | `Record<string, CacheStoreConfig>` | Named store configurations.         |

### `CacheStoreConfig`

Each store entry must include a `driver` field. Additional fields depend on the driver.

```ts
// Memory store
{
  driver: 'memory'
}

// Redis store (requires ioredis: pnpm add ioredis)
{
  driver: 'redis',
  host: 'localhost',
  port: 6379,
}
```

## `cache(config)`

`cache(config)` returns a RudderJS `ServiceProvider` class that registers the configured stores and binds the `Cache` facade during `boot()`.

```ts
import { cache } from '@rudderjs/cache'

// In bootstrap/providers.ts
cache(configs.cache)
```

## Built-in Drivers

### `memory`

The default built-in driver. Stores values in an in-process `Map`. Data does not persist across restarts.

```ts
{
  driver: 'memory'
}
```

## Redis Driver

For Redis-backed caching, install `ioredis` and set `driver: 'redis'`. See the [Redis driver docs](./redis).

## Notes

- TTL values are always in **seconds**.
- The `memory` driver stores data in an in-process `Map` — data is lost on process restart and is not shared across multiple server instances.
- `MemoryAdapter` is exported and can be used standalone without the provider.
- For Redis-backed caching, install `ioredis` (`pnpm add ioredis`) and set `driver: 'redis'`. See the [Redis driver docs](./redis).
