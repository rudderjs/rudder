# @rudderjs/log

## 1.0.5

### Patch Changes

- 69ad453: Route 5 cross-bundle singletons through `globalThis` so duplicate bundles of these packages share state. Defensive sweep of the same "module-scoped state ≠ bundle-split-survival" pattern that produced #498 / #500–#506 (static-state registries) and #507 (router) and #514 (mcp metadata symbols).

  | Singleton       | Package              | Global key                        | Risk if unfixed                                                                                                                             |
  | --------------- | -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | `container`     | `@rudderjs/core`     | `__rudderjs_core_container__`     | Defensive — only `Application` imports today, but a direct cross-bundle import would split                                                  |
  | `dispatcher`    | `@rudderjs/core`     | `__rudderjs_core_dispatcher__`    | Multiple packages re-export `dispatch()` — events fired from one bundle don't reach listeners in another                                    |
  | `schedule`      | `@rudderjs/schedule` | `__rudderjs_schedule_singleton__` | User registers tasks in `routes/console.ts`; cron runner + telescope's ScheduleCollector read from a different bundle's Scheduler → no jobs |
  | `customDrivers` | `@rudderjs/log`      | `__rudderjs_log_custom_drivers__` | Public `extendLog('sentry', ...)` API — write to one bundle's Map, read from another → "Unknown driver" on every channel                    |
  | `_chainStates`  | `@rudderjs/queue`    | `__rudderjs_queue_chain_states__` | Chain.dispatch() stamps state on each job; worker reads via `getChainState(this)` — split = state silently lost                             |

  No public API change. Same shape as `groupMiddlewareStore` (long-standing globalThis precedent in `@rudderjs/core`).

  Out-of-scope: `queue/_locks` (documented process-local fallback — "use cache for production"), `server-hono/perf-boundaries` (single-module scope, no cross-bundle access).

- Updated dependencies [69ad453]
  - @rudderjs/core@1.1.7

## 1.0.4

### Patch Changes

- 765a19d: Route `LogRegistry`'s channels/defaultName/shared-context/event-listeners through `globalThis` so the registry survives the case where `@rudderjs/log` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/log` inline (`Log.info` / `Log.error` resolve `LogRegistry.default()`) but `LogProvider.boot()` runs from a `node_modules` copy resolved via the provider auto-discovery manifest. Without a shared store, channels registered from the externalized copy would never be visible to `Log.*` calls reading the bundled copy and every log call would throw `[RudderJS Log] Channel "console" is not registered`. The shared-context surface (`shareContext`, `flushSharedContext`) and the event-listener subscription used by Telescope's log collector would silently drop writes the same way.

  No public API change — same `register` / `channel` / `default` / `setDefault` / `getDefault` / `shareContext` / `sharedContext` / `flushSharedContext` / `listen` / `listeners` / `forgetChannel` / `getChannels` / `reset` surface. Defensive migration per the #499 static-state singleton audit. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`), #500 (pennant), #501 (cache), #502 (queue), #503 (mail), #504 (storage), #505 (hash).

## 1.0.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5

## 1.0.2

### Patch Changes

- 704ae11: fix(storage,http,broadcast,log): Tier 4 quality sweep — S3 CopySource encoding, HTTP json() guard, WebSocket send guard, broadcast auth error surface, log cleanup error surface
- Updated dependencies [0f69018]
  - @rudderjs/core@1.1.3

## 1.0.1

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [4c8cd07]
  - @rudderjs/core@1.1.2

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

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0

## 0.0.7

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.6

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/core@0.1.0

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
  - @rudderjs/core@0.0.9
