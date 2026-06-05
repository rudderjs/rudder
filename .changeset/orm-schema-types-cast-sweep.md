---
"@rudderjs/orm": patch
---

fix(orm): `schema:types` / post-`migrate` generation now actually folds `static casts` into the typed registry

Cast folding read `ModelRegistry.all()`, but models register lazily on their first query — which never fires during a CLI generation run — so the registry was always empty at generation time and a `t.boolean()` column with `static casts = { col: 'boolean' }` still generated `col: number`, for every app, always. The generator now sweeps `app/Models/**` (importing each model module, tolerating unloadable files) before collecting casts. Models living outside `app/Models/` can self-register via `ModelRegistry.register(TheModel)` in a provider.
