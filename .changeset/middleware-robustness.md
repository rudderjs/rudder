---
"@rudderjs/middleware": patch
---

Robustness fixes for `ThrottleMiddleware` and `Pipeline`.

- **`ThrottleMiddleware` no longer leaks memory.** Its in-memory `hits` map only ever overwrote a record when the *same* key returned, so a one-shot key (IP churn, NAT pools, or a spoofed `X-Forwarded-For` under `trustProxy`) lingered for the life of the process — unbounded growth toward memory exhaustion. It now opportunistically prunes expired records (at most once per window, or immediately past a `maxKeys` ceiling). The cache-backed `RateLimit` was never affected (the cache driver TTL-evicts).
- **`Pipeline.run` now throws on a double `next()`.** A middleware that called `next()` more than once (a forgotten `return`, or `next()` in both a `try` and a `catch`) silently advanced the chain again and re-ran downstream middleware and the destination — a side-effecting destination (DB write, mail, payment) would fire twice. It now throws `next() called multiple times`, matching Koa/Express.
