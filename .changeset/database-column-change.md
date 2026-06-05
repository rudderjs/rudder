---
"@rudderjs/database": minor
---

feat: column `.change()` on Postgres and MySQL (7.4b) — `Schema.table('users', (t) => t.string('email', 100).nullable().change())` now compiles to native DDL instead of throwing: one comma-joined `ALTER TABLE … ALTER COLUMN` statement on pg (TYPE + SET/DROP NOT NULL + SET/DROP DEFAULT — the chained definition fully replaces the old one, Laravel semantics; type conversions rely on pg's implicit casts, incompatible ones need a raw `USING` via `DB.statement`), and a single `MODIFY` carrying the full new spec on mysql (positional `.after()`/`.first()` compose). Changes mix freely with other alter ops in one `Schema.table` call on pg/mysql (renames → changes → adds → indexes → FKs → drops). SQLite keeps the table-rebuild path unchanged. Changing a column into a primary-key/auto-increment column throws a clear `NATIVE_DDL_CHANGE_PRIMARY` error.
