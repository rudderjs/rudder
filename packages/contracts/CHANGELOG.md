# @rudderjs/contracts

## 0.1.0

### Minor Changes

- ba543c9: Middleware groups — `web` vs `api`, Laravel-style.

  Routes loaded via `withRouting({ web })` are tagged `'web'`; via `withRouting({ api })` tagged `'api'`. The server adapter composes the matching group's middleware stack before per-route middleware. Framework packages install into a group during `boot()` via the new `appendToGroup('web' | 'api', handler)` export on `@rudderjs/core`, instead of calling `router.use(...)` globally.

  - **`MiddlewareConfigurator`** — adds `.web(...handlers)` and `.api(...handlers)` alongside the existing `.use(...)`. Use `m.use(...)` for truly global middleware (logging, request-id), `m.web(...)` / `m.api(...)` for group-scoped middleware.
  - **`@rudderjs/session`** — `sessionMiddleware` now auto-installs on the `web` group. Apps no longer need `m.use(sessionMiddleware(cfg))` in `bootstrap/app.ts`.
  - **`@rudderjs/auth`** — `AuthMiddleware` now auto-installs on the `web` group (was a global `router.use()`). `req.user` is populated on web routes only; api routes are stateless by default and must opt into bearer auth (e.g. `RequireBearer()` from `@rudderjs/passport`).
  - **`SessionGuard.user()`** — soft-fails when no session ALS is in context (returns `null` instead of throwing). Matches Laravel's `Auth::user()` semantics — removes the trap where api routes would 500 with "No session in context" when auth was installed but session was not.
  - **`RouteDefinition.group?: 'web' | 'api'`** — new optional field exposed via `@rudderjs/contracts`. Server adapters may implement `applyGroupMiddleware(group, handler)` to support the feature; adapters without it ignore group tags and behave as before.

  **Breaking:** `req.user` is now `undefined` on api routes unless a bearer/token guard middleware runs. This is intentional — the previous behavior (AuthMiddleware running globally) forced session to be load-bearing on every request, including stateless APIs.

## 0.0.4

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

## 0.0.2

### Patch Changes

- Quality pass: bug fixes, expanded tests, and docs improvements across core packages.

  - `@rudderjs/support`: fix `ConfigRepository.get()` returning fallback for falsy values (`0`, `false`, `''`); add prototype pollution protection to `set()`; fix `Collection.toJSON()` returning `T[]` not a string; fix `Env.getBool()` to be case-insensitive; fix `isObject()` to correctly return `false` for `Date`, `Map`, `RegExp`, etc.
  - `@rudderjs/contracts`: fix `MiddlewareHandler` return type (`void` → `unknown | Promise<unknown>`)
  - `@rudderjs/middleware`: add array constructor to `Pipeline` — `new Pipeline([...handlers])` now works
  - `create-rudder-app`: remove deprecated `.toHandler()` from `RateLimit` in scaffolded templates; remove nonexistent `.withExceptions()` call
