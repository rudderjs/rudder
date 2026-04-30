# @rudderjs/orm

## 1.1.0

### Minor Changes

- 64bbff6: Hydrate query results into Model instances. Every read path (`find`/`first`/`all`/`paginate`/`where(...).first()`/`where(...).get()`/`create`/`update`/`restore`/`firstOrCreate`/`updateOrCreate`) now returns objects that are `instanceof Model` and carry the prototype chain. Adapters still return plain records — the Model wraps the QueryBuilder via a Proxy, so Prisma and Drizzle adapters didn't change.

  New instance methods on every hydrated record:

  - `save()` — inserts when the primary key is unset, otherwise updates. Routes through the static path so observers fire.
  - `fill(data)` — mass-assigns without persisting.
  - `refresh()` — re-reads the row and replaces fields in place. Throws `ModelNotFoundError` when the row is gone.
  - `delete()` — routes through the static so soft deletes and `deleting`/`deleted` observers behave the same as `Model.delete(id)`.
  - `replicate(except?)` — clones the instance without the primary key, `createdAt`/`updatedAt`/`deletedAt`, or any extra keys passed in.
  - `is(other)` / `isNot(other)` — identity by table + primary key.
  - `trashed()` — true when `deletedAt` is set.

  `Model.hydrate(record)` is the public escape hatch for wrapping plain records that didn't come through the adapter (cached JSON, fixtures).

  Internal serialization overrides moved from `_instanceHidden`/`_instanceVisible` to ECMAScript private (`#instanceHidden`/`#instanceVisible`) so they never appear in `Object.entries`, object spread, or `JSON.stringify`. `JSON.stringify(user)` and `Object.entries(user)` now produce wire-format-clean output suitable for direct Prisma writes and Telescope serialization.

  Note for downstream tests: assertions like `assert.deepStrictEqual(result, plainObject)` no longer hold for query results — node's `deepStrictEqual` checks prototypes. Compare via `{ ...result }` or assert `result instanceof Model`.

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

## 0.1.2

### Patch Changes

- be10c83: Add `ModelLike` + `ModelQuery` interfaces to `@rudderjs/contracts` so downstream
  tools (e.g. `@pilotiq/pilotiq` for auto-wired CRUD) can target the Eloquent-style
  Model surface without depending on `@rudderjs/orm` directly. `Model` from
  `@rudderjs/orm` already structurally satisfies `ModelLike`, asserted at compile
  time via a `const _: ModelLike = Model` guard in `@rudderjs/orm`'s entry — any
  future change to `Model` that breaks the contract fails the build.
- Updated dependencies [be10c83]
  - @rudderjs/contracts@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0

## 0.1.0

### Minor Changes

- 8b0400f: Add `ModelRegistry.all()`, `.register()`, and `.onRegister()` so framework components can discover registered Model classes.

  Models are auto-registered on first `query()` or `find()`/`all()`/`first()`/`where()`/`count()`/`paginate()` call. Use `ModelRegistry.register(MyModel)` in a service provider to register eagerly before the first request hits.

  Telescope's model collector now subscribes via `onRegister()` so it also picks up models that appear after its own boot.

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
  - @rudderjs/contracts@0.0.4
