---
"@rudderjs/orm": minor
---

Add `Model.firstOrNew(attrs, values?)` and a `Model#exists` getter. `firstOrNew` returns the first row matching `attrs`, or a new **unsaved** instance filled with `attrs` merged with `values` (through the `fillable`/`guarded` policy) when none matches, mirroring Laravel. The new `exists` getter reports whether an instance is backed by a persisted row, letting callers branch with `if (!user.exists) await user.save()`. `exists` is `true` after a read/`create()`/`save()`/`hydrate()`, `false` for a freshly built instance, and `false` again after a hard `delete()` (soft deletes keep it `true`).
