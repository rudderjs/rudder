# @rudderjs/view

## 1.4.0

### Minor Changes

- a51306f: Harden the controller-view SSR runtime against secret leakage and XSS laundering.

  - **`static hidden` is now honored on the `view()` path.** Vike's client-hydration serializer does not call `toJSON()`, so `view('dashboard', { user })` where `user` is an ORM Model serialized EVERY column (including `password` / `rememberToken`) into the browser payload, silently bypassing the Model's `static hidden` allowlist. `view()` now walks props through `toJSON()` before handing them to Vike (new exported `serializeViewProps`), so `hidden`/`visible` are enforced on the SSR path exactly as on the API path. `Date` and `Map`/`Set` (which Vike round-trips specially) are left intact; circular graphs are safe.
  - **`SafeString` can no longer be impersonated to launder unescaped markup.** `renderHtmlValue` gated trusted pass-through on `instanceof SafeString`, which a prototype-spoofed object (`Object.create(SafeString.prototype)`) passes. It now uses a private-field brand (`SafeString.isSafe`), so only genuine instances bypass escaping.
  - **New `safeUrl()` helper for `href`/`src` interpolation.** `escapeHtml` does not validate URL schemes, so an escaped `javascript:alert(1)` still executes on click. `safeUrl()` neutralizes `javascript:` / `data:` / `vbscript:` URLs (including tab/newline and leading-whitespace evasions) to `'#'`. `escapeHtml`'s docs now also spell out that interpolated attributes must be quoted.
  - **View response headers are sanitized before forwarding.** A view-supplied header whose value carries CR/LF/NUL (e.g. a value built from request data) made undici's `Headers` throw deep inside `renderPage()` — a request-triggered 500. Such headers, and headers with invalid names, are now dropped, which also forecloses any response-header-injection vector.

## 1.3.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

## 1.2.3

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

## 1.2.2

### Patch Changes

- 42fab4c: Documents the new `export const prerender = true` opt-in in the README — static build-time prerender for views with no per-request data. The flag lives in the view file; the scanner in `@rudderjs/vite` picks it up. No runtime change in `@rudderjs/view` itself.

## 1.2.1

### Patch Changes

- beea0f9: First-render perf: prewarm `vike/server` during application bootstrap so its ~100 ms module-load cost no longer stalls the first user-visible request. `@rudderjs/view` now exposes `prewarmVikeServer()` (memoized lazy loader); `@rudderjs/server-hono` fires it as a module-load side-effect of its own index module — t≈0 in the cold-boot timeline — so by request-time the import is fully cached. On a fresh-scaffold minimal app, first-render drops from ~182 ms to ~96 ms (−47%); RudderJS now beats Next.js on first-render and lands within 20 ms of Nuxt. Trade-off: cold boot bumps ~86 ms (the load happens during boot now). Net spawn-to-first-content is the same; in production this is a clear win because cold-boot hides behind the load-balancer's health check while users always see the request time. Also adds env-gated `[perf]` request-lifecycle traces in both packages (enabled via `RUDDER_PERF_TRACE=1`; zero overhead when unset).

## 1.2.0

### Minor Changes

- 15925ac: Typed views: `view('id', props)` now type-checks against the receiving component's exported `Props` type. Opt in per view by adding `export interface Props` (or `export type Props`) to the view file — the scanner emits `pages/__view/registry.d.ts` mapping the id to the prop shape, and the controller call site is checked at compile time. Apps that don't adopt the convention keep working unchanged; the loose `view(id, props?)` overload still accepts any record-shaped props. Stubs for React / Solid / Vue `+Page` files use the per-view `Props` type when available so intellisense propagates into the rendered component. Vanilla views are intentionally excluded (their props are typed at the function argument already).

## 1.1.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.1.0

### Minor Changes

- 937cdac: Adopt three Vike framework-author hooks landed in 2025 for unified DX:

  - **`+onCreatePageContext`** — `@rudderjs/vite` now ships a process-wide page-context enhancer registry. Framework packages register a function via `registerPageContextEnhancer(fn)` and it runs on every page render. The first user: `@rudderjs/auth` populates `pageContext.user` automatically — views no longer need a `+data.ts` to read the current user. The augmentation is typed via the `Vike.PageContext` global namespace.

  - **`+onError`** — Vike SSR errors are now routed through `@rudderjs/core`'s `report()` so they hit the same reporter/renderer chain as HTTP route errors. `@rudderjs/core` is an optional peer; the hook falls back to `console.error` when it's not installed.

  - **`+headersResponse`** — `view('id', props, { headers })` is the new third arg. Pass per-page response headers (`Cache-Control`, CSP, etc.) directly from the controller. The headers can be a plain object or a function (`() => Record<string, string>`) for per-request values like CSP nonces. Framework-owned headers (`set-cookie`, `vary`, anything starting with `x-rudderjs-`) are silently dropped to prevent collisions with server-hono's response pipeline.

  ### Mechanism

  The Vike hooks are wired by the `@rudderjs/vite` views scanner — it writes three one-line re-export stubs to `pages/+onCreatePageContext.ts`, `pages/+onError.ts`, and `pages/+headersResponse.ts` on first sync. These files are user-overwritable: re-running the scanner won't clobber edits. (Vike's `Config.extends` mechanism doesn't support scoped packages, so the scanner generates files that Vike picks up via its native page discovery instead.)

  ### Migration

  - Existing apps: run `pnpm dev` or `pnpm build` once. The scanner emits the three hook stubs to `pages/` automatically. Commit them. No code changes required.
  - The `pages/__view/+config.ts` scanner output now also adds `viewHeaders` to `passToClient`, so view components can read response-header context if they need to.
  - `pageContext.user` types automatically when both `@rudderjs/auth` and `@rudderjs/vite` are installed.

  ### Out of scope (deferred follow-ups)

  - `@rudderjs/session` flash enhancer (`pageContext.flash`) — adopt the same `registerPageContextEnhancer` pattern.
  - `@rudderjs/localization` locale enhancer (`pageContext.locale`) — same shape.
  - Typed `+rudderRoute` meta — current `export const route = '/...'` works.
  - `+onHookCall` (beta) telescope integration — wait until telescope's request collector is stable.

  ### No API breaks

  - `view(id, props)` (2-arg) still works; the `options` arg is optional.
  - `req.user` flow on HTTP routes is unchanged.
  - No new required dependencies; `@rudderjs/core` is added as an optional peer of `@rudderjs/vite`, and `@rudderjs/vite` is added as an optional peer of `@rudderjs/auth`.

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

## 1.0.1

### Patch Changes

- 1d4f50b: test: fill coverage gaps

  - `@rudderjs/view`: `view()` with no props defaults to `{}`, `isViewResponse(undefined)` returns `false`, `SafeString.toString()` returns the raw value.
  - `@rudderjs/localization`: `trans()` caching round-trip, `{0}` plural-branch resolution for `count = 0`, simple two-part pluralize fallback.
  - `@rudderjs/concurrency`: `defer()` swallows AND logs errors, `restore()` after `fake()` recreates the worker driver.

  No behavior changes — coverage only.

## 1.0.0

### Major Changes

- cd38418: ## RudderJS 1.0 — wave 1

  Graduate 29 framework packages from `0.x` to `1.0.0`. The first batch of `@rudderjs/*` packages is now public-API stable — breaking changes will require explicit major bumps and migration notes from here on.

  **No code changes** — this is a version-line reset. Existing `0.x` consumers need to update their `@rudderjs/*` ranges from `^0.x.y` to `^1.0.0`. The scaffolder (`create-rudder-app`) is updated to emit `1.x` ranges.

  **Why now.** Under semver caret rules, `^0.X.Y` is exact-minor — every minor bump on a `0.x` peer goes out of range and triggers a cascading major bump on every dependent. Even with the `onlyUpdatePeerDependentsWhenOutOfRange` flag in place, the `0.x` baseline keeps producing spurious cascades. Telescope's v9 is mostly that. Once at `1.0`, `^1.0.0` absorbs all `1.x` minor/patch updates — cascades only fire for actual breaking changes.

  **Cascade noise will drop significantly:**

  - `^1.0.0` absorbs all 1.x minor/patch updates
  - Cascade now only fires for actual breaking changes (real majors)

  **Packages graduating to 1.0.0 in this wave:**

  `@rudderjs/contracts`, `core`, `support`, `log`, `hash`, `crypt`, `context`, `testing`, `middleware`, `cache`, `session`, `broadcast`, `schedule`, `mail`, `notification`, `storage`, `localization`, `pennant`, `socialite`, `queue-bullmq`, `queue-inngest`, `router`, `server-hono`, `view`, `orm`, `orm-prisma`, `passport`, `boost`, `ai`.

  `@rudderjs/ai` was originally on the defer list (recent runtime-agnostic split), but it peer-depends on `@rudderjs/core` — graduating core forces ai to graduate via cascade regardless. Listing it explicitly so the version line is intentional rather than a side-effect.

  **Packages NOT yet graduated (still 0.x), to graduate individually as they stabilize:**

  - _Too new / not yet exercised in the dogfood loop:_ `@rudderjs/concurrency`, `image`, `process`, `http`, `console`
  - _Recent significant changes:_ `@rudderjs/orm-drizzle`, `sync`, `vite`

  These will only patch-bump in this release (cascade via regular `dependencies`, not `peerDependencies`).

  **Already past 1.0 (untouched by this release):** `@rudderjs/auth`, `cli`, `mcp`, `queue`, `horizon`, `pulse`, `sanctum`, `telescope`, `cashier-paddle`. These keep their existing version lines; no reset.

  **Expected cascade:** dependents like `telescope`, `pulse`, `horizon`, `cli`, `auth`, `mcp`, `queue`, `sanctum` will major-bump in this release because their peer/dep ranges shifted from `^0.x` to `^1.0.0`. This is the _last_ spurious cascade — future releases of those packages will patch-bump on in-range peer updates.

## 0.0.3

### Patch Changes

- dc37411: Ship `boost/guidelines.md` in the published npm tarball. Adds `"boost"` to the `files` field so downstream `boost:install` in consumer projects finds the per-package AI coding guidelines.

## 0.0.2

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages
