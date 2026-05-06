# @rudderjs/orm-drizzle

## 1.3.0

### Minor Changes

- 2398242: Read, update, and per-id sync of pivot-table extra columns on `belongsToMany` (and morph siblings).

  - **`QueryBuilder.withPivot(...columns)`** — declare which pivot columns to surface on each loaded related row. Stamps `row.pivot = { col: value, ... }` after the second-step query resolves. No-op when not called; calling with zero args throws so the contract is explicit. Works on `belongsToMany`, `morphToMany`, and `morphedByMany`.
  - **`BelongsToManyAccessor.updatePivot(relatedId, data)`** — patch extras on an existing pivot row without detach/re-attach. Locates the pivot row by `(foreignPivotKey = parentVal, relatedPivotKey = relatedId)` and writes only the supplied columns; returns the number of rows updated (0 when the link doesn't exist). Same shape on the morph siblings — the discriminator column is included in the WHERE.
  - **`sync(perIdPivotMap)` overload** — `sync({ id1: { role: 'owner' }, id2: { role: 'editor' } })` reconciles a desired set with per-id pivot data. Return value gains `updated: unknown[]` alongside the existing `attached` / `detached`. The single-`Record` (`flatPivot`) form is unchanged.
  - **`QueryBuilder.updateAll(data)`** — bulk update every row matching the chained `where`s. Returns the affected row count. Prisma routes through `updateMany`; Drizzle uses `update().set().where()`. Parallels the existing `deleteAll()`.

  Pure addition — no behavior change for code that doesn't call the new APIs. Adapter test fixtures and in-memory `QueryBuilder` test doubles pick up the two new method stubs.

- aa526b3: Nested AND/OR query groups via `whereGroup(fn)` and `orWhereGroup(fn)`.

  ```ts
  User.query()
    .where("status", "active")
    .whereGroup((g) => g.where("priority", "high").orWhere("starred", true));
  // WHERE status = 'active' AND (priority = 'high' OR starred = TRUE)
  ```

  - **`QueryBuilder.whereGroup(fn)` / `orWhereGroup(fn)`** — the callback receives a fresh sub-builder. Calls inside it compose into a single grouped clause that's spliced back into the parent under AND or OR. Sub-builders are themselves `QueryBuilder<T>`, so `whereGroup` nests arbitrarily deep and `whereHas` works inside the callback.
  - **Sub-builder terminals throw** — calling `get`/`first`/`find`/`count`/`paginate`/etc. on the inner builder errors with `Sub-builder is for where* chaining only — call get() on the parent builder.` Empty groups (`whereGroup(g => g)`) are a no-op.
  - **Adapters** — Prisma emits `AND: [...]` / `OR: [...]` array form only when groups are present, so the existing flat-spread shape is preserved for code that doesn't use the new API. Drizzle wraps the captured clauses with `and()` / `or()` SQL helpers and appends to the parent.

  Pure addition — no behavior change for existing `where`/`orWhere` chains. Mirrors the callback shape of the existing `whereHas(rel, fn)` API.

### Patch Changes

- Updated dependencies [2398242]
- Updated dependencies [aa526b3]
  - @rudderjs/contracts@1.3.0
  - @rudderjs/orm@1.8.0

## 1.2.0

### Minor Changes

- 1805d0c: Aggregate eager loading — `withCount` / `withSum` / `withMin` / `withMax` / `withAvg` / `withExists` on the QueryBuilder + `loadCount` / `loadSum` / `loadMin` / `loadMax` / `loadAvg` / `loadExists` / `loadMissing` on instances (Laravel parity #2 plan #3).

  Closes the N+1 footgun for hot list pages without dropping into the adapter. Result columns are stamped onto each parent under deterministic camelCase aliases (`postsCount`, `postsSumViews`, `subscriptionExists`).

  ```ts
  // Multi-row aggregate (parent query)
  await User.query().withCount("posts").get(); // user.postsCount
  await User.query().withSum("posts", "views").paginate(1); // user.postsSumViews
  await User.query()
    .withCount({
      posts: (q) => q.where("published", true).as("publishedPosts"),
    })
    .get(); // user.publishedPostsCount

  // Per-instance aggregate
  const user = await User.find(1);
  await user!.loadCount("posts");
  console.log(user!.postsCount);

  // Eager-load only what's missing
  await user!.loadMissing("profile", "posts");
  ```

  **Notes:**

  - `withCount` on `belongsTo` throws (always 0 or 1; use `withExists` instead). On `morphTo` throws (related table is dynamic).
  - Aggregate columns are tagged on a `Symbol.for('rudderjs.orm.aggregates')` Set so `model.save()` strips them before write — they never reach the underlying schema.
  - Soft deletes on the related model are applied automatically — the adapter ANDs `deleted_at IS NULL` into the aggregate subquery.
  - Closure constraints (`q => q.where(...).as(...)`) cover the same surface as `whereHas` constraints.

  **Adapter changes:**

  - New `withAggregate(requests: AggregateRequest[])` method on `QueryBuilder<T>` (required). Out-of-tree adapters implement this single normalized shape — the public `withCount` / `withSum` / etc. overloads collapse into `AggregateRequest[]` in the orm Model layer.
  - New `_aggregate(fn, column?)` method on `QueryBuilder<T>` (required, `@internal`) — single-scalar terminal used by the per-instance `loadCount` / `loadSum` / etc.
  - `QueryState.aggregates: AggregateRequest[]` extends the existing state shape.
  - `@rudderjs/orm-prisma` uses Prisma's native `_count.select` for direct count/exists (no second round-trip) and second-batch `groupBy` for polymorphic / pivot / numeric aggregates.
  - `@rudderjs/orm-drizzle` emits one correlated subselect per aggregate in the SELECT list. Pivot-mediated aggregates JOIN through the pivot table when soft-deletes / constraints / numeric columns are involved.

  Additive — no migration needed for existing calls.

- fcc57f9: Eloquent-style relation predicates — `whereHas` / `whereDoesntHave` /
  `withWhereHas` / `whereBelongsTo` (Laravel parity #2 PR3).

  Filter a query by whether a relation has at least one matching row.
  The optional callback narrows the relation predicate further — chain
  plain `where()` calls inside it.

  ```ts
  await User.whereHas("posts", (q) => q.where("published", true)).get();
  await User.whereDoesntHave("posts").get();
  await User.withWhereHas("posts", (q) => q.where("published", true)).get();
  await Post.whereBelongsTo(user).get();
  await Comment.whereBelongsTo(post, "post").get();
  ```

  Supported relation types: `hasMany`, `hasOne`, `belongsTo`,
  `belongsToMany`, `morphMany`, `morphOne`, `morphToMany`, `morphedByMany`.
  `morphTo` is intentionally not supported — the related table is dynamic,
  so a single subquery can't represent it. Filter on `{morphName}Id` /
  `{morphName}Type` directly when you need that semantic.

  The four chainable methods are also exposed on `QueryBuilder` so
  they compose with flat `where()`/`orderBy()`/etc.

  **Adapter changes:**

  - New `RelationExistencePredicate` type in `@rudderjs/contracts` —
    carries the structural metadata adapters need (related table, parent /
    related columns, constraint wheres, optional `extraEquals` for morph
    discriminators, optional `through` for pivot relations).
  - New `whereRelationExists(predicate)` method on `QueryBuilder<T>`
    (required). Out-of-tree adapters need to implement it.
  - New optional `withConstrained(relation, wheres)` method on
    `QueryBuilder<T>` for constrained eager-load.
  - `@rudderjs/orm-prisma` uses native `some` / `none` filters for direct
    relations (`hasMany`/`hasOne`/`belongsTo`) — those relations must be
    declared in `schema.prisma` with the same name. Polymorphic and pivot
    paths route through a 2-step lookup so they work without a Prisma-
    declared relation. `withConstrained` maps to nested `include: { rel:
{ where } }`.
  - `@rudderjs/orm-drizzle` builds correlated `EXISTS (...)` /
    `NOT EXISTS (...)` subqueries via `exists()` / `notExists()`. Every
    related table referenced from a `whereHas` call must be registered via
    `tables: { ... }` on `drizzle()` config or
    `DrizzleTableRegistry.register(name, table)`. `withConstrained` is not
    yet implemented on Drizzle — `withWhereHas` falls back to plain
    `with(relation)`.

  Additive — no migration needed for existing calls.

### Patch Changes

- Updated dependencies [6c03c74]
- Updated dependencies [3ccac5d]
- Updated dependencies [5447fa9]
- Updated dependencies [1805d0c]
- Updated dependencies [a089110]
- Updated dependencies [5703439]
- Updated dependencies [ad3a531]
- Updated dependencies [fcc57f9]
- Updated dependencies [a0b96f9]
  - @rudderjs/core@1.1.0
  - @rudderjs/orm@1.7.0
  - @rudderjs/contracts@1.2.0

## 1.1.0

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
  - @rudderjs/orm@1.4.0
  - @rudderjs/contracts@1.1.1

## 1.0.0

### Major Changes

- d33a492: Graduate to 1.0.0 with three correctness fixes and a new auto-discovered `DatabaseProvider`.

  **Bug fixes**

  - `orWhere(col, value)` previously pushed onto the same internal AND chain as `where()`, silently behaving identically. It now tracks an `_orWheres` list and emits a real `OR` condition. The operator overload `orWhere(col, op, value)` is also wired through.
  - `find(id)` previously bypassed the soft-delete filter and returned soft-deleted rows. It now respects `_softDeletes` / `_withTrashed` / `_onlyTrashed` exactly like `first()` and `get()`.
  - `all()` previously emitted `select * from <table>` and dropped wheres, orders, limits, offsets, and the soft-delete filter. It is now an alias of `get()` that applies the full chain.
  - The soft-delete filter previously emitted `deletedAt = NULL` (which never matches in SQL). It now uses `IS NULL` / `IS NOT NULL` via Drizzle's `isNull` / `isNotNull` helpers.

  **New: `DatabaseProvider`**

  Adds an auto-discovered `DatabaseProvider` that reads `config('database')` (matching the `@rudderjs/orm-prisma` shape: `default` + `connections`, with extra `tables` and `client` fields for Drizzle) and registers a `DrizzleAdapter` on the DI container as `db` plus on `ModelRegistry`. With both `@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle` installed, set `database.driver` to choose the active adapter.

  Run `pnpm rudder providers:discover` after installing or removing this package so `defaultProviders()` picks up the change.

  **Tests**

  The shape-only test suite is now backed by a real in-memory SQLite integration test (`integration.test.js`) that exercises the full QueryBuilder surface — wheres, OR clauses, soft deletes, `withTrashed` / `onlyTrashed`, `restore`, `forceDelete`, `increment`, `decrement`, and `paginate`.

## 0.1.0

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

## 0.0.10

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0

## 0.0.9

### Patch Changes

- Updated dependencies [be10c83]
  - @rudderjs/contracts@0.2.0

## 0.0.8

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0

## 0.0.7

### Patch Changes

- Updated dependencies [e1189e9]
  - @rudderjs/contracts@0.0.4

## 0.0.5

### Patch Changes

- @rudderjs/orm@0.0.5

## 0.0.4

### Patch Changes

- @rudderjs/orm@0.0.4

## 0.0.3

### Patch Changes

- @rudderjs/orm@0.0.3
