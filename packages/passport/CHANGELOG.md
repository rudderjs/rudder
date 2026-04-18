# @rudderjs/passport

## 0.1.0

### Minor Changes

- 8ab284a: Passport Phase 6 — customization hooks.

  - `Passport.useClientModel()` / `useTokenModel()` / `useRefreshTokenModel()` / `useAuthCodeModel()` / `useDeviceCodeModel()` — swap in custom model classes (extend the base models to add columns or methods). Grants, routes, middleware, personal access tokens, and `passport:purge` all resolve models via the new `Passport.*Model()` getters.
  - `Passport.authorizationView(fn)` — render a custom consent screen from `GET /oauth/authorize`. The hook receives `{ client, scopes, redirectUri, state?, codeChallenge?, codeChallengeMethod?, request }` and may return a `view(...)` response or any router-acceptable value. JSON remains the default when unset.
  - `Passport.ignoreRoutes()` — short-circuits `registerPassportRoutes()` for manual wiring.
  - `registerPassportRoutes(router, { except: ['authorize'|'token'|'revoke'|'scopes'|'device'] })` — skip specific route groups.

  The `HasApiTokens` mixin type now accepts abstract base classes (such as `@rudderjs/orm`'s `Model`) and preserves the base's static methods, so `User extends HasApiTokens(Model)` composes cleanly.

### Patch Changes

- Updated dependencies [8b0400f]
  - @rudderjs/orm@0.1.0

## 0.0.5

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.4

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.2

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
  - @rudderjs/core@0.0.9
  - @rudderjs/orm@0.0.7
