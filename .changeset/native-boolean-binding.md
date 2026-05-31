---
"@rudderjs/orm": patch
---

Fix the native SQLite engine throwing on raw boolean bindings.

`better-sqlite3` only binds numbers, strings, bigints, buffers, and `null` — a raw JS `boolean` raised `TypeError: SQLite3 can only bind …`. The `better-sqlite3` driver now maps `true`/`false` to the integers `1`/`0` (SQLite has no boolean type), so raw boolean values that bypass a column cast bind cleanly: an untyped `where('flag', true)` predicate, or a `query().create({ flag: true })` on a column without a `boolean` cast. Typed boolean columns were already fine — the cast layer serializes `true → 1` before the value reaches the driver. Other unbindable values (`Date`, plain objects) are still passed through so the driver rejects them with its own clear error.
