---
"@rudderjs/crypt": patch
"@rudderjs/auth": patch
"@rudderjs/cache": patch
"@rudderjs/session": patch
"@rudderjs/middleware": patch
---

Tier 2 quality sweep — error guards, timing safety, lock parity, CORS fix.

- **crypt**: `decrypt()` / `decryptString()` now throw descriptive errors on malformed base64 or non-JSON input instead of an opaque `SyntaxError`
- **auth**: `handleEmailVerification()` uses `timingSafeEqual` for email hash comparison; `PasswordResetConfig` gains an optional `secret` field so stored token hashes can be bound to APP_KEY
- **cache**: `RedisAdapter.get()` catches corrupt JSON entries, evicts them, and returns `null`; `MemoryLock.acquire()` returns `false` for zero-TTL (matches `RedisLock` behaviour)
- **session**: `verify()` replaces manual XOR loop with `crypto.timingSafeEqual`
- **middleware**: `CorsMiddleware` reflects the matched request origin from an allowlist instead of joining all origins with `', '` (browsers require a single origin value — the old behaviour was silently broken)
