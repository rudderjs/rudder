# @rudderjs/mcp

## 5.0.1

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.
- Updated dependencies [95e9f4a]
- Updated dependencies [0f69018]
- Updated dependencies [b506997]
  - @rudderjs/console@1.0.1
  - @rudderjs/core@1.1.3
  - @rudderjs/router@1.2.0

## 5.0.0

### Patch Changes

- Updated dependencies [1d81533]
  - @rudderjs/console@1.0.0
  - @rudderjs/core@1.0.1

## 4.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0
  - @rudderjs/router@1.0.0

## 3.1.1

### Patch Changes

- Updated dependencies [8411cd5]
  - @rudderjs/console@0.0.4
  - @rudderjs/core@0.1.4

## 3.1.0

### Minor Changes

- ad6bb9d: Close the three remaining `@rudderjs/mcp` gaps:

  - **Expanded Zod-to-JSON-Schema coverage** — nested `object`, `union`,
    `literal`, `nullable`, `date`, `record`, and `tuple` now convert to proper
    JSON Schema instead of silently falling through to `{ type: "string" }`.
    Both Zod v3 and v4 internal representations are supported.

  - **Streaming tool responses (progress notifications)** — tool `handle()`
    may now be an `async function*` that yields `McpToolProgress`
    (`{ progress, total?, message? }`) updates and returns the final
    `McpToolResult`. The runtime forwards yields as `notifications/progress`
    when the caller supplied a `progressToken`, and drops them silently
    otherwise. Mirrors the `@rudderjs/ai` streaming-tool shape — no `send`
    callback parameter.

  - **Server-initiated notifications** — `McpServer` instances now expose
    `notifyResourceUpdated(uri)`, `notifyResourceListChanged()`,
    `notifyToolListChanged()`, `notifyPromptListChanged()`, and a
    `notify(method, params?)` escape hatch. The runtime attaches each active
    SDK session to its parent `McpServer` so a single notify call fans out to
    every connected client. HTTP transport detaches on session close.

  `McpTestClient.callTool(name, input, onProgress?)` accepts an optional
  progress collector for testing streaming tools without spinning up a
  transport.

### Patch Changes

- Updated dependencies [f0b3bae]
  - @rudderjs/core@0.1.2
  - @rudderjs/router@0.3.1

## 3.0.1

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 3.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/core@0.0.12

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
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
  - @rudderjs/core@0.0.9
  - @rudderjs/router@0.0.4
  - @rudderjs/rudder@0.0.3
