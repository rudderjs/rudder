---
"@rudderjs/sync": minor
---

feat(sync): run `onAuth` inside the framework's WS-upgrade context runner

`onAuth` (enforced on every WS upgrade since #1011) ran with no request-scoped context, so the idiomatic resolver `() => Auth.user()` returned `null` — apps had to hand-roll cookie → session → user parsing to authorize a collab room by identity.

`handleConnection` now routes `onAuth` through `globalThis['__rudderjs_ws_context_runner__']` when the framework registered it (`@rudderjs/core` ≥ this release, at app boot). The runner establishes the same session + auth `AsyncLocalStorage` scopes an HTTP request gets, so `Auth.user()` / `Session.*` resolve inside `onAuth` exactly as in a controller — no app-side parsing, no new `@rudderjs/sync` dependency (just a `globalThis` read).

Backward compatible: standalone sync (no server adapter → no runner registered) keeps calling `onAuth` raw. Fail-closed is preserved end to end — a runner error, a context-middleware throw, or an `onAuth` rejection all deny and close the socket with WS code 4401.
