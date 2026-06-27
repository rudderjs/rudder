---
"@rudderjs/orm": minor
"@rudderjs/database": minor
---

feat(orm): add `chunkById(size, cb)` and `lazyById(size)` cursor-based bulk iteration

Both page by primary-key comparison (`WHERE <cursor> > <lastId> LIMIT size`)
instead of `LIMIT`/`OFFSET`, so they never skip rows when earlier rows are
deleted mid-iteration (the OFFSET-drift bug `chunk`/`lazy` are prone to). Each
page clones the pristine base query and applies a single cursor bound to the
copy, so the `WHERE` is replaced per page rather than accumulated. The cursor
column resolves to the explicit `column` argument, else the first `orderBy()`
column, else the model's `primaryKey`, and throws a clear error when none can be
determined. Native engine only (the per-page clone is a native primitive,
`NativeQueryBuilder._cursorClone()`); Drizzle/Prisma throw a clear pointer error.
Both are exposed on the query builder and as `Model` statics.
