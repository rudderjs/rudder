---
"@rudderjs/orm": minor
---

feat(orm): factory relationship building + `Model.factory()` + mass-assignment bypass

Closes the three Laravel-parity gaps in `ModelFactory` (gap-analysis §8 factory arc):

- **`Model.factory()` entry point** — link a factory with `static factoryClass = UserFactory` on the model, then call `User.factory()` (≡ `UserFactory.new()`), chaining the same verbs (`.state()`, `.with()`, `.has()`, `.for()`, `.create()`, `.make()`). Unlinked models throw a clear error.
- **Relationship building** — `has(childFactory, count?, relationName?)` (hasMany/hasOne children with the parent FK set), `for(parentFactory, relationName?)` (belongsTo — create the parent first, set this row's FK), and `hasAttached(relatedFactory, count?, pivotData?, relationName?)` (belongsToMany — create related rows and attach through the pivot). FKs resolve from `static relations`; the relation name is inferred when a single relation of the right kind points at the other model. Polymorphic relations are not yet supported (clear error).
- **Mass-assignment bypass** — factory `create()` now persists via `forceFill()` + `save()` instead of `Model.create()`, so a guarded model still receives every factory attribute (Laravel behavior). Observer events (`creating`/`created`/`saving`/`saved`) still fire; `make()` is unaffected.

`ModelFactory.new()` also accepts concrete-generic factories (`extends ModelFactory<{ ... }>`) and returns the precise factory type.
