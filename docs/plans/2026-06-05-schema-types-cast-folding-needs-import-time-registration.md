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

## Related runtime gap — json columns reject object payloads (✅ CLOSED, found 2026-06-05)

The type half above was fixed in #934 (schema:types sweeps `app/Models` before
folding). The *runtime* half was closed 2026-06-07: the native compiler's
binding funnel (`Bindings.add` in `packages/database/src/native/compiler.ts`)
now JSON-stringifies plain-object and array bindings, so an UPDATE/INSERT
whose payload contains rich-state objects (e.g. panel form `Json` columns)
binds as JSON text instead of dying inside better-sqlite3 with the opaque
`TypeError: You cannot specify named parameters in two different objects`
(mysql2 silently mangled the same shape into `` `key`='val' `` SQL pairs; pg
survived only when the server described the param as json/jsonb). Chosen over
DDL/schema introspection because the funnel is synchronous (column-type lookup
is async), covers raw QB writes with no table metadata, and a plain-object
binding has exactly one meaningful SQL representation anyway. `Date`/`Buffer`/
class instances still pass through to the drivers. Declaring `static casts =
{ col: 'json' }` remains the way to get *parsed reads* on sqlite.

(Re-filed from the pilotiq-pro migration; this section replaces the
`*.refiled-local.md` duplicate of this doc.)
