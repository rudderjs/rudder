---
'@rudderjs/middleware': patch
---

fix(middleware): atomic counter on `RateLimit` (close concurrent-bypass)

Replaces the `cache.get → modify → cache.set` cycle in `makeRateLimitHandler` with `cache.increment(key, 1, windowSec)`. Closes a high-severity race documented in the 2026-05-21 security review: two concurrent requests against `RateLimit.perMinute(5)` on `/auth/sign-in` could both observe `count = N`, both write `N + 1`, so the effective ceiling doubled (or worse with M parallel attackers). The header `X-RateLimit-Remaining` reflected the bumped count but the gate had already let both through.

The fix needs `@rudderjs/cache` ≥ the matching `feat(cache): atomic increment` release. Window expiry is now tracked in a sibling `:exp` meta key so `X-RateLimit-Reset` continues to report the same moment for every request in the window.

Regression: new test fires 50 concurrent calls against `RateLimit.perMinute(5)` with a shared IP and asserts exactly 5 pass + 45 return 429. Previously the count drifted non-deterministically based on cache backend timing.
