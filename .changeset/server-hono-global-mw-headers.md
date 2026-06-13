---
"@rudderjs/server-hono": patch
---

Fix two response-header bugs in the Hono adapter's `normalizeResponse` merge path:

- A global middleware (registered via `m.use(...)`) that set a response header or cookie through the `res.header()` wrapper and then called `next()` had it silently dropped — `applyMiddleware` never merged the wrapper's pending headers into the finalized response. Group- and route-level middleware were unaffected. So e.g. a globally-installed `RateLimit` would lose its `X-RateLimit-*` headers.
- A cookie set via `res.header()` on the `res.json()` / `send()` path was emitted twice (once staged onto the Hono context by `applyHeaders`, once re-appended by the route handler's `mergeInto`), producing a duplicate `Set-Cookie`.

Both are fixed by a single `flushed` guard so pending headers are applied exactly once, plus `applyMiddleware` now applies its own wrapper's pending merge on the pass-through path. The cooperative multi-cookie pattern (CsrfMiddleware + SessionMiddleware appending directly to `c.res.headers`) is unchanged.
