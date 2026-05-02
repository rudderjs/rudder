# @rudderjs/orm-drizzle

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
