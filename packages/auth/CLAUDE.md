# @rudderjs/auth

Authentication system — guards, policies, gates, password reset, and auth views.

Key exports: `AuthManager`, `AuthMiddleware`, `RequireAuth`, `AuthProvider`, `Gate`, `Policy`, `SessionGuard`.

## Architecture Rules

- **AuthManager is a DI singleton** — must NOT cache `SessionGuard` instances (the `_guards` Map was removed to fix ghost user leaks across requests)
- **Views**: ships `views/react/` and `views/vue/` — apps vendor them into `app/Views/Auth/`
- **Route registration**: `registerAuthRoutes(router, opts)` pattern — not file-based routing
- Requires `@rudderjs/session` and `@rudderjs/hash` as peer dependencies
