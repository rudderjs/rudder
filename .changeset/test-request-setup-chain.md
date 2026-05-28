---
'@rudderjs/testing': minor
---

Add fluent request-setup chain to `TestCase` for attaching headers and cookies to subsequent requests, matching Laravel's `withHeaders` / `withCookies` ergonomics:

- **`withHeader(name, value)`** / **`withHeaders(obj)`** — accumulate headers applied to every subsequent request until cleared.
- **`withCookie(name, value)`** / **`withCookies(obj)`** — accumulate cookies serialized into a single URI-encoded `Cookie` header.
- **`flushHeaders()`** / **`flushCookies()`** — clear accumulated state mid-test (also cleared automatically by `teardown()`).

The per-request `headers` argument continues to win over the accumulated set, so individual tests can override the test-wide defaults without disturbing them. All methods return `this` for chaining.

Found by the Phase 3 testing-ergonomics audit (cluster 4 of 4).
