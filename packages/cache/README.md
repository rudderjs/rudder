# @rudderjs/cache

Cache facade, registry, and provider factory with built-in memory and Redis drivers.

## Installation

```bash
pnpm add @rudderjs/cache
```

## Setup

```ts
// bootstrap/providers.ts
import { cache } from '@rudderjs/cache'
import configs from '../config/index.js'
export default [cache(configs.cache)]
```

## Cache Facade

```ts
import { Cache } from '@rudderjs/cache'

await Cache.set('key', 'value', 300)        // store with 60s TTL
await Cache.set('key', 'value')             // store forever
const val = await Cache.get<string>('key')  // null on miss/expiry
await Cache.has('key')                      // boolean
await Cache.forget('key')                   // remove one key
await Cache.flush()                         // remove all keys

// compute + store if missing (with TTL)
const user = await Cache.remember('user:1', 60, () => User.find('1'))

// compute + store if missing (no TTL)
const cfg = await Cache.rememberForever('config', () => loadConfig())

// get + remove in one call
const token = await Cache.pull('one-time-token')
```

## `Cache` Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `get<T>(key)` | `Promise<T \| null>` | Retrieve a value. `null` on miss or expiry. |
| `set(key, value, ttl?)` | `Promise<void>` | Store a value. Omit `ttl` to store indefinitely. |
| `has(key)` | `Promise<boolean>` | Check existence (respects TTL). |
| `forget(key)` | `Promise<void>` | Remove a single key. |
| `flush()` | `Promise<void>` | Remove all entries. |
| `remember<T>(key, ttl, fn)` | `Promise<T>` | Return cached value or compute, store with TTL, and return. |
| `rememberForever<T>(key, fn)` | `Promise<T>` | Return cached value or compute, store without TTL, and return. |
| `pull<T>(key)` | `Promise<T \| null>` | Get and immediately remove. `null` if missing. |

## Configuration

```ts
// config/cache.ts
export default {
  default: 'memory',
  stores: {
    memory: { driver: 'memory' },
    redis:  { driver: 'redis', host: '127.0.0.1', port: 6379, prefix: 'app:' },
  },
} satisfies CacheConfig
```

## Notes

- Built-in drivers: `memory` (in-process, dev-friendly) and `redis` (requires `pnpm add ioredis`).
- `MemoryAdapter` is exported for standalone use without the provider.
- TTL values are always in **seconds**.
