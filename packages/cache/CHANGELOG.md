# @rudderjs/cache

## 1.2.0

### Minor Changes

- 40916c1: feat(cache): atomic `increment()` on the `CacheAdapter` contract

  Adds `increment(key, by?, ttlSeconds?): Promise<number>` to `CacheAdapter` and the `Cache` facade. Returns the new value. When the key is missing it is created with the given TTL; subsequent increments preserve the original expiry (the TTL is NOT refreshed) — matches Laravel `Cache::increment` and Redis `INCRBY` + first-write `EXPIRE` semantics.

  **Why:** the prior `get → modify → set` pattern in `@rudderjs/middleware`'s `RateLimit` allowed concurrent requests to silently undercount — both reading `count = N`, both writing `N + 1`, doubling (or worse) the effective limit. The atomic primitive lives on the adapter so any rate-limit / counter use case shares the race-free implementation.

  **Implementations**

  - `MemoryAdapter`: single-threaded in-process atomic via `Map.get` + `Map.set`.
  - `RedisAdapter`: Lua `EVAL` of `INCRBY` plus `EXPIRE` only when `TTL == -1` (no TTL set), so window boundaries don't slide across requests.
  - `FakeCacheAdapter`: mirrors `MemoryAdapter` + records an `'increment'` operation for assertions.

  **Breaking for third-party `CacheAdapter` implementations** — the new method is required on the interface. Adapters that miss it get a TS error at compile time and a runtime `cache.increment is not a function` if called. All in-tree adapters ship the method. Marked as a minor bump because no third-party adapters exist in the wild today.

### Patch Changes

- Updated dependencies [1553c9a]
  - @rudderjs/core@1.2.0

## 1.1.5

### Patch Changes

- e8808c9: Route `CacheRegistry`'s adapter + default-name state through `globalThis` so the registry survives the case where `@rudderjs/cache` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/middleware` inline (which imports `CacheRegistry` for `RateLimit`), but `CacheProvider.boot()` runs from a `node_modules` copy of `@rudderjs/cache` resolved via the provider auto-discovery manifest. Without a shared store, `set()` from the externalized copy would land on a different class than the one `Cache.*` / `RateLimit` reads from inside the bundle, producing a misleading `[RudderJS Cache] No cache adapter registered` error on every rate-limited route in prod.

  No public API change — same `set` / `get` / `setDefaultName` / `getDefaultName` / `reset` surface. Same pattern as PR #498 (`@rudderjs/orm` `ModelRegistry`) and PR #500 (`@rudderjs/pennant` `PennantRegistry`).

## 1.1.4

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5

## 1.1.3

### Patch Changes

- b74fc57: Add `@rudderjs/middleware/client` subpath export for browser-safe helpers. `getCsrfToken()` now lives at this subpath so it can be imported from view code without dragging `@rudderjs/cache`, `node:crypto`, and the rate-limit machinery into the client bundle.

  The main entry still re-exports `getCsrfToken` for backward compatibility, but browser code should import from `@rudderjs/middleware/client`. The four vendored auth views (`Login`, `Register`, `ForgotPassword`, `ResetPassword` under `packages/auth/views/react/`) are updated to use the new subpath — fresh `create-rudder-app` projects will pick up the fix on next install.

  Also replaces `randomUUID` from `node:crypto` with `globalThis.crypto.randomUUID()` in `@rudderjs/cache`'s lock implementation. Both Node 18+ and modern browsers expose the Web Crypto API, so the module no longer crashes when transitively pulled into a client bundle. Fixes the `Module "node:crypto" has been externalized for browser compatibility` runtime error on `/login` and other CSRF-protected forms.

## 1.1.2

### Patch Changes

- 9b33c2c: Tier 2 quality sweep — error guards, timing safety, lock parity, CORS fix.

  - **crypt**: `decrypt()` / `decryptString()` now throw descriptive errors on malformed base64 or non-JSON input instead of an opaque `SyntaxError`
  - **auth**: `handleEmailVerification()` uses `timingSafeEqual` for email hash comparison; `PasswordResetConfig` gains an optional `secret` field so stored token hashes can be bound to APP_KEY
  - **cache**: `RedisAdapter.get()` catches corrupt JSON entries, evicts them, and returns `null`; `MemoryLock.acquire()` returns `false` for zero-TTL (matches `RedisLock` behaviour)
  - **session**: `verify()` replaces manual XOR loop with `crypto.timingSafeEqual`
  - **middleware**: `CorsMiddleware` reflects the matched request origin from an allowlist instead of joining all origins with `', '` (browsers require a single origin value — the old behaviour was silently broken)

- Updated dependencies [0f69018]
  - @rudderjs/core@1.1.3

## 1.1.1

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [4c8cd07]
  - @rudderjs/core@1.1.2

## 1.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [6c03c74]
- Updated dependencies [3ccac5d]
- Updated dependencies [5447fa9]
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

## 0.0.5

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6

## 0.0.4

### Patch Changes

- @rudderjs/core@0.0.5

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.4
