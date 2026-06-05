---
"@rudderjs/orm-drizzle": patch
---

Fix the raw DB-facade seams on mysql: `DB.select()` returned mysql2's `[rows, fields]` tuple instead of the rows, and `DB.insert()`/`update()`/`delete()`/`statement()` reported the tuple's length (always 2) instead of `affectedRows`. Both seams now unwrap the mysql2 result tuple (`mysqlWriteHeader` for write counts), matching what the Model write paths already did.
