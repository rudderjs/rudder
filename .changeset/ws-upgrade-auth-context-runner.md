---
"@rudderjs/contracts": minor
"@rudderjs/core": minor
"@rudderjs/session": minor
"@rudderjs/auth": minor
---

feat(core): run session/auth context around WebSocket-upgrade `onAuth`

A sync `onAuth(req, docName)` callback runs on every WS upgrade (since `@rudderjs/sync` 1.5.x) but receives only raw headers + url — no `AsyncLocalStorage` context — so the idiomatic resolver `() => Auth.user()` returned `null` (the HTTP auth middleware never ran on the upgrade path), forcing apps to hand-roll cookie→session→user parsing to authorize a collab room by user identity.

`@rudderjs/core` now registers a **WS-upgrade context runner** on `globalThis['__rudderjs_ws_context_runner__']` during `_createHandler()` (dev + prod). It synthesizes a minimal `AppRequest` from the Node upgrade request and runs the `web` group's request-context middleware around the `onAuth` decision — so `Auth.user()` / `Session.*` resolve on an upgrade exactly as in an HTTP handler, with no app-side cookie parsing.

The runner executes **only** the middleware that establish request-scoped context — `sessionMiddleware` and `AuthMiddleware` now tag their returned function with the new `REQUEST_CONTEXT` marker (exported from `@rudderjs/contracts`) — not the whole `web` group, so CSRF / rate-limit / arbitrary app middleware don't mis-fire on an upgrade (a rate-limiter would otherwise consume a token per upgrade). Apps that write their own ALS-establishing middleware can opt in by setting the same marker.

This is the framework half; `@rudderjs/sync` routes `onAuth` through the runner (fail-closed) in a follow-up. Standalone sync with no server adapter registers no runner and keeps today's behavior — `onAuth` runs raw — so the change is backward compatible.
