# @rudderjs/mcp

## 6.2.1

### Patch Changes

- a1d2c80: Converge the tool/prompt zod→JSON-Schema converter onto the shared `@rudderjs/json-schema` package. `zodToJsonSchema()` is now a thin shim over `convertSchema(schema, 'input')` (Zod 4 native `z.toJSONSchema`, the same converter `@rudderjs/ai` and `@rudderjs/openapi` use) instead of a hand-rolled walker. MCP tool/prompt parameters are request inputs, so they convert with `io: 'input'`.

  The internal `zod` dependency moves to `^4.0.0` (the MCP SDK accepts `^3.25 || ^4.0`, and MCP only uses zod to _produce_ JSON Schema — it never `.parse()`s at runtime, so the bump is runtime-safe). The shared converter is Zod-4-native, so MCP tools should be authored with Zod 4 schemas; a Zod 3 schema degrades to an open `{ type: 'object' }`.

  The emitted JSON Schema is now Zod-native and more complete/correct: unions emit `anyOf` (was `oneOf`), literals emit `{ type, const }`, nullable emits an `anyOf` with a `null` branch (was `type: [t, 'null']`), tuples emit `prefixItems`. One honest downgrade: `z.date()` is unrepresentable in JSON Schema and now emits an open `{}` schema (the hand-rolled converter guessed `string` + `date-time`).

- Updated dependencies [085869e]
- Updated dependencies [e8bd81f]
- Updated dependencies [4e6c67d]
- Updated dependencies [7c79edc]
- Updated dependencies [5c80378]
  - @rudderjs/json-schema@1.1.0
  - @rudderjs/core@1.11.0
  - @rudderjs/router@1.9.0

## 6.2.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/console@1.4.0
  - @rudderjs/core@1.7.0
  - @rudderjs/router@1.8.0

## 6.1.2

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/console@1.2.1
  - @rudderjs/core@1.5.1
  - @rudderjs/router@1.7.1

## 6.1.1

### Patch Changes

- 746caca: Harden two CodeQL-flagged patterns in shipped source:

  - `@rudderjs/support` — `Str.snake()` / `Str.headline()` previously detected the acronym→word boundary with `([A-Z]+)([A-Z][a-z])`, whose greedy `[A-Z]+` overlaps the following `[A-Z]` (a polynomial-ReDoS on long all-caps input). Rewritten to a fixed-width lookbehind `(?<=[A-Z])([A-Z][a-z])` — output is byte-identical for every case, no ambiguous quantifier.
  - `@rudderjs/mcp` — the OAuth2 `WWW-Authenticate` challenge escaped `"` in `error_description` but not `\`, so a description ending in a backslash could escape the closing quote and break out of the RFC 7235 quoted-string. Now escapes `\` before `"`.

## 6.1.0

### Minor Changes

- a3a7368: Phase 3 of `rudder doctor` — first wave of package-contributed checks.

  Thirteen framework packages now ship a `<package>/doctor` subpath whose
  side-effect import registers domain-specific health checks on the shared
  doctor registry. The CLI's lazy loader auto-imports them when
  `rudder doctor` runs.

  New checks (14 total, grouped by category):

  - **auth** — `auth:secret` (AUTH_SECRET set + length sane), `auth:views-vendored`
    (vendored when a frontend renderer is installed).
  - **auth** (cont.) — `session:secret` (SESSION_SECRET length when set), `hash:driver`
    (config string ∈ {bcrypt, argon2}; flags missing `argon2` peer).
  - **orm** — `orm-prisma:schema` (schema files present), `orm-prisma:client-generated`
    (mtime check vs schema), `orm-prisma:database-url`, `orm-drizzle:schema`,
    `orm-drizzle:database-url`.
  - **billing** — `cashier-paddle:api-key`, `cashier-paddle:webhook-secret`
    (both conditional on a cashier route being mounted).
  - **queue** — `queue-bullmq:redis-url`, `queue-inngest:event-key`,
    `queue-inngest:signing-key`.
  - **ai** — `ai:provider-keys` (greps `config/ai.ts` for declared driver
    literals, then checks each cloud provider's API key env var).
  - **mcp** — `mcp:route-mounted` (if `app/Mcp/` has tools, mcp route is
    registered).
  - **monitoring** — `telescope:dashboard`, `pulse:dashboard`,
    `horizon:dashboard` (dashboard route reachable from `routes/web.ts`).

  Adding a new contributing package: ship a `<package>/doctor` subpath with
  side-effect `registerDoctorCheck` calls and append the package name to
  `PACKAGES_WITH_CHECKS` in `@rudderjs/cli/src/doctor/load-package-checks.ts`.

  Implementation notes:

  - The CLI's loader resolves doctor subpaths via direct path
    (`<cwd>/node_modules/<pkg>/dist/doctor.js`), not `createRequire.resolve`,
    because the `./doctor` exports condition is `import`-only (no `require`)
    and the strict-mode pnpm node_modules don't expose user-installed
    packages from the CLI's location. Documented as the ESM-only-peer
    resolution workaround.
  - `deps:auth-views` was removed from the CLI's built-in checks — the
    identical concern now lives at `auth:views-vendored` in
    `@rudderjs/auth/doctor`, where it belongs. Net check count for a user
    with `@rudderjs/auth` installed: same (one each); for a user without
    auth, doctor stays silent on the topic instead of saying "auth not
    installed — skip".

  No tests added in this phase — each check is small enough to be tested
  implicitly via integration smoke (the existing temp-dir test suite in
  `@rudderjs/cli`, plus a manual smoke against `playground/`). Per-package
  test suites for these checks may land in a follow-up.

  Phase 4 (`--deep`) and Phase 5 (`--fix`) follow in subsequent releases.

### Patch Changes

- Updated dependencies [b28e51f]
  - @rudderjs/console@1.1.0

## 6.0.2

### Patch Changes

- 6f594ca: Route all decorator metadata keys (`@Name`, `@Version`, `@Instructions`, `@Description`, `@Handle`, `@IsReadOnly`, `@IsDestructive`, `@IsIdempotent`, `@IsOpenWorld`, `@Audience`, `@Priority`, `@LastModified`) through `Symbol.for(...)` instead of `Symbol(...)` so the metadata key has a single process-global identity regardless of how many bundled copies of `decorators.ts` exist.

  A bundled app's `entry.mjs` typically inlines the decorator module (the `@Handle` / `@Description` decorators run at module-load time when the user's tool class is defined), while the MCP runtime that later reads the metadata is resolved through `await import('@rudderjs/mcp/...')` → node_modules → a **second** copy of `decorators.ts` with a separate `Symbol(...)` identity. Write under one symbol, read from the other, `Reflect.getMetadata` returns `undefined`. Every `@Handle(...)`-injected dependency silently dropped → `greeter is undefined` style errors in production.

  This is the same class of bug fixed in `@rudderjs/router` (#507) and the static-state-singleton audit (#498 / #500–#506). `Symbol.for(...)` shares the global symbol registry so the symbol identity survives bundle splits.

  No public API change. Verified end-to-end on the playground prod-bundle: the `EchoTool.handle(input, greeter: GreetingService)` DI injection now resolves correctly through both the proxy intercept and a direct MCP SDK client call.

- Updated dependencies [69ad453]
  - @rudderjs/core@1.1.7

## 6.0.1

### Patch Changes

- 765a19d: Route `Mcp`'s web/local server maps through `globalThis` so the registry survives the case where `@rudderjs/mcp` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/mcp` inline (the route mounter reads `Mcp.getWebServers()`) but `Mcp.web()` / `Mcp.local()` calls in `routes/console.ts` and `app/Mcp/*` can run from a `node_modules` copy resolved via the provider auto-discovery manifest. Without a shared store, servers registered from the externalized copy would never be visible to the bundled copy's mounter — every `/mcp/*` request would 404 and stdio MCP commands wouldn't show up.

  No public API change — same `web` / `local` / `getWebServers` / `getLocalServers` surface. Defensive migration per the #499 static-state singleton audit (the `__rudderjs_mcp_observers__` registry was already migrated; this completes the package). Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).

## 6.0.0

### Major Changes

- 1f0e22e: **Breaking:** `createSdkServer`, `startStdio`, `mountHttpTransport`, and `HttpTransportOptions` are no longer re-exported from the main `@rudderjs/mcp` entry point. They now live at the `@rudderjs/mcp/runtime` subpath. Update any direct imports:

  ```ts
  // Before
  import {
    createSdkServer,
    startStdio,
    mountHttpTransport,
  } from "@rudderjs/mcp";

  // After
  import {
    createSdkServer,
    startStdio,
    mountHttpTransport,
  } from "@rudderjs/mcp/runtime";
  ```

  These primitives are described in the boost guidelines as "rarely needed in app code" — `McpProvider`, `Mcp.web()`, and `Mcp.local()` cover normal usage and remain on the main entry. The split keeps `@modelcontextprotocol/sdk` out of the import graph when an app declares `@rudderjs/mcp` but hasn't registered any servers, so cold-boot is unaffected by the SDK in that case. `McpTestClient` and the provider boot path were also updated to import from the cheap sibling modules instead of going through the runtime barrel.

### Patch Changes

- Updated dependencies [7d7a4ab]
  - @rudderjs/router@1.3.0
  - @rudderjs/core@1.1.6

## 5.1.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/console@1.0.2
  - @rudderjs/core@1.1.5
  - @rudderjs/router@1.2.1

## 5.1.2

### Patch Changes

- 5f38ac6: `mcp:inspector` now correctly consumes streaming tools (`async *handle()`). Previously, calling a streaming tool through the inspector returned an empty `{}` because `tool.handle()` was JSON-serialized as the iterator object instead of being drained. The inspector now runs the same `consumeToolReturn` path as the SDK and test client — progress yields are dropped (the inspector is a synchronous UI), and the final result is returned.

  Also deduplicates the URI-template matcher between the SDK runtime and inspector (previously two near-identical copies in `runtime.ts` and `commands/inspector.ts`) by extracting it to `src/uri-template.ts`.

- fa8cc27: `prompts/get` responses now emit structured content objects (`{ type: 'text', text: string }`) on the wire, matching the MCP spec's `PromptMessageSchema`. Previously the SDK handler forwarded `McpPromptMessage.content` as a raw string, which the MCP TypeScript SDK rejected with a Zod validation error on the client side. Prompts authored against the framework's `McpPrompt` interface are unaffected — the adapter only transforms on the way out, so user code still returns `{ role, content: string }`.

  Surfaced while writing end-to-end SDK-handler tests (mcp-quality-audit PR C).

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
