---
'@rudderjs/cache': minor
---

feat(cache): atomic `increment()` on the `CacheAdapter` contract

Adds `increment(key, by?, ttlSeconds?): Promise<number>` to `CacheAdapter` and the `Cache` facade. Returns the new value. When the key is missing it is created with the given TTL; subsequent increments preserve the original expiry (the TTL is NOT refreshed) — matches Laravel `Cache::increment` and Redis `INCRBY` + first-write `EXPIRE` semantics.

**Why:** the prior `get → modify → set` pattern in `@rudderjs/middleware`'s `RateLimit` allowed concurrent requests to silently undercount — both reading `count = N`, both writing `N + 1`, doubling (or worse) the effective limit. The atomic primitive lives on the adapter so any rate-limit / counter use case shares the race-free implementation.

**Implementations**

- `MemoryAdapter`: single-threaded in-process atomic via `Map.get` + `Map.set`.
- `RedisAdapter`: Lua `EVAL` of `INCRBY` plus `EXPIRE` only when `TTL == -1` (no TTL set), so window boundaries don't slide across requests.
- `FakeCacheAdapter`: mirrors `MemoryAdapter` + records an `'increment'` operation for assertions.

**Breaking for third-party `CacheAdapter` implementations** — the new method is required on the interface. Adapters that miss it get a TS error at compile time and a runtime `cache.increment is not a function` if called. All in-tree adapters ship the method. Marked as a minor bump because no third-party adapters exist in the wild today.
