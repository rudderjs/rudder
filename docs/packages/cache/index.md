# @boostkit/cache

Cache facade, registry, and provider factory with in-memory built-in driver.

## Installation

```bash
pnpm add @boostkit/cache
```

## Setup

### 1. Configure cache

```ts
// config/cache.ts
import type { CacheConfig } from '@boostkit/cache'

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
import { cache } from '@boostkit/cache'
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
import { Cache } from '@boostkit/cache'

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

| Method                                  | Returns          | Description                                                                 |
|-----------------------------------------|------------------|-----------------------------------------------------------------------------|
| `get<T>(key)`                           | `Promise<T \| null>` | Retrieve a value by key. Returns `null` if not found or expired.        |
| `set(key, value, ttlSeconds?)`          | `Promise<void>`  | Store a value. Omit `ttlSeconds` to store indefinitely.                     |
| `has(key)`                              | `Promise<boolean>` | Check whether a key exists and has not expired.                           |
| `forget(key)`                           | `Promise<void>`  | Remove a single key from the store.                                         |
| `remember<T>(key, ttl, fn)`            | `Promise<T>`     | Return the cached value if present; otherwise call `fn`, store, and return. |
| `flush()`                               | `Promise<void>`  | Clear all entries in the current store.                                     |

### Using a Named Store

```ts
import { Cache } from '@boostkit/cache'

const redisCache = Cache.disk('redis')
await redisCache.set('session:abc', data, 3600)
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

`cache(config)` returns a BoostKit `ServiceProvider` class that registers the configured stores and binds the `Cache` facade during `boot()`.

```ts
import { cache } from '@boostkit/cache'

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

- The `Cache` facade always operates on the `default` store unless you call `Cache.disk(name)` to select a named store.
- TTL values are in **seconds**.
- The `memory` driver stores data in an in-process `Map` — data is lost on process restart and is not shared across multiple server instances.
