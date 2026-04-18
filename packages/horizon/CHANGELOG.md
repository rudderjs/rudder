# @rudderjs/horizon

## 3.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0
  - @rudderjs/middleware@0.0.12
  - @rudderjs/queue@3.0.0

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/queue@2.0.1
  - @rudderjs/core@0.0.12
  - @rudderjs/middleware@0.0.11

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11
  - @rudderjs/queue@2.0.0
  - @rudderjs/middleware@0.0.10

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10
  - @rudderjs/queue@1.0.0
  - @rudderjs/middleware@0.0.9

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
  - @rudderjs/middleware@0.0.8
  - @rudderjs/queue@0.0.6
  - @rudderjs/router@0.0.4
