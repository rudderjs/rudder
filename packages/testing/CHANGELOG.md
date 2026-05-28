# @rudderjs/testing

## 1.2.0

### Minor Changes

- 448ed8d: Laravel-parity `AssertableJson` fluent DSL — the canonical JSON-response assertion in Laravel 12 — exposed via a new overload on `TestResponse.assertJson(callback)`:

  ```ts
  res.assertJson((json) =>
    json
      .has("user")
      .where("user.name", "Suleiman")
      .whereType("user.email", "string")
      .has("items", 3, (item) => item.where("id", 1).etc())
      .missing("user.password")
      .etc()
  );
  ```

  **Strict-by-default** is the headline — at the end of any scope (root or scoped callback), the DSL asserts that every key on the object was touched. Unchecked keys throw. So an extra field accidentally added to a response surfaces in the test instead of leaking through.

  Public surface:

  - `AssertableJson` — exported class for direct use, also driven by the callback overload on `TestResponse.assertJson`.
  - Methods: `has(key, n?, fn?)`, `missing(key)`, `missingAll(keys)`, `where(key, value)`, `whereNot(key, value)`, `whereType(key, type)`, `whereContains(key, value)`, `count(key, n)`, `first(fn)`, `each(fn)`, `etc()`.
  - Dot-notation paths (`user.profile.name`, `items.0.id`).
  - Existing subset-match form (`res.assertJson({ name: 'Alice' })`) is unchanged — the overload only triggers on a function argument.

  Found by the Phase 3 testing-ergonomics audit (cluster 8).

- 2c9fe2b: Add Laravel-parity auth assertions to `TestCase` + an `actingAsGuest()` helper:

  - **`actingAsGuest()`** — clear any acting-as user; subsequent requests run unauthenticated.
  - **`assertAuthenticated()`** — passes when `actingAs(user)` is in effect.
  - **`assertGuest()`** — passes when no acting-as user is set.
  - **`assertAuthenticatedAs({ id })`** — passes when the acting-as user has the matching id (coerced to string for comparison).

  Pairs with the matching wiring in `@rudderjs/auth` (this release) — `actingAs(user)` now actually populates `req.user`, `auth().user()`, `Auth.guard().check()`, and `RequireAuth` end-to-end in test mode.

  The assertions check the test-side intent set via `actingAs` — they don't verify that a specific request authenticated end-to-end (for that, assert on the response of a follow-up request to a route that requires auth).

  Found by the Phase 3 testing-ergonomics audit (cluster 2).

- 0ce372f: Expand `TestResponse` with Laravel-parity content, cookie, JSON, and status assertions.

  **New status helpers:** `assertAccepted` (202), `assertBadRequest` (400), `assertConflict` (409), `assertGone` (410), `assertTooManyRequests` (429).

  **JSON variants:**

  - `assertExactJson(expected)` — deep-equal at top level (no extra keys).
  - `assertJsonMissingExact(expected)` — opposite of `assertExactJson`.
  - `assertJsonFragment(fragment)` — match every key/value pair on any object node in the body (walks arrays and nested objects).

  **Content assertions:**

  - `assertContent(value)` — raw body equals.
  - `assertSee(value)` / `assertDontSee(value)` — substring match on raw body.
  - `assertSeeText(value)` / `assertDontSeeText(value)` — strips HTML tags + collapses whitespace before matching.
  - `assertSeeInOrder([a, b, c])` — substrings appear in this order.

  **Cookie assertions** (response `Set-Cookie` inspection):

  - `assertCookie(name, value?)` — Set-Cookie present (optionally verify value substring).
  - `assertCookieMissing(name)` — no Set-Cookie for that name.

  To support multi-value `Set-Cookie`, `TestResponse` now exposes a `setCookies: string[]` field (one entry per cookie set; empty when none). Captured automatically from `Response.headers.getSetCookie()` when available. Pre-existing `TestResponse` constructor calls remain compatible — the new `setCookies` constructor parameter is optional and defaults to `[]`.

  Found by the Phase 3 testing-ergonomics audit (cluster 5a — pure-additive subset of the TestResponse expansion).

- cae47a9: Laravel-parity session / view / validation assertions on `TestResponse`, plus a test-mode side channel to deliver the data:

  - **`assertSessionHas(key, value?)`**, **`assertSessionMissing(key)`**, **`assertSessionHasErrors(keys)`** — assert on the resolved session payload of a `web`-group route (where `sessionMiddleware` is auto-installed). `assertSessionHasErrors` reads the `errors` flash bag (the `withErrors($validator)` shape).
  - **`assertViewIs(id)`**, **`assertViewHas(key, value?)`** — assert on the rendered view id / props when the controller returned `view('id', props)` from `@rudderjs/view`. Fails with a clear message when the route returned JSON or a raw `Response`.
  - **`assertValid()`**, **`assertInvalid(keys?)`** — combined JSON-body + session-flash check, so the same assertion covers both API (422 + `body.errors`) and web (redirect + flashed `errors`) flows.
  - **`assertJsonValidationErrors(keys)`** — JSON-only variant for callers that want to be explicit.

  All assertions return `this` for chaining.

  Internally, `@rudderjs/server-hono` now emits two response headers — `x-rudderjs-test-session` and `x-rudderjs-test-view` (base64-encoded JSON) — only when `globalThis['__rudderjs_test_mode__']` is set. `TestCase._bootstrap()` flips the flag on creation and clears it in `teardown()`, so production traffic never sees the headers. The session payload is duck-typed (`.all()` / `.allFlash()`) so server-hono stays decoupled from `@rudderjs/session` and `@rudderjs/view`.

  Found by the Phase 3 testing-ergonomics audit (cluster 5b — the session/view/validation slice that #749 deferred to a follow-up because it needed cross-package coordination).

- ed06615: Add Laravel-style time-travel helpers to `TestCase`, wrapping Node 22's `mock.timers`:

  - **`travel(amount).milliseconds()` / `.seconds()` / `.minutes()` / `.hours()` / `.days()` / `.weeks()` / `.years()`** — advance the mocked clock by the chosen unit.
  - **`travelTo(date | timestamp)`** — set the clock to an absolute moment.
  - **`travelBack()`** — restore real time. Called automatically from `teardown()`.
  - **`freezeTime(fn)`** — pin `Date.now()` for the duration of the callback; restores afterward when not already mocked.

  The mock initializes at the real wall-clock time so `Date.now()` stays continuous across travel/restore boundaries. `setImmediate` is intentionally NOT mocked so `await new Promise(r => setImmediate(r))` still yields the event loop between travels.

  Also exports a new public class `TravelBuilder` returned by `travel(amount)` for unit selection — apps can use it directly if they need lower-level access.

  Found by the Phase 3 testing-ergonomics audit (cluster 6).

### Patch Changes

- Updated dependencies [161c5c4]
  - @rudderjs/core@1.5.1

## 1.1.0

### Minor Changes

- a6dfc1d: Add Laravel-parity model-instance database assertions to `TestCase`:

  - **`assertModelExists(model)`** — passes if a row matching the model's primary key exists in the database (any state, including soft-deleted).
  - **`assertModelMissing(model)`** — passes if no row matches the model's primary key.
  - **`assertSoftDeleted(model)`** — passes if the model's row exists AND `deletedAt` is set. Requires `static softDeletes = true` on the model.
  - **`assertNotSoftDeleted(model)`** — passes if the row exists AND `deletedAt` is null.

  Pairs with the existing `assertDatabaseHas` / `assertDatabaseMissing` / `assertDatabaseCount` / `assertDatabaseEmpty`, but skips the explicit table-name + attributes form when you already have a Model in hand. Resolves `static table` + `static primaryKey` from the model's constructor — clear errors when the model isn't a proper persisted entity (no `static table`, no primary-key value).

  Also exports a new public type `TestModelLike` describing the minimum shape these helpers accept.

  Found by the Phase 3 testing-ergonomics audit (cluster 3 of 4).

- bc5a585: Add fluent request-setup chain to `TestCase` for attaching headers and cookies to subsequent requests, matching Laravel's `withHeaders` / `withCookies` ergonomics:

  - **`withHeader(name, value)`** / **`withHeaders(obj)`** — accumulate headers applied to every subsequent request until cleared.
  - **`withCookie(name, value)`** / **`withCookies(obj)`** — accumulate cookies serialized into a single URI-encoded `Cookie` header.
  - **`flushHeaders()`** / **`flushCookies()`** — clear accumulated state mid-test (also cleared automatically by `teardown()`).

  The per-request `headers` argument continues to win over the accumulated set, so individual tests can override the test-wide defaults without disturbing them. All methods return `this` for chaining.

  Found by the Phase 3 testing-ergonomics audit (cluster 4 of 4).

## 1.0.3

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/contracts@1.6.1
  - @rudderjs/core@1.1.5

## 1.0.2

### Patch Changes

- 2f85823: Add error cause to rethrown import errors
- Updated dependencies [8e682a6]
  - @rudderjs/contracts@1.5.0

## 1.0.1

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
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
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0

## 0.0.8

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0

## 0.0.7

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.6

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
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
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
