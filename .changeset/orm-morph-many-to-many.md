---
"@rudderjs/orm": minor
"rudderjs-playground": patch
"create-rudder-app": minor
---

feat(orm): polymorphic many-to-many — `morphToMany` and `morphedByMany`. Owning side reads/writes route through a shared pivot table carrying `{morphName}Id` + `{morphName}Type`; `attach` / `detach` / `sync` stamp and filter by the parent's discriminator. Inverse side declares one relation per concrete inverse target (`Tag.posts`, `Tag.videos`) — keeps lookup deterministic without an inverse-side types list. Auto-installed accessors mirror the `belongsToMany` shape; declare an explicit override (`tags() { return Model.morphToMany(this, 'tags') }`) for typed wrappers (do not use a class field — it shadows the prototype method). Playground `/demos/polymorphic` extended with the Tag fan-out; scaffolder cascades the same demo into newly created apps.
