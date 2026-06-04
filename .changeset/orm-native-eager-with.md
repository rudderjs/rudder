---
"@rudderjs/orm": minor
---

Native engine: `Model.with('relation')` now eager-loads direct relations (`hasOne`/`hasMany`/`belongsTo`/`belongsToMany`). The adapter advertises `eagerLoadStrategy: 'model-layer'` (same as Drizzle), so the ORM resolves them with one batched WHERE-IN query per relation, stitched onto the parents — previously a dev-warn no-op that returned rows without the relation populated. Constrained eager-load (`withWhereHas`) remains unsupported on native: chain `.whereHas(...)` for the filter plus `.with(...)` for the load.
