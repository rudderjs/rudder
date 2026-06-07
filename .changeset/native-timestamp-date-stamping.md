---
"@rudderjs/orm": patch
"@rudderjs/database": patch
---

Fix timestamp and soft-delete stamping on the native MySQL engine. The Model layer stamped `createdAt`/`updatedAt`/`deletedAt` as ISO-8601 strings — MySQL strict mode rejects the trailing `Z` (`Incorrect datetime value`), so every `create()`/`save()`/soft `delete()` on a timestamps-enabled table failed on native MySQL. Stamps are now `Date` objects and each driver serializes them in its own wire format: the sqlite driver normalizes `Date` → ISO-8601 UTC text at bind time (the same stored format as before — no migration needed), pg and mysql2 handle `Date` natively. Side effect: `Date` values in any payload now bind on sqlite instead of throwing better-sqlite3's `can only bind` error, and `creating`/`saving` observers see a `Date` (not a string) in stamped fields.
