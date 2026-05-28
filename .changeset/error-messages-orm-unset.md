---
'@rudderjs/orm': patch
---

ORM "unset relation key" and "unsaved model" error messages now distinguish `null/undefined` from `not selected` and name the recovery step instead of leaving the user to figure it out.

- **`Cannot resolve "<relation>" on <Model>`** — `belongsTo`, `hasOne`, `hasMany`, `belongsToMany`, `morphToMany`, `morphedByMany`, and pivot lazy-fetch deferred-query throws now end with: `… is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.` Same shape across all six call sites in `packages/orm/src/index.ts` plus `packages/orm/src/relations/pivot-deferred.ts`.
- **`Cannot resolve morphTo "<relation>" on <Model>`** — was `commentableId/commentableType unset.` now `… is null/undefined. Save the morph host first, or assign both columns before calling .related().`
- **`Cannot {refresh,delete,restore,increment,decrement} a <Model> without a primary key`** — now ends with `. Call .save() / Model.create() first so a primary key is assigned.` across all five instance lifecycle methods.

No behavior change — only message text. Tests that asserted on the literal `is unset` / `commentableId/commentableType unset` substrings were updated to the new wording (`is null\/undefined`). Found by the Phase 2 error-message audit.
