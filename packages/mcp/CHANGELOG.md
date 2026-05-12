# @rudderjs/mcp

## 5.1.1

### Patch Changes

- d0db9f0: **`@rudderjs/boost`** — overhauled the generated agent guidelines output.

  Inspired by Laravel Boost's recent shape. Concrete changes:

  - **`CLAUDE.md` is now ~135 lines, down from ~1,350.** Replaced the inline content dump of every package guideline with structured pointers to `.ai/guidelines/<package>.md`. The full per-package content still lives in `.ai/guidelines/` — agents load it on demand.
  - **New structure** in `CLAUDE.md`: XML wrapper (`<rudderjs-boost-guidelines>`), `=== foundation rules ===` / `=== boost rules ===` / `=== skills activation ===` dividers, a Foundational Context section listing installed `@rudderjs/*` versions, a Boost MCP Tools section listing every exposed tool, and a Skills Activation section with explicit `**ACTIVATE when:** …` / `**SKIP when:** …` heuristics per skill.
  - **Skill frontmatter enriched.** Each `SKILL.md` now declares `license`, `appliesTo`, `metadata.author`, plus the new `trigger` and `skip` fields that drive the CLAUDE.md activation section. `appliesTo` is the new filter — skills install only when at least one of their target packages is present (override with `--include-all-skills`).
  - **Three skills modularized** into `SKILL.md` + `rules/*.md`:
    - `orm-models` (`@rudderjs/orm`) — split into 5 rule files (defining-models, querying, crud-and-observers, factories, resources).
    - `auth-setup` (`@rudderjs/auth`) — split into 5 rule files (provider-setup, guards-and-handlers, auth-views, gates-and-policies, email-and-password-reset).
    - `mcp-servers` (`@rudderjs/mcp`) — split into 5 rule files (tools, resources-and-prompts, server-assembly, transports, testing-and-di).
    - Each `SKILL.md` is now a compact Quick Reference (~40 lines) linking to the matching rule file. Rule files use paired Incorrect/Correct examples consistently.
  - **`boost.json`** now records the active skill list under a `skills` field.

  Migration: run `pnpm rudder boost:update` (or `boost:install`) to regenerate the new CLAUDE.md / boost.json / skill files. The old output is fully replaced — local edits to `CLAUDE.md` will be overwritten, same as before. Per-package guidelines and skills install paths are unchanged.

  No API breaks. The `@rudderjs/*` package bumps are guideline / skill content changes for packages that ship `boost/` directories.

## 5.1.0

### Minor Changes

- 1f40635: Add MCP protocol-spec annotations and conditional registration:

  - **Tool annotations** — `@IsReadOnly` / `@IsDestructive` / `@IsIdempotent` / `@IsOpenWorld` class decorators surface as `annotations` on `tools/list`. Clients (Claude Desktop, Cursor, etc.) use these hints to decide auto-approval, batching, and sandboxing. Each accepts an explicit value (`@IsReadOnly()` = true, `@IsReadOnly(false)` = false, omitted = absent).
  - **Resource annotations** — `@Audience('user' | 'assistant')`, `@Priority(0..1)`, `@LastModified(string | Date)` surface on `resources/list` and `resources/templates/list`.
  - **`shouldRegister()` hook** on `McpTool` / `McpResource` / `McpPrompt`. Returning `false` hides the primitive from list endpoints AND blocks calls — preventing bypass. Async hooks supported. Use for static gating (env flags, feature toggles, build mode).
  - **`McpTestClient.listTools()` / `.listResources()`** now return `annotations` when set and apply `shouldRegister` filtering, so tests reflect production behavior.

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
