# @rudderjs/auth

Authentication system — guards, policies, gates, password reset, and auth views.

Key exports: `AuthManager`, `AuthMiddleware`, `RequireAuth`, `AuthProvider`, `Gate`, `Policy`, `SessionGuard`.

## Architecture Rules

- **AuthManager is a DI singleton** — must NOT cache `SessionGuard` instances (the `_guards` Map was removed to fix ghost user leaks across requests)
- **`AuthMiddleware` auto-installs on the `web` route group** via `appendToGroup('web', AuthMiddleware())` in `AuthProvider.boot()`. Do NOT add it via `m.use(AuthMiddleware())` — that reintroduces the global-install problem (api routes would crash on missing session).
- **`SessionGuard.user()` soft-fails** on missing ALS context — returns `null` instead of throwing. This matches Laravel's `Auth::user()` semantics and makes the guard safe to reference from api handlers (where it will return `null` unless a bearer guard ran first).
- **API auth** is explicit per-route: `RequireBearer()` + `scope(...)` (passport) or `RequireAuth('api')` with a token guard. `AuthMiddleware` never runs on api routes.
- **Views**: ships `views/react/` and `views/vue/` — apps vendor them into `app/Views/Auth/`
- **Route registration**: `registerAuthRoutes(router, opts)` pattern — not file-based routing
- Requires `@rudderjs/session` and `@rudderjs/hash` as peer dependencies
