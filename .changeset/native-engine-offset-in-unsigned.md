---
"@rudderjs/database": patch
---

Two native-engine SQL fixes:

- **`offset()` without `limit()` now compiles per dialect.** The compiler always emitted `LIMIT -1` before `OFFSET`, which is a SQLite-only sentinel. On MySQL and Postgres a query like `Model.query().offset(5).get()` produced a syntax/range error. SQLite keeps `LIMIT -1`, Postgres emits a bare `OFFSET`, and MySQL uses the documented max-rows sentinel.
- **`whereIn` / `whereNotIn` now splice raw `Expression` list elements** instead of binding them as parameters (mirroring the scalar comparison path). This fixes `whereIn(col, [raw(...)])` on every dialect, and a MySQL JSON-boolean `whereIn` that fed `raw('true')`/`raw('false')` through the IN list.

Also documents that `unsigned()` is intentionally a no-op in the emitted DDL (the signed `bigint` primary key means an `UNSIGNED` foreign-key column would break MySQL foreign keys).
