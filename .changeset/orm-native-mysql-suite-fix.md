---
"@rudderjs/orm": patch
---

Native MySQL engine fixes — `Schema.hasTable()` / `Schema.hasColumn()` now work on the mysql dialect (information_schema scoped to `DATABASE()`; previously threw `NATIVE_NOT_IMPLEMENTED`), `tinyint(1)` columns read back as JS booleans via a mysql2 `typeCast` (Postgres parity for `t.boolean()` columns; a plain `t.tinyInt()` stays numeric, override via driver `options`), and `create()` re-selects the inserted row by primary key instead of synthesizing it from the input — so the returned instance carries the real stored row (DB defaults, driver type mapping), consistent with the RETURNING dialects.
