---
"@rudderjs/router": minor
---

Add `router.fallback()` catch-all route. Fix locale-sensitive param sort in `_computeSignature` (use byte-order comparison for deterministic cross-locale signatures). Fix `timingSafeEqual` to check buffer lengths before calling (avoids throw/catch timing side-channel on malformed-length signatures). Document `router.resource()`, `router.bind()`, and `router.fallback()` in boost guidelines.
