# @rudderjs/orm

## 1.6.0

### Minor Changes

- 150b7e3: feat(orm): polymorphic many-to-many — `morphToMany` and `morphedByMany`. Owning side reads/writes route through a shared pivot table carrying `{morphName}Id` + `{morphName}Type`; `attach` / `detach` / `sync` stamp and filter by the parent's discriminator. Inverse side declares one relation per concrete inverse target (`Tag.posts`, `Tag.videos`) — keeps lookup deterministic without an inverse-side types list. Auto-installed accessors mirror the `belongsToMany` shape; declare an explicit override (`tags() { return Model.morphToMany(this, 'tags') }`) for typed wrappers (do not use a class field — it shadows the prototype method). Playground `/demos/polymorphic` extended with the Tag fan-out; scaffolder cascades the same demo into newly created apps.

## 1.5.0

### Minor Changes

- 096c0e1: Add polymorphic relations: `morphTo`, `morphMany`, `morphOne`. Three new `RelationDefinition` variants with thin runtime resolution via existing `where()` chains; no adapter contract change.

  The polymorphic side carries `{morphName}Id` + `{morphName}Type` columns in **camelCase** (a deliberate divergence from Laravel's snake_case for ORM consistency). The discriminator value defaults to the parent class name; override with `static morphAlias = 'post'` for rename-safe storage. `morphTo` takes a closed `types: () => [...]` list of allowed targets, with a dev-mode collision guard against duplicate discriminators.

  `Model.morph(name, parent)` is a write helper that builds the `{ nameId, nameType }` payload for spreading into `create()`/`update()`. `morphToMany` / `morphedByMany` remain deferred (drop to the adapter).

  Unblocks pilotiq's `RelationManager` auto-wiring for polymorphic resources.

## 1.4.0

### Minor Changes

- d6c2f4c: feat(orm): `belongsToMany` (many-to-many) relations

  Many-to-many is now first-class. Declare on `static relations` with `pivotTable` (required) and call `parent.related('roles').get()` for chainable reads through the pivot, or use the per-relation accessor (`user.roles().attach([1,2])`) for pivot mutations.

  ```ts
  class User extends Model {
    static override relations = {
      roles: {
        type: "belongsToMany",
        model: () => Role,
        pivotTable: "role_user",
      },
    } as const;
  }

  await user!.related("roles").where("active", true).get();
  await user!.roles().attach([1, 2], { addedBy: "admin" });
  await user!
    .roles()
    .attach({ 1: { addedBy: "admin" }, 2: { addedBy: "system" } });
  await user!.roles().sync([1, 3, 5]); // → { attached: [3, 5], detached: [2] }
  await user!.roles().detach();
  ```

  **Adapter contract additions** (`@rudderjs/contracts` patch — additive only, no breaks):

  - `QueryBuilder.insertMany(rows)` — bulk insert, no return value.
  - `QueryBuilder.deleteAll()` — delete every row matching the chained wheres, returns count.

  Both `@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle` implement the new methods. Third-party adapters need to add them; the existing surface is unchanged.

  **v1 limitations** (gated on real demand): pivot columns are not surfaced on read results, no `withTimestamps`, no polymorphic `morphToMany`. The deferred read query throws on mutation methods (`create`/`update`/`delete`/`insertMany`/`deleteAll`) — write the pivot via the accessor and the related rows via the related model directly.

### Patch Changes

- Updated dependencies [d6c2f4c]
  - @rudderjs/contracts@1.1.1

## 1.3.0

### Minor Changes

- 38b881b: Add atomic `increment` / `decrement` to the ORM. Final Tier 2 Eloquent parity item.

  ```ts
  // Static — atomic SQL UPDATE, returns hydrated instance
  await Post.increment(postId, "viewCount"); // +1
  await Post.increment(postId, "viewCount", 5); // +5
  await User.decrement(userId, "credits", 10, { lastSeen: new Date() }); // -10 + extras

  // Instance — same SQL, merges new value back onto the instance
  await post.increment("viewCount");
  ```

  The QueryBuilder contract gains `increment(id, column, amount?, extra?)` and `decrement(id, column, amount?, extra?)`. Prisma maps to `{ increment: n }` / `{ decrement: n }` field updates; Drizzle to a `sql\`${col} + ${n}\`` expression. Both run as a single atomic SQL UPDATE — safe under concurrent writes, no read-modify-write race.

  **Caveat — observers don't fire.** `increment` / `decrement` deliberately skip `updating` / `updated` / `saving` / `saved`. The observer payload would have to be either the delta (confusing) or the resolved value (would require a read, breaking atomicity). If you need observer hooks, read the row, compute the resolved value yourself, and call `Model.update()` instead.

  Custom adapters: third-party `OrmAdapter` implementations must add `increment` / `decrement` methods to their QueryBuilder. The signature is the same as `update`, plus `column` and `amount` parameters.

### Patch Changes

- Updated dependencies [38b881b]
  - @rudderjs/contracts@1.1.0

## 1.2.0

### Minor Changes

- 4036c3e: Enforce mass-assignment protection. `static fillable` (allowlist) and the new `static guarded` (denylist; pass `['*']` to lock everything) are now enforced on `Model.create()`, `Model.update()`, and `instance.fill()` — keys outside the policy are silently dropped before the data reaches the adapter. Both default to `[]` (no enforcement) so existing models that haven't set either keep working unchanged. When both are set, `fillable` wins.

  New escape hatch:

  - **`instance.forceFill(data)`** — mass-assign without applying the filter. Useful for trusted sources (factories, internal sync, fixtures).

  `instance.save()` continues to bypass the filter — properties set one-by-one (`user.role = 'admin'; await user.save()`) are intentional, not mass-assignment, so the protection doesn't apply. Internally this routes through new private `_doCreate`/`_doUpdate` paths that skip the filter while still firing observers and mutators.

  Heads-up for `firstOrCreate(attrs, values)`: the lookup `attrs` go through `create()` along with `values`, so they must be in `fillable` too — otherwise the lookup column won't be set on the new row. Add the lookup key to `fillable`, or build the record manually with `new Model().forceFill(...).save()`.

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
