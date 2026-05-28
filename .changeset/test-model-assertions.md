---
'@rudderjs/testing': minor
---

Add Laravel-parity model-instance database assertions to `TestCase`:

- **`assertModelExists(model)`** — passes if a row matching the model's primary key exists in the database (any state, including soft-deleted).
- **`assertModelMissing(model)`** — passes if no row matches the model's primary key.
- **`assertSoftDeleted(model)`** — passes if the model's row exists AND `deletedAt` is set. Requires `static softDeletes = true` on the model.
- **`assertNotSoftDeleted(model)`** — passes if the row exists AND `deletedAt` is null.

Pairs with the existing `assertDatabaseHas` / `assertDatabaseMissing` / `assertDatabaseCount` / `assertDatabaseEmpty`, but skips the explicit table-name + attributes form when you already have a Model in hand. Resolves `static table` + `static primaryKey` from the model's constructor — clear errors when the model isn't a proper persisted entity (no `static table`, no primary-key value).

Also exports a new public type `TestModelLike` describing the minimum shape these helpers accept.

Found by the Phase 3 testing-ergonomics audit (cluster 3 of 4).
