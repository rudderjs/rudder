---
"@rudderjs/orm": minor
---

feat(orm): add `.lean()` read mode for plain-record reads

`Model.query().lean().get()` (and `.first()`/`.all()`/`.find()`/`.paginate()`/`.pluck()`/`.value()`, plus the `Model.lean()` static) now return the plain adapter records instead of hydrated Model instances, skipping `Model.hydrate` per row.

Profiling the comparative ORM benchmark suite showed per-row hydration (`new Model()` + `Object.assign` + the dirty-tracking baseline) is ~75% of the cost of a bulk `get()`. `.lean()` bypasses it: a 1,000-row `get()` drops from ~920µs to ~230µs (~4× faster) — for read-only/serialization paths (e.g. `res.json(await User.query().where(...).lean().get())`) where you don't need instance methods, dirty tracking, or relations.

Lean rows lose instance methods (`save`/`fill`/`toJSON`/`related`) and dirty tracking. In-SQL aggregates (`withCount` and friends) compose with `.lean()` (the alias lands on the plain row); eager loading (`.with(...)` / `withDefault`) is incompatible and throws a clear error rather than silently dropping the relation.
