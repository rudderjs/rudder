---
"@rudderjs/orm": minor
---

Add polymorphic relations: `morphTo`, `morphMany`, `morphOne`. Three new `RelationDefinition` variants with thin runtime resolution via existing `where()` chains; no adapter contract change.

The polymorphic side carries `{morphName}Id` + `{morphName}Type` columns in **camelCase** (a deliberate divergence from Laravel's snake_case for ORM consistency). The discriminator value defaults to the parent class name; override with `static morphAlias = 'post'` for rename-safe storage. `morphTo` takes a closed `types: () => [...]` list of allowed targets, with a dev-mode collision guard against duplicate discriminators.

`Model.morph(name, parent)` is a write helper that builds the `{ nameId, nameType }` payload for spreading into `create()`/`update()`. `morphToMany` / `morphedByMany` remain deferred (drop to the adapter).

Unblocks pilotiq's `RelationManager` auto-wiring for polymorphic resources.
