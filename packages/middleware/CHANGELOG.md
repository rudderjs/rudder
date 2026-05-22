# @rudderjs/middleware

## 1.1.2

### Patch Changes

- 84e5c13: **@rudderjs/auth** — `BaseAuthController` now ships default rate-limits on
  `signIn` (10/min by IP), `signUp` (5/min by IP), and `requestPasswordReset`
  (3/min by email, IP fallback). Override per-method via `static rateLimits`
  on the subclass, or set to `{}` to disable entirely. `@rudderjs/middleware`
  is now a required peer (it's a core package shipped with every scaffolded
  app, so installations that already use `BaseAuthController` are unaffected).

  **@rudderjs/middleware** — `RateLimit` instances now namespace their cache
  key per-handler so siblings keyed by the same identifier don't share a
  bucket. Before: `m.web(RateLimit.perMinute(60))` and a route-scoped
  `RateLimit.perMinute(5)` keyed by IP both wrote to `rudderjs:rl:<ip>`, so 5
  unrelated web-group GETs would drain the route-scoped limiter's quota. Now
  each handler instance owns its own bucket; a shared handler reference
  (`m.web(myLimiter)` applied to multiple routes) still shares a bucket as
  expected. Load-bearing for the Phase 6 default rate-limits above —
  surfaced by the scaffolder render E2E.

  Plan: `docs/plans/2026-05-21-framework-security-fixes.md` Phase 6.

- 40916c1: fix(middleware): atomic counter on `RateLimit` (close concurrent-bypass)

  Replaces the `cache.get → modify → cache.set` cycle in `makeRateLimitHandler` with `cache.increment(key, 1, windowSec)`. Closes a high-severity race documented in the 2026-05-21 security review: two concurrent requests against `RateLimit.perMinute(5)` on `/auth/sign-in` could both observe `count = N`, both write `N + 1`, so the effective ceiling doubled (or worse with M parallel attackers). The header `X-RateLimit-Remaining` reflected the bumped count but the gate had already let both through.

  The fix needs `@rudderjs/cache` ≥ the matching `feat(cache): atomic increment` release. Window expiry is now tracked in a sibling `:exp` meta key so `X-RateLimit-Reset` continues to report the same moment for every request in the window.

  Regression: new test fires 50 concurrent calls against `RateLimit.perMinute(5)` with a shared IP and asserts exactly 5 pass + 45 return 429. Previously the count drifted non-deterministically based on cache backend timing.

- Updated dependencies [40916c1]
- Updated dependencies [6652117]
- Updated dependencies [3e60f95]
  - @rudderjs/cache@1.2.0
  - @rudderjs/contracts@1.8.0

## 1.1.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/cache@1.1.4
  - @rudderjs/contracts@1.6.1

## 1.1.0

### Minor Changes

- b74fc57: Add `@rudderjs/middleware/client` subpath export for browser-safe helpers. `getCsrfToken()` now lives at this subpath so it can be imported from view code without dragging `@rudderjs/cache`, `node:crypto`, and the rate-limit machinery into the client bundle.

  The main entry still re-exports `getCsrfToken` for backward compatibility, but browser code should import from `@rudderjs/middleware/client`. The four vendored auth views (`Login`, `Register`, `ForgotPassword`, `ResetPassword` under `packages/auth/views/react/`) are updated to use the new subpath — fresh `create-rudder-app` projects will pick up the fix on next install.

  Also replaces `randomUUID` from `node:crypto` with `globalThis.crypto.randomUUID()` in `@rudderjs/cache`'s lock implementation. Both Node 18+ and modern browsers expose the Web Crypto API, so the module no longer crashes when transitively pulled into a client bundle. Fixes the `Module "node:crypto" has been externalized for browser compatibility` runtime error on `/login` and other CSRF-protected forms.

### Patch Changes

- Updated dependencies [b74fc57]
  - @rudderjs/cache@1.1.3

## 1.0.2

### Patch Changes

- 9b33c2c: Tier 2 quality sweep — error guards, timing safety, lock parity, CORS fix.

  - **crypt**: `decrypt()` / `decryptString()` now throw descriptive errors on malformed base64 or non-JSON input instead of an opaque `SyntaxError`
  - **auth**: `handleEmailVerification()` uses `timingSafeEqual` for email hash comparison; `PasswordResetConfig` gains an optional `secret` field so stored token hashes can be bound to APP_KEY
  - **cache**: `RedisAdapter.get()` catches corrupt JSON entries, evicts them, and returns `null`; `MemoryLock.acquire()` returns `false` for zero-TTL (matches `RedisLock` behaviour)
  - **session**: `verify()` replaces manual XOR loop with `crypto.timingSafeEqual`
  - **middleware**: `CorsMiddleware` reflects the matched request origin from an allowlist instead of joining all origins with `', '` (browsers require a single origin value — the old behaviour was silently broken)

- Updated dependencies [f867181]
- Updated dependencies [9b33c2c]
  - @rudderjs/contracts@1.4.0
  - @rudderjs/cache@1.1.2

## 1.0.1

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- Updated dependencies [dfba4df]
- Updated dependencies [4c8cd07]
  - @rudderjs/cache@1.1.1

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
  - @rudderjs/cache@1.0.0
  - @rudderjs/contracts@1.0.0

## 0.0.14

### Patch Changes

- Updated dependencies [be10c83]
  - @rudderjs/contracts@0.2.0

## 0.0.13

### Patch Changes

- @rudderjs/cache@0.0.12

## 0.0.12

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/cache@0.0.11

## 0.0.11

### Patch Changes

- @rudderjs/cache@0.0.10

## 0.0.10

### Patch Changes

- @rudderjs/cache@0.0.9

## 0.0.9

### Patch Changes

- @rudderjs/cache@0.0.8

## 0.0.8

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

## 0.0.6

### Patch Changes

- @rudderjs/cache@0.0.5

## 0.0.5

### Patch Changes

- @rudderjs/cache@0.0.4

## 0.0.4

### Patch Changes

- Quality pass: bug fixes, expanded tests, and docs improvements across core packages.

  - `@rudderjs/support`: fix `ConfigRepository.get()` returning fallback for falsy values (`0`, `false`, `''`); add prototype pollution protection to `set()`; fix `Collection.toJSON()` returning `T[]` not a string; fix `Env.getBool()` to be case-insensitive; fix `isObject()` to correctly return `false` for `Date`, `Map`, `RegExp`, etc.
  - `@rudderjs/contracts`: fix `MiddlewareHandler` return type (`void` → `unknown | Promise<unknown>`)
  - `@rudderjs/middleware`: add array constructor to `Pipeline` — `new Pipeline([...handlers])` now works
  - `create-rudder-app`: remove deprecated `.toHandler()` from `RateLimit` in scaffolded templates; remove nonexistent `.withExceptions()` call

- Updated dependencies
  - @rudderjs/contracts@0.0.2
  - @rudderjs/cache@0.0.3
