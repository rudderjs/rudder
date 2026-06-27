---
"@rudderjs/orm": minor
---

feat(orm): add `chunkById(size, cb)` and `lazyById(size)` cursor-based bulk iteration

Both page by primary-key comparison (`WHERE <cursor> > <lastId>`) instead of
`LIMIT`/`OFFSET`, so they never skip rows when earlier rows are deleted
mid-iteration (the OFFSET-drift bug `chunk`/`lazy` are prone to). The cursor
column resolves to the explicit `column` argument, else the first `orderBy()`
column, else the model's `primaryKey`, and throws a clear error when none can be
determined. Both are exposed on the query builder and as `Model` statics.
