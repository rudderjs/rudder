---
"@rudderjs/database": patch
---

Fix the SQLite `Schema.table(...).change()` rebuild silently dropping foreign keys and CHECK constraints. SQLite can't alter a column in place, so a `change()` rebuilds the table by reconstructing it from `PRAGMA table_info` + the user indexes — but foreign keys and CHECK constraints live inside the CREATE TABLE body, invisible to `table_info`, so they were lost on every rebuild (including a `change()` on an unrelated column). Referential integrity and enum validation silently disappeared.

Foreign keys are now reconstructed from `PRAGMA foreign_key_list` (columns, referenced table/columns, and ON DELETE / ON UPDATE actions) and re-emitted on the rebuilt table. CHECK constraints can't yet be reproduced from introspection, so a rebuild of a table carrying one now throws a clear error (`NATIVE_DDL_CHANGE_CHECK`) with a workaround, instead of silently dropping it — full CHECK preservation is a follow-up. Postgres and MySQL are unaffected (their ALTER is in-place).
