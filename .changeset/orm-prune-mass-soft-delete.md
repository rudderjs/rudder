---
"@rudderjs/orm": patch
---

`pruneModels` mass mode now throws a clear error when the model also has `softDeletes = true`. Previously the combination silently hard-deleted rows via `deleteAll()`, bypassing `deletedAt` entirely. Use `pruneMode = 'instance'` to soft-delete, or set `softDeletes = false` to opt into hard-deletes in mass mode.
