---
"@rudderjs/database": patch
---

Three native-engine SQL fixes:

- **`offset()` without `limit()` now compiles per dialect.** The compiler always emitted `LIMIT -1` before `OFFSET`, which is a SQLite-only sentinel. On MySQL and Postgres a query like `Model.query().offset(5).get()` produced a syntax/range error. SQLite keeps `LIMIT -1`, Postgres emits a bare `OFFSET`, and MySQL uses the documented max-rows sentinel.
- **`whereIn` / `whereNotIn` now splice raw `Expression` list elements** instead of binding them as parameters (mirroring the scalar comparison path). This fixes `whereIn(col, [raw(...)])` on every dialect, and a MySQL JSON-boolean `whereIn` that fed `raw('true')`/`raw('false')` through the IN list.
- **`unsigned()` now emits the `UNSIGNED` modifier on MySQL** numeric columns (it was silently a no-op on all dialects, despite `foreignId()`/`morphs()` relying on it). It remains a documented no-op on Postgres and SQLite, and the signed auto-increment primary key is left unchanged for foreign-key signedness parity.
