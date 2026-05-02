---
'@rudderjs/orm-drizzle': major
---

Graduate to 1.0.0 with three correctness fixes and a new auto-discovered `DatabaseProvider`.

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
