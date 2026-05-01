# @rudderjs/pulse

## 6.0.0

### Major Changes

- e344d67: **Breaking:** rename `*Aggregator` classes to `*Recorder` to align with Laravel Pulse's vocabulary — recorders listen to events and call `Pulse::record()`; "aggregation" is the storage-side bucketing strategy, not a class-naming concept. The runtime behavior is unchanged.

  Renames:

  - `RequestAggregator` → `RequestRecorder`
  - `QueueAggregator` → `QueueRecorder`
  - `CacheAggregator` → `CacheRecorder`
  - `ExceptionAggregator` → `ExceptionRecorder`
  - `UserAggregator` → `UserRecorder`
  - `QueryAggregator` → `QueryRecorder`
  - `ServerAggregator` → `ServerRecorder`
  - `Aggregator` interface → `Recorder`
  - `src/aggregators/` directory → `src/recorders/`

  Bundled with this rename: migrate the UI to the canonical package-UI shape (`views/vanilla/` + `registerPulseRoutes()`), matching `@rudderjs/auth`, `@rudderjs/telescope`, and `@rudderjs/horizon`. The Dashboard moves from `src/ui/{dashboard,layout}.ts` to `src/views/vanilla/{Dashboard,Layout}.ts`, with the `html\`\``auto-escape helper available in`\_html.ts`. Route registration is centralised in a new `src/routes.ts`exporting`registerPulseRoutes(storage, opts)`; the API handler functions stay in `api/routes.ts` as pure functions. Public functional API (`PulseProvider`, `Pulse` facade, configuration) is unchanged apart from the class renames above.

  **Migration:** find / replace `*Aggregator` → `*Recorder` and `import type { Aggregator }` → `import type { Recorder }` in any code that imports recorder classes by name from `@rudderjs/pulse`. Most apps don't reference these directly — the provider instantiates them — so the change is invisible. Apps that imported from the deep `@rudderjs/pulse/aggregators/*` paths will need to update those (the `aggregators/` directory no longer exists).

## 5.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/cache@1.0.0
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/log@1.0.0
  - @rudderjs/middleware@1.0.0
  - @rudderjs/orm@1.0.0
  - @rudderjs/router@1.0.0
  - @rudderjs/queue@4.0.0

## 4.0.3

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/orm@0.1.2
  - @rudderjs/middleware@0.0.14
  - @rudderjs/router@0.3.1

## 4.0.2

### Patch Changes

- Updated dependencies [5ca3e29]
  - @rudderjs/queue@3.0.2

## 4.0.1

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1
  - @rudderjs/cache@0.0.12
  - @rudderjs/log@0.0.7
  - @rudderjs/queue@3.0.1
  - @rudderjs/middleware@0.0.13

## 4.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0
  - @rudderjs/middleware@0.0.12
  - @rudderjs/orm@0.1.1
  - @rudderjs/queue@3.0.0
  - @rudderjs/cache@0.0.11
  - @rudderjs/log@0.0.6

## 3.0.0

### Patch Changes

- Updated dependencies [8b0400f]
  - @rudderjs/orm@0.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/queue@2.0.1
  - @rudderjs/core@0.0.12
  - @rudderjs/cache@0.0.10
  - @rudderjs/log@0.0.5
  - @rudderjs/middleware@0.0.11

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11
  - @rudderjs/queue@2.0.0
  - @rudderjs/cache@0.0.9
  - @rudderjs/log@0.0.4
  - @rudderjs/middleware@0.0.10

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10
  - @rudderjs/queue@1.0.0
  - @rudderjs/cache@0.0.8
  - @rudderjs/log@0.0.3
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
  - @rudderjs/cache@0.0.7
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
  - @rudderjs/log@0.0.2
  - @rudderjs/middleware@0.0.8
  - @rudderjs/orm@0.0.7
  - @rudderjs/queue@0.0.6
  - @rudderjs/router@0.0.4
