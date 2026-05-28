---
'@rudderjs/testing': minor
'@rudderjs/server-hono': minor
---

Laravel-parity session / view / validation assertions on `TestResponse`, plus a test-mode side channel to deliver the data:

- **`assertSessionHas(key, value?)`**, **`assertSessionMissing(key)`**, **`assertSessionHasErrors(keys)`** — assert on the resolved session payload of a `web`-group route (where `sessionMiddleware` is auto-installed). `assertSessionHasErrors` reads the `errors` flash bag (the `withErrors($validator)` shape).
- **`assertViewIs(id)`**, **`assertViewHas(key, value?)`** — assert on the rendered view id / props when the controller returned `view('id', props)` from `@rudderjs/view`. Fails with a clear message when the route returned JSON or a raw `Response`.
- **`assertValid()`**, **`assertInvalid(keys?)`** — combined JSON-body + session-flash check, so the same assertion covers both API (422 + `body.errors`) and web (redirect + flashed `errors`) flows.
- **`assertJsonValidationErrors(keys)`** — JSON-only variant for callers that want to be explicit.

All assertions return `this` for chaining.

Internally, `@rudderjs/server-hono` now emits two response headers — `x-rudderjs-test-session` and `x-rudderjs-test-view` (base64-encoded JSON) — only when `globalThis['__rudderjs_test_mode__']` is set. `TestCase._bootstrap()` flips the flag on creation and clears it in `teardown()`, so production traffic never sees the headers. The session payload is duck-typed (`.all()` / `.allFlash()`) so server-hono stays decoupled from `@rudderjs/session` and `@rudderjs/view`.

Found by the Phase 3 testing-ergonomics audit (cluster 5b — the session/view/validation slice that #749 deferred to a follow-up because it needed cross-package coordination).
