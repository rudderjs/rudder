---
'@rudderjs/orm': patch
---

Two correctness fixes on the parity surface that just landed:

- **`whereHas` constrain callback now throws on `orWhere`.** Previously, `Model.whereHas('rel', q => q.where('a', 1).orWhere('b', 2))` silently dropped the `orWhere` clause — the recorder Proxy only intercepted `where`. The contract's `WhereClause` has no boolean (`and` | `or`) flag, so OR semantics can't round-trip to the adapter; throw a clear "not supported in v1" error instead of producing a wrong query. Same shape as the existing nested-`whereHas` error.

- **`instance.delete()` now reflects soft-delete state locally.** On a model with `static softDeletes = true`, `await user.delete()` previously left `user.deletedAt` stale (still `null`), so `user.trashed()` returned `false` immediately after delete and the dirty-tracking baseline diverged from the database. The instance method now sets `deletedAt = new Date()` locally and calls `_syncOriginal()` after the static delete completes — `trashed()` returns `true`, `isDirty()` returns `false`. Hard-delete models are unchanged.
