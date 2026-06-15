---
"@rudderjs/cache": patch
---

Harden the cache integrity backbone against counter poisoning, a lock-wait hang, and default-driver memory exhaustion.

- **`block(seconds)` no longer hangs forever on a non-finite wait budget.** A `NaN`/`Infinity` `seconds` made the poll deadline `NaN`, and `Date.now() >= NaN` is always false, so a contended `Cache.lock(...).block(NaN)` spun forever (never acquiring, never timing out) - an unbounded hang. `block()` now throws `RangeError` on a non-finite or negative wait budget.
- **`increment(key, by)` rejects a non-integer `by` on every driver.** A `NaN`/`Infinity`/float `by` silently corrupted the in-memory counter (`+ NaN` poisons it permanently, which then compares `false` against any limit and quietly disables a rate limiter) while a real Redis would reject the same input - a test-passes / prod-differs split. All three drivers (memory, redis, fake) now throw `TypeError` on a non-integer `by`. Negative integers stay allowed (decrement).
- **The default in-memory driver is hard-bounded.** Expired entries were only swept lazily on read, so a write-only flood of distinct keys (IP-keyed rate-limit counters under a rotating-source attack is the canonical case) grew the heap without bound toward OOM. `MemoryAdapter` now caps at `maxEntries` (default 100,000, configurable per store), evicting expired entries first then oldest-inserted.
- **A missing default store warns instead of degrading silently.** When `config.cache.default` names a store absent from `config.cache.stores`, the boot still falls back to the in-process memory driver but now logs a warning - an undefined store in production silently made locks and rate-limit counters per-process (each cluster worker got its own bucket, multiplying an attacker's allowance).
