# @rudderjs/schedule

## 1.1.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/cache@1.4.0
  - @rudderjs/core@1.7.0

## 1.0.7

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/core@1.5.1

## 1.0.6

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

## 1.0.5

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/cache@1.1.4
  - @rudderjs/core@1.1.5

## 1.0.4

### Patch Changes

- 87a8de2: fix(schedule,context,pennant,localization): Tier 5 quality sweep — overlap key collision, hydrate guard, feature resolution race, JSON parse error surface
- Updated dependencies [0f69018]
- Updated dependencies [9b33c2c]
  - @rudderjs/core@1.1.3
  - @rudderjs/cache@1.1.2

## 1.0.3

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [dfba4df]
- Updated dependencies [4c8cd07]
  - @rudderjs/cache@1.1.1
  - @rudderjs/core@1.1.2

## 1.0.2

### Patch Changes

- 8818704: Fix `onOneServer()` so the server-lock TTL — not task duration — controls how long a peer is kept out.

  Previously `_executeTask` pushed every acquired lock onto a single list and released them all in `finally`. The 60-second server lock was released the instant the task callback returned, so a peer with a slightly delayed cron tick (NTP drift, GC pause, slow worker) could re-acquire and re-run the same scheduled minute. This violated the documented contract — "only run on a single server" — for any task whose body finishes faster than the gap between cluster cron ticks (i.e. essentially every task).

  The server lock is now intentionally **not** released by `_executeTask`; its 60-second TTL is what guarantees "exactly one server per scheduled minute". Only the `withoutOverlapping` lock is released after the task completes, since that one's purpose is "release the next invocation as soon as the current one finishes".

  Bonus: when `onOneServer` and `withoutOverlapping` are combined and the overlap lock collides (a previous run is still in progress), the server lock is no longer released either — releasing it would invite a peer to immediately retry the same colliding task within the minute.

  Adds seven `_executeTask` test cases backed by `FakeCacheAdapter` covering: success, task throw, overlap-only, combined, peer-held server lock, no cache adapter, and overlap-collision-keeps-server-lock-held.

- Updated dependencies [158f7ee]
  - @rudderjs/core@1.1.1

## 1.0.1

### Patch Changes

- 0420c1e: Add atomic `Cache.lock()` API + refactor `WithoutOverlapping` and `schedule.withoutOverlapping()`/`onOneServer()` to use it (Laravel parity #1).

  **`@rudderjs/cache` (minor — additive):**

  - `Cache.lock(name, seconds)` — non-blocking try-acquire returning a `Lock` with `get()` / `get(callback)` / `block(seconds, callback?)` / `release()` / `forceRelease()` / `owner()`.
  - `Cache.restoreLock(name, owner)` — rebuild a lock handle by owner token for cross-process release (capture `lock.owner()` on the dispatcher, release on the worker).
  - Driver implementations: in-process `MemoryLock` (single-process only — documented caveat) and `RedisLock` (atomic `SET NX EX` acquire + Lua compare-and-delete release).
  - Owner-checked release: `lock.release()` returns `false` if the holder doesn't match (no more "release-someone-else's-lock" race when TTLs collide); `forceRelease()` bypasses the check for orphan recovery.
  - `block(seconds)` waits with ~250ms polling and throws `LockTimeoutError` on timeout.
  - `FakeCacheAdapter` records `lock-acquire` / `lock-release` / `lock-force-release` ops with `assertLockAcquired(name)` / `assertLockReleased(name)`.

  **`@rudderjs/queue` (patch — internal refactor):**

  - `WithoutOverlapping` now uses `Cache.lock()` instead of a check-then-set against the regular cache. Closes a race where two workers could both observe `null`, both write the lock, and both proceed; closes a "release-someone-else's-lock" bug when the holder's TTL elapsed mid-execution.
  - `WithoutOverlapping` now requires `@rudderjs/cache` to be installed and registered — overlap protection without a cache adapter is silently broken under contention, so it fails fast with a clear error rather than running unprotected.
  - Adds `@rudderjs/cache` as an optional peer dependency.

  **`@rudderjs/schedule` (patch — internal refactor):**

  - `schedule.withoutOverlapping()` and `schedule.onOneServer()` now use `Cache.lock()`. Closes the same race for cross-server coordination — across N app boxes ticking the same minute, exactly one will acquire the `onOneServer` lock.
  - Adds `@rudderjs/cache` as an optional peer dependency.

  No public API changes for queue/schedule consumers.

- Updated dependencies [0420c1e]
- Updated dependencies [6c03c74]
- Updated dependencies [3ccac5d]
- Updated dependencies [5447fa9]
  - @rudderjs/cache@1.1.0
  - @rudderjs/core@1.1.0

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

## 0.0.12

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.11

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/core@0.1.0

## 0.0.10

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.9

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.8

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.7

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
