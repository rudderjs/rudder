---
"@rudderjs/contracts": minor
"@rudderjs/core": minor
"@rudderjs/session": minor
"@rudderjs/auth": minor
---

feat(core): WebSocket-upgrade context runner so `Auth.user()` / `Session.*` resolve inside out-of-band callbacks

A WebSocket upgrade never flows through the HTTP request pipeline, so the session and auth `AsyncLocalStorage` scopes an HTTP handler relies on were never established. `@rudderjs/sync`'s `onAuth(req, docName)` (added in #1011) therefore ran with no ALS — `Auth.user()` returned `null` and apps had to hand-roll cookie → session → user parsing to authorize a collab room by identity.

`@rudderjs/core` now registers a context runner on `globalThis['__rudderjs_ws_context_runner__']` at `.create()` (dev and prod). Given a raw Node `IncomingMessage` it synthesizes a minimal `AppRequest`, builds a throwaway `AppResponse` (its `Set-Cookie` sink is discarded — there is no HTTP response on an upgrade), and runs **only** the request-scoped-context middleware from the `web` group — session + auth today — onion-style with the caller's callback as the terminal `next`. CSRF, rate-limit, and arbitrary app middleware are deliberately skipped (they assume a full HTTP request and would, e.g., consume a rate-limit token per upgrade).

Selection is by a new marker: `REQUEST_CONTEXT` (`Symbol.for('rudderjs.requestContext')`, exported from `@rudderjs/contracts` and re-exported from `@rudderjs/core`). `@rudderjs/session`'s `sessionMiddleware` and `@rudderjs/auth`'s `AuthMiddleware` tag the function they return; apps that write their own ALS-establishing middleware can opt in the same way.

No behavior change on the HTTP path. The runner is consumed by `@rudderjs/sync` in a follow-up; standalone sync (no server adapter, no runner registered) is unaffected.
