---
'@rudderjs/sanctum': patch
---

Two small correctness fixes in `Sanctum.validateToken` (T3/T6).

- Token expiry comparison is now `<=` instead of `<`. A token whose `expiresAt` equals the current millisecond is no longer accepted — both technically correct (the millisecond it expires it's no longer valid) and a fix for flaky millisecond-boundary tests.
- Bearer prefix matching is case-insensitive per RFC 6750 §2.1. `bearer foo`, `BEARER foo`, and `Bearer foo` are all accepted; some HTTP libraries lowercase header values and the previous strict-case match rejected them.
