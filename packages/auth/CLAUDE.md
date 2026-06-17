# @rudderjs/auth

Authentication system — guards, policies, gates, password reset, and auth views.

Key exports: `AuthManager`, `AuthMiddleware`, `RequireAuth`, `AuthProvider`, `Gate`, `Policy`, `SessionGuard`.

## Architecture Rules

- **AuthManager is a DI singleton** — must NOT cache `SessionGuard` instances (the `_guards` Map was removed to fix ghost user leaks across requests)
- **`AuthMiddleware` auto-installs on the `web` route group** via `appendToGroup('web', AuthMiddleware())` in `AuthProvider.boot()`. Do NOT add it via `m.use(AuthMiddleware())` — that reintroduces the global-install problem (api routes would crash on missing session).
- **Auth lifecycle events** (`src/events.ts`): `Attempting`, `Validated`, `Login`, `Failed`, `Logout` are dispatched from `SessionGuard` via core's global `dispatch()`; `Registered` from `BaseAuthController.signUp`; `PasswordReset` from `PasswordBroker.reset()`. Routed by class name through `@rudderjs/core`'s dispatcher — no DI threading; dispatch is a no-op with no listeners. Mirrors Laravel's `Illuminate\Auth\Events\*`. Don't rename the classes (the dispatcher keys on `constructor.name`).
- **`SessionGuard.user()` soft-fails** on missing ALS context — returns `null` instead of throwing. This matches Laravel's `Auth::user()` semantics and makes the guard safe to reference from api handlers (where it will return `null` unless a bearer guard ran first).
- **API auth** is explicit per-route: `RequireBearer()` + `scope(...)` (passport) or `RequireAuth('api')` with a token guard. `AuthMiddleware` never runs on api routes.
- **Views**: ships `views/react/` and `views/vue/` — apps vendor them into `app/Views/Auth/`
- **Route registration**: `registerAuthRoutes(router, opts)` pattern — not file-based routing
- Requires `@rudderjs/session` and `@rudderjs/hash` as peer dependencies

## Doctor checks

Ships `src/doctor.ts` (loaded by `@rudderjs/cli`'s doctor command via the `./doctor` subpath):
- `auth:secret` — `AUTH_SECRET` set + ≥ 32 chars
- `auth:views-vendored` — `app/Views/Auth/` populated when a vike-* renderer is installed (has a fixer that copies `views/<fw>/` → `app/Views/Auth/`, never overwrites existing files)
