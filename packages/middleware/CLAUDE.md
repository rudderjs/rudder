# @rudderjs/middleware

Middleware classes — CORS, logger, throttle, CSRF, and the `Pipeline` executor.

Key exports: `Middleware` base class, `CorsMiddleware`, `LoggerMiddleware`, `ThrottleMiddleware`, `CsrfMiddleware`, `RateLimit` fluent API, `Pipeline`, `getCsrfToken()`.

`RateLimit` requires a cache provider registered before middleware runs (no cache = no throttling). `ThrottleMiddleware` is the simpler in-memory limiter (per-process `Map`, no cache); it opportunistically prunes expired keys so the Map can't grow unbounded. Prefer the cache-backed `RateLimit` in production (it TTL-evicts and works across instances).

`clientIp(req)` reads `req.ip` (set by server-hono's `extractIp()`). Custom `.by()` functions should also use `req.ip`, not raw headers like `x-real-ip`.
