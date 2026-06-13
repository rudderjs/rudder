---
"@rudderjs/middleware": patch
---

`ThrottleMiddleware` now warns once when `req.ip` is undefined instead of silently bucketing every client under one `'unknown'` key. Previously, behind a reverse proxy without `TRUST_PROXY=true`, all requests shared a single throttle counter (one client could lock out the whole site) with no indication of the misconfiguration. It now reuses the same `clientIp()` helper as `RateLimit`, which emits a one-time warning pointing at `TRUST_PROXY`. Keying behavior is otherwise unchanged.
