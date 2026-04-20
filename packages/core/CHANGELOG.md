# @rudderjs/core

## 0.1.1

### Patch Changes

- e720923: Move the provider group-middleware store from module scope to `globalThis`.

  `appendToGroup()` and `resetGroupMiddleware()` in `@rudderjs/core` used to
  persist middleware in a module-level `const` — which silently broke any time
  the consumer app loaded two `@rudderjs/core` instances (e.g. pnpm-linked
  workspace package + installed npm copy of any framework package). Each core
  instance had its own private store: provider `boot()` wrote to store A, the
  server read store B, middleware silently vanished. The user-visible symptom
  was `No auth context. Use AuthMiddleware.` when linking a workspace auth
  package into a consumer app that had the rest of `@rudderjs/*` from npm.

  The store is now pinned on `globalThis.__rudderjs_group_middleware__` so
  every `@rudderjs/core` instance shares one object — same pattern the
  `ai/mcp/http/gate/live` observer registries already use. Zero API change.
  Added three tests covering the new invariant + existing reset semantics.

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

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/router@0.3.0

## 0.0.12

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1

## 0.0.11

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0

## 0.0.10

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0

## 0.0.9

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/contracts@0.0.4
  - @rudderjs/router@0.0.4
  - @rudderjs/rudder@0.0.3
  - @rudderjs/support@0.0.4

## 0.0.6

### Patch Changes

- Update @rudderjs/rudder dependency to 0.0.2 which exports Rudder and CancelledError.

## 0.0.5

### Patch Changes

- Updated dependencies
  - @rudderjs/rudder@0.0.2

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/support@0.0.3
  - @rudderjs/contracts@0.0.2
  - @rudderjs/router@0.0.3
