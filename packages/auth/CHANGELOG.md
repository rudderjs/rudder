# @rudderjs/auth

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/view@0.0.3
  - @rudderjs/core@0.0.12
  - @rudderjs/hash@0.0.5
  - @rudderjs/session@0.0.9

## 2.0.0

### Patch Changes

- 6fb47b4: `registerAuthRoutes()` now names its routes: `login`, `register`, `password.forgot`, `password.reset`. This enables callers to check `Route.has('login')` (Laravel's `Route::has()` idiom) — useful for rendering nav links conditionally based on whether the auth package registered its routes.
- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11
  - @rudderjs/hash@0.0.4
  - @rudderjs/session@0.0.8

## 1.0.0

### Patch Changes

- 9fa37c7: `registerAuthRoutes()` now names its routes: `login`, `register`, `password.forgot`, `password.reset`. This enables callers to check `Route.has('login')` (Laravel's `Route::has()` idiom) — useful for rendering nav links conditionally based on whether the auth package registered its routes.
- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10
  - @rudderjs/hash@0.0.3
  - @rudderjs/session@0.0.7

## 0.2.1

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
  - @rudderjs/hash@0.0.2
  - @rudderjs/router@0.0.4
  - @rudderjs/session@0.0.6
  - @rudderjs/view@0.0.2

## 0.1.0

### Minor Changes

- Rename `betterAuth()` to `auth()` (old name kept as deprecated alias). Simplify `BetterAuthConfig` — remove `database` and `databaseProvider` fields. The provider now auto-discovers the PrismaClient from the DI container (registered by `prismaProvider`) or creates its own from the optional `dbConfig` second argument. Add optional deps for Prisma adapters.

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.5

## 0.0.2

### Patch Changes

- Updated dependencies
  - @rudderjs/contracts@0.0.2
  - @rudderjs/core@0.0.4
  - @rudderjs/router@0.0.3
