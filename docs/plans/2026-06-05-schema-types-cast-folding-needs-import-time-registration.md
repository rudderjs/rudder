# schema:types cast-folding never sees app models — registration is first-query, not import-time

**Filed by:** pilotiq (downstream), 2026-06-05
**Affects:** `@rudderjs/orm` — `schema:types` / post-`migrate` registry generation
**Severity:** paper cut with a confusing failure mode (docs promise behavior that can't trigger)

## Symptom

`Model.for<'table'>()`'s docs say `static casts` refine the generated registry types
("a `boolean`/`date`/`json` cast surfaces as `boolean`/`Date`/the cast's type rather
than the raw column affinity"). In practice the registry always emits the raw storage
type — e.g. a `t.boolean('featured')` column with `static casts = { featured: 'boolean' }`
on the model still generates `featured: number`.

Hit while migrating the pilotiq playground onto the native engine: after declaring
casts and re-running `rudder schema:types`, `Article.update(id, { featured: !r.featured })`
fails tsc with `'boolean' is not assignable to type 'number'`.

## Cause

`collectRegisteredModelCasts()` (packages/orm/src/commands/migrate.ts ~407) walks
`ModelRegistry.all()`, and its comment assumes *"Only models imported during boot are
registered"*. But registration actually happens lazily on **first query** —
`ModelRegistry.register(this)` lives inside `static query()` / `_hydratingQb` wiring
(packages/orm/src/index.ts ~2369, ~2439), not in a static initializer. A CLI boot
(`migrate` / `schema:types`) imports models (via providers → app code) but never
queries them, so the registry is empty at generation time and zero casts fold in —
for every app, always.

## Suggested directions (pick one)

1. **Import-time registration.** Register in a `Model` static-init side effect when
   `static table` is set (e.g. via a base-class `static {}` block reading
   `new.target`-style, or in `getTable()` accessor memoization). Matches the existing
   comment's assumption; laziest fix.
2. **Explicit discovery for the generator.** `schema:types` glob-imports
   `app/Models/**/*.ts` (the same convention the registry file lives under) before
   collecting casts. Keeps runtime registration lazy; bounds the behavior to the CLI.
3. **Casts in migrations.** Let the blueprint record intent (`t.boolean()` already
   knows it's a boolean) and have the generator emit `boolean` for it on sqlite
   instead of INTEGER affinity — covers the 90% case without touching models at all.

Option 3 composes with 1/2 (blueprint intent for storage-level types, model casts for
`date`/`json`/custom refinements).

## Downstream workaround (current)

Pilotiq playground dropped the casts and writes raw 0/1 integers with a comment
pointing here (`playground/app/Models/Article.ts`). Revisit once fixed.
