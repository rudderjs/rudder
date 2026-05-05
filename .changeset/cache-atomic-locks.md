---
'@rudderjs/cache': minor
'@rudderjs/queue': patch
'@rudderjs/schedule': patch
---

Add atomic `Cache.lock()` API + refactor `WithoutOverlapping` and `schedule.withoutOverlapping()`/`onOneServer()` to use it (Laravel parity #1).

**`@rudderjs/cache` (minor — additive):**

- `Cache.lock(name, seconds)` — non-blocking try-acquire returning a `Lock` with `get()` / `get(callback)` / `block(seconds, callback?)` / `release()` / `forceRelease()` / `owner()`.
- `Cache.restoreLock(name, owner)` — rebuild a lock handle by owner token for cross-process release (capture `lock.owner()` on the dispatcher, release on the worker).
- Driver implementations: in-process `MemoryLock` (single-process only — documented caveat) and `RedisLock` (atomic `SET NX EX` acquire + Lua compare-and-delete release).
- Owner-checked release: `lock.release()` returns `false` if the holder doesn't match (no more "release-someone-else's-lock" race when TTLs collide); `forceRelease()` bypasses the check for orphan recovery.
- `block(seconds)` waits with ~250ms polling and throws `LockTimeoutError` on timeout.
- `FakeCacheAdapter` records `lock-acquire` / `lock-release` / `lock-force-release` ops with `assertLockAcquired(name)` / `assertLockReleased(name)`.

**`@rudderjs/queue` (patch — internal refactor):**

- `WithoutOverlapping` now uses `Cache.lock()` instead of a check-then-set against the regular cache. Closes a race where two workers could both observe `null`, both write the lock, and both proceed; closes a "release-someone-else's-lock" bug when the holder's TTL elapsed mid-execution.
- `WithoutOverlapping` now requires `@rudderjs/cache` to be installed and registered — overlap protection without a cache adapter is silently broken under contention, so it fails fast with a clear error rather than running unprotected.
- Adds `@rudderjs/cache` as an optional peer dependency.

**`@rudderjs/schedule` (patch — internal refactor):**

- `schedule.withoutOverlapping()` and `schedule.onOneServer()` now use `Cache.lock()`. Closes the same race for cross-server coordination — across N app boxes ticking the same minute, exactly one will acquire the `onOneServer` lock.
- Adds `@rudderjs/cache` as an optional peer dependency.

No public API changes for queue/schedule consumers.
