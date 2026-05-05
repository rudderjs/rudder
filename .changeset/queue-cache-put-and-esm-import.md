---
'@rudderjs/queue': patch
---

Fix two latent `@rudderjs/cache` integration bugs in the queue middleware and unique-job lock.

- **`RateLimited` and `ThrottlesExceptions` no longer throw on first use.** Both middlewares were calling `cache.put(...)` even though `CacheAdapter` only exposes `set`. The bug was masked before #212 because `_getCache()` used CommonJS `require('@rudderjs/cache')` from inside an ESM module, threw, was swallowed by the `try/catch`, and the middlewares fell through to the "no cache — fail open" path. #212 converted `_getCache()` to `await import(...)`, so a real adapter is now returned and the missing-method `TypeError` surfaces on the first job that hits either middleware. Switched both calls to `cache.set(...)` and tightened the local `CacheLike` interface to match.

- **`acquireUniqueLock` / `releaseUniqueLock` now talk to `@rudderjs/cache`.** Same root cause: `unique.ts` still used CJS `require('@rudderjs/cache')` from ESM, so the cache branch in both helpers was permanently unreachable and `ShouldBeUnique` jobs silently fell through to the in-process `_locks` Map (no cross-process uniqueness). Switched to `await import(...)`, made `_getCache()` async, and updated the two awaited call sites. Also fixed the same `cache.put` → `cache.set` mistake on the unique-key write.

Adds `RateLimited`, `ThrottlesExceptions`, and `acquireUniqueLock`/`releaseUniqueLock` test coverage backed by `FakeCacheAdapter` so any regression on either path now fails CI.
