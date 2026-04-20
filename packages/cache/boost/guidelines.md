# @rudderjs/cache

## Overview

Cache facade with memory + Redis drivers. Provides `Cache` facade (`get`, `set`, `has`, `forget`, `flush`, `remember`, `rememberForever`, `pull`), named stores (multiple cache backends in one app), and `CacheRegistry` for adapter lookup. Required by `@rudderjs/middleware`'s `RateLimit` and `ThrottleMiddleware` — register cache before middleware.

## Key Patterns

### Setup

```ts
// config/cache.ts
export default {
  default: 'memory',
  stores: {
    memory: { driver: 'memory' },
    redis:  { driver: 'redis', host: '127.0.0.1', port: 6379, prefix: 'app:' },
  },
} satisfies CacheConfig

// bootstrap/providers.ts — register BEFORE middleware that uses cache (RateLimit, ThrottleMiddleware)
import { cache } from '@rudderjs/cache'
export default [cache(configs.cache), ...]
```

### Facade

```ts
import { Cache } from '@rudderjs/cache'

// Basic
await Cache.set('key', 'value', 300)          // TTL in seconds — 5 minutes
await Cache.set('key', 'value')                // no TTL — forever
const val = await Cache.get<string>('key')     // null on miss/expiry
await Cache.has('key')
await Cache.forget('key')
await Cache.flush()                            // wipe all

// Compute + store if missing
const user = await Cache.remember('user:1', 60, () => User.find('1'))
const cfg  = await Cache.rememberForever('config', () => loadConfig())

// Get + delete atomically (one-time tokens, etc.)
const token = await Cache.pull('one-time-token')
```

**TTL is always seconds** — not milliseconds. `Cache.set('x', v, 300)` = 5 minutes.

### Named stores

```ts
await Cache.store('redis').set('session:123', data, 3600)
await Cache.store('memory').forget('dev-only-key')
```

The default store is whatever `default` resolves to in config. `Cache.set(...)` = `Cache.store(default).set(...)`.

### Standalone adapter (testing, scripts)

```ts
import { MemoryAdapter } from '@rudderjs/cache'

const cache = new MemoryAdapter()
await cache.set('key', 'value', 60)
```

## Common Pitfalls

- **Memory driver and distributed deployments.** The `memory` driver is in-process only. Multiple Node processes don't share cache state. Use Redis for production multi-instance setups.
- **Redis driver without `ioredis`.** Lazy-loaded at first call. Install: `pnpm add ioredis`.
- **TTL units.** Always seconds. Writing `Cache.set('x', v, 5000)` stores for 83 minutes, not 5 seconds. Common bug source.
- **Cache order vs middleware order.** `RateLimit` and `ThrottleMiddleware` look up the cache adapter at middleware-run time. If `cache()` provider is after the middleware-using provider in `bootstrap/providers.ts`, you get silent "fails open" (middleware allows all requests). Register `cache()` first.
- **Serialization.** Values are JSON-stringified on write and parsed on read. Non-JSON-serializable values (functions, class instances with methods, symbols) don't round-trip. Store plain data.
- **`remember()` races.** Between "check cache" and "store computed value," two concurrent requests can both execute the factory. Safe for idempotent factories; use a lock (or a cache-busting store) for non-idempotent ones.

## Key Imports

```ts
// Provider + facade
import { cache, Cache } from '@rudderjs/cache'

// Standalone adapter
import { MemoryAdapter } from '@rudderjs/cache'

// Registry (framework-level)
import { CacheRegistry } from '@rudderjs/cache'

// Types
import type { CacheConfig, CacheAdapter, CacheStoreConfig } from '@rudderjs/cache'
```
