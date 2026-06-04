---
"@rudderjs/orm-drizzle": patch
---

Fix MySQL write paths — `Model.create()` / `update()` / `restore()` threw `TypeError: .returning is not a function` on MySQL (drizzle's mysql builders have no `.returning()`; it's a pg/sqlite method), and `updateAll()` / `deleteAll()` / `upsert()` always reported 0 affected rows on mysql2 (the result is the tuple `[ResultSetHeader, null]` — the count was read off the tuple itself). Writes now run without RETURNING and re-SELECT by primary key on the write connection (auto-increment `insertId` from the header, or the caller-supplied key for uuid/ulid models), mirroring the native engine; affected-row counts read the header through a tuple- and planetscale-aware normalizer. Went unnoticed because the live-MySQL tests seeded via SQL literals and never exercised Model writes — a proxy-based SQL-sequence suite plus a gated live-MySQL write round-trip now cover them.
