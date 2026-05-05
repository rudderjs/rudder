# @rudderjs/cache

Cache facade, registry, and provider factory with built-in memory and Redis drivers.

## Installation

```bash
pnpm add @rudderjs/cache
```

## Setup

```ts
// bootstrap/providers.ts
import { CacheProvider } from '@rudderjs/cache'
export default [CacheProvider]
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

## Atomic Locks

Cross-process coordination via `Cache.lock(name, seconds)` — Laravel-style
distributed locks built on top of the configured cache driver. Backed by
`SET NX EX` + Lua compare-and-delete on Redis; segregated `__lock__:` prefix
on the in-process memory driver.

```ts
import { Cache } from '@rudderjs/cache'

// Try-acquire (non-blocking). Returns true on success.
const lock = Cache.lock('process-podcast:42', 120)
if (await lock.get()) {
  try   { await processPodcast(42) }
  finally { await lock.release() }
}

// Auto-release callback form — preferred.
await Cache.lock('process-podcast:42', 120).get(async () => {
  await processPodcast(42)
})

// Block (wait) up to N seconds for the lock to free.
await Cache.lock('process-podcast:42', 120).block(10, async () => {
  await processPodcast(42)
})
// Throws LockTimeoutError if not acquired within 10s. Polls at ~250ms.
```

### Cross-process release

`release()` is owner-checked: only the holder can release the lock. Capture
the owner token before serialising into a job payload, then restore it on
the worker:

```ts
const lock  = Cache.lock('process-podcast:42', 120)
await lock.get()
const owner = lock.owner()             // 128-bit hex token

// Later, in another process / worker:
await Cache.restoreLock('process-podcast:42', owner).release()
// No-op if the lock TTL'd out and someone else acquired in between.
```

`forceRelease()` bypasses the owner check — use sparingly to clear stuck
locks (e.g. operator tooling for orphaned holders).

### Caveats

- **`MemoryAdapter` locks are single-process.** Across `pm2 cluster`,
  multiple containers, or multiple `tsx` invocations each process holds
  its own Map, so workers will both think they own the lock. Use the
  `redis` driver for real cross-process coordination.
- **No fairness / queue-of-waiters.** `block()` polls every 250ms — under
  contention, acquisition order is roughly first-come but not strict FIFO.
- **No reentrancy.** Calling `lock.get()` twice from the same instance
  returns `false` the second time (the lock is held — by you).
- **No auto-extend / heartbeat.** Pick a TTL longer than the worst-case
  callback. If the holder crashes mid-execution, the lock auto-releases
  when the TTL elapses.
- **Cluster-mode Redis.** Single-Redis `SET NX EX` is the documented
  pattern (matches Laravel). For Redis Cluster, pin lock keys to one slot
  via `{tag}` syntax in the lock name.

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
