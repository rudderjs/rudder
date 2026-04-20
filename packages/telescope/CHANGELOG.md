# @rudderjs/telescope

## 5.0.0

### Patch Changes

- Updated dependencies [e720923]
- Updated dependencies [d3d175c]
  - @rudderjs/core@0.1.1
  - @rudderjs/auth@3.1.0
  - @rudderjs/ai@0.0.7
  - @rudderjs/broadcast@0.0.7
  - @rudderjs/cache@0.0.12
  - @rudderjs/live@0.0.7
  - @rudderjs/log@0.0.7
  - @rudderjs/mail@0.0.11
  - @rudderjs/mcp@3.0.1
  - @rudderjs/notification@0.0.12
  - @rudderjs/queue@3.0.1
  - @rudderjs/schedule@0.0.12
  - @rudderjs/middleware@0.0.13

## 4.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0
  - @rudderjs/auth@3.0.0
  - @rudderjs/middleware@0.0.12
  - @rudderjs/orm@0.1.1
  - @rudderjs/mcp@3.0.0
  - @rudderjs/queue@3.0.0
  - @rudderjs/ai@0.0.6
  - @rudderjs/broadcast@0.0.6
  - @rudderjs/cache@0.0.11
  - @rudderjs/live@0.0.6
  - @rudderjs/log@0.0.6
  - @rudderjs/mail@0.0.10
  - @rudderjs/notification@0.0.11
  - @rudderjs/schedule@0.0.11

## 3.0.0

### Patch Changes

- 8b0400f: Add `ModelRegistry.all()`, `.register()`, and `.onRegister()` so framework components can discover registered Model classes.

  Models are auto-registered on first `query()` or `find()`/`all()`/`first()`/`where()`/`count()`/`paginate()` call. Use `ModelRegistry.register(MyModel)` in a service provider to register eagerly before the first request hits.

  Telescope's model collector now subscribes via `onRegister()` so it also picks up models that appear after its own boot.

- Updated dependencies [8b0400f]
  - @rudderjs/orm@0.1.0
  - @rudderjs/notification@0.0.10

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/queue@2.0.1
  - @rudderjs/auth@2.0.1
  - @rudderjs/core@0.0.12
  - @rudderjs/mcp@2.0.1
  - @rudderjs/ai@0.0.5
  - @rudderjs/broadcast@0.0.5
  - @rudderjs/cache@0.0.10
  - @rudderjs/live@0.0.5
  - @rudderjs/log@0.0.5
  - @rudderjs/mail@0.0.9
  - @rudderjs/notification@0.0.9
  - @rudderjs/schedule@0.0.10
  - @rudderjs/middleware@0.0.11

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
- Updated dependencies [6fb47b4]
  - @rudderjs/auth@2.0.0
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11
  - @rudderjs/mcp@2.0.0
  - @rudderjs/queue@2.0.0
  - @rudderjs/ai@0.0.4
  - @rudderjs/broadcast@0.0.4
  - @rudderjs/cache@0.0.9
  - @rudderjs/live@0.0.4
  - @rudderjs/log@0.0.4
  - @rudderjs/mail@0.0.8
  - @rudderjs/notification@0.0.8
  - @rudderjs/schedule@0.0.9
  - @rudderjs/middleware@0.0.10

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
- Updated dependencies [9fa37c7]
  - @rudderjs/auth@1.0.0
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10
  - @rudderjs/mcp@1.0.0
  - @rudderjs/queue@1.0.0
  - @rudderjs/ai@0.0.3
  - @rudderjs/broadcast@0.0.3
  - @rudderjs/cache@0.0.8
  - @rudderjs/live@0.0.3
  - @rudderjs/log@0.0.3
  - @rudderjs/mail@0.0.7
  - @rudderjs/notification@0.0.7
  - @rudderjs/schedule@0.0.8
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
  - @rudderjs/ai@0.0.2
  - @rudderjs/auth@0.2.1
  - @rudderjs/broadcast@0.0.2
  - @rudderjs/cache@0.0.7
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
  - @rudderjs/http@0.0.2
  - @rudderjs/live@0.0.2
  - @rudderjs/log@0.0.2
  - @rudderjs/mail@0.0.6
  - @rudderjs/mcp@0.0.2
  - @rudderjs/middleware@0.0.8
  - @rudderjs/notification@0.0.6
  - @rudderjs/orm@0.0.7
  - @rudderjs/queue@0.0.6
  - @rudderjs/router@0.0.4
  - @rudderjs/rudder@0.0.3
  - @rudderjs/schedule@0.0.7
