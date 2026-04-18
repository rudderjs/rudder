---
'@rudderjs/contracts': minor
'@rudderjs/router': minor
'@rudderjs/core': minor
'@rudderjs/server-hono': minor
'@rudderjs/auth': minor
'@rudderjs/session': minor
---

Middleware groups — `web` vs `api`, Laravel-style.

Routes loaded via `withRouting({ web })` are tagged `'web'`; via `withRouting({ api })` tagged `'api'`. The server adapter composes the matching group's middleware stack before per-route middleware. Framework packages install into a group during `boot()` via the new `appendToGroup('web' | 'api', handler)` export on `@rudderjs/core`, instead of calling `router.use(...)` globally.

- **`MiddlewareConfigurator`** — adds `.web(...handlers)` and `.api(...handlers)` alongside the existing `.use(...)`. Use `m.use(...)` for truly global middleware (logging, request-id), `m.web(...)` / `m.api(...)` for group-scoped middleware.
- **`@rudderjs/session`** — `sessionMiddleware` now auto-installs on the `web` group. Apps no longer need `m.use(sessionMiddleware(cfg))` in `bootstrap/app.ts`.
- **`@rudderjs/auth`** — `AuthMiddleware` now auto-installs on the `web` group (was a global `router.use()`). `req.user` is populated on web routes only; api routes are stateless by default and must opt into bearer auth (e.g. `RequireBearer()` from `@rudderjs/passport`).
- **`SessionGuard.user()`** — soft-fails when no session ALS is in context (returns `null` instead of throwing). Matches Laravel's `Auth::user()` semantics — removes the trap where api routes would 500 with "No session in context" when auth was installed but session was not.
- **`RouteDefinition.group?: 'web' | 'api'`** — new optional field exposed via `@rudderjs/contracts`. Server adapters may implement `applyGroupMiddleware(group, handler)` to support the feature; adapters without it ignore group tags and behave as before.

**Breaking:** `req.user` is now `undefined` on api routes unless a bearer/token guard middleware runs. This is intentional — the previous behavior (AuthMiddleware running globally) forced session to be load-bearing on every request, including stateless APIs.
