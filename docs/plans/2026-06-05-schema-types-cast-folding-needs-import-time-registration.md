# schema:types cast-folding never sees app models — registration is first-query, not import-time

> **STATUS: ✅ CLOSED (2026-06-07).** Option 2 (model sweep) shipped in #934; the
> runtime json-binding half shipped in #964; option 3 (blueprint-intent folding)
> shipped in the blueprint-intent PR — design record in the
> "Option 3 implementation" section at the bottom.

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
   comment's assumption; laziest fix. *(Not taken — option 2 bounded the fix to the
   CLI without changing runtime registration semantics.)*
2. **Explicit discovery for the generator.** ✅ **SHIPPED (#934).** `schema:types` /
   post-`migrate` regen sweep `app/Models/**` (`registerAppModels`) before
   collecting casts. Keeps runtime registration lazy; bounds the behavior to the CLI.
3. **Casts in migrations.** ✅ **SHIPPED (blueprint-intent PR, 2026-06-07).** The
   blueprint's declared column types fold into generation as a fallback layer for
   cast-less columns — `cast > blueprint intent > introspected storage type`. See
   the implementation record below.

Option 3 composes with 2 (blueprint intent for storage-level types, model casts for
`date`/`json`/custom refinements) — and that is exactly how it shipped.

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

## Option 3 implementation — blueprint-intent folding (✅ shipped 2026-06-07)

**Where the intent lives at generation time: replayed from the migration files
themselves.** Three candidate homes were on the table:

| Candidate | Verdict | Why |
|---|---|---|
| **Replay `database/migrations/` at generation time** | **chosen** | The migration files are already the committed source of truth. No state-table schema change, no extra artifacts, and — decisively — **retroactive**: every existing app's already-applied migrations contribute intent the first time the new generator runs. The import machinery (`discoverMigrations`) and the recording-builder seam (`pretendSchemaBuilder` precedent) both existed. |
| Persist intent in the `migrations` state table at migrate time | rejected | Needs a state-table column migration of its own; rows applied before the feature would carry no intent, so existing apps silently get nothing until a `migrate:fresh`. Intent would also be a second copy of what the files already say — a drift surface. |
| Sidecar file emitted per migration | rejected | N generated artifacts to commit and keep in sync per app; drifts when a migration is edited without re-emitting; pulls in nothing the replay can't recover on demand. |

**How the replay stays safe and honest** (`packages/database/src/native/schema/intent-replay.ts`):

- **Applied-only, in apply order.** Replay is filtered + ordered by the
  `migrations` state table, so a *pending* migration's intent (e.g. a future
  `.change()`) can never claim a type ahead of the live schema. No state table →
  no intent → today's behavior.
- **Pure ledger, no DB.** `Schema.*` calls hit an `IntentSchemaBuilder` (a
  `SchemaBuilder` subclass over an inert executor) that applies blueprints to an
  in-memory table→column→`ColumnType` ledger. `hasTable`/`hasColumn` answer from
  the ledger — i.e. the declared schema *as of that point in the sequence* —
  which is more historically faithful than asking the fully-migrated live DB.
- **Runtime statements can NEVER re-execute.** A migration's `up()` may contain a
  `DB.statement(...)` backfill or Model writes; re-running those on every
  `schema:types` would corrupt data. The replay window arms a guard
  (`intent-guard.ts`) checked in `instrumentExecutor` — the single funnel every
  `NativeAdapter` statement flows through (write executor, read replicas,
  transaction scopes) — which throws `NATIVE_INTENT_REPLAY`. The replayer catches
  per-migration: intent recorded *before* the throw is kept (those ops did run
  historically), the remainder is skipped, and the CLI prints a one-line note.
  Replay also binds with `pretend: true` so `Schema.connection()` refuses.
- **Degradation is always toward the status quo.** Any replay failure (missing
  file for an applied row, runtime statement, ledger-divergent branch) loses
  *refinement only* — affected columns keep their cast/introspected types. Intent
  can never produce a type the old generator wouldn't at least have fallen back to.

**Which intents fold** (`blueprintIntentToTs`, deliberately conservative):

- `boolean` → `boolean` — writes are safe on every driver (sqlite maps
  `true`/`false` → 1/0); reads are `0`/`1` on sqlite without the cast — the
  documented 90%-case trade-off this doc's option 3 named (truthiness identical;
  strict `=== true` needs the cast).
- `json`/`jsonb` → `unknown` — sound in both directions everywhere: sqlite reads
  raw TEXT (`string ⊆ unknown`) and the binding funnel (#964) JSON-stringifies
  object/array writes, which the old affinity type `string` wrongly rejected.
- **Date family → not folded.** On sqlite a cast-less column reads as TEXT *and*
  better-sqlite3 rejects a `Date` binding — emitting `Date` would make tsc bless
  writes that throw at runtime. The `date`/`datetime` cast (parses reads AND
  serializes writes) is the correct tool; pg/mysql introspection already says `Date`.

Wiring: `runNativeSchemaTypes` (orm) → `collectMigrationIntent` (best-effort) →
`adapter.generateSchemaTypes(cwd, models, intent)` → `collectSchemaTypes` →
`resolveColumnType` precedence `cast > intent > storage`. Tests:
`packages/database/src/native/schema/intent-replay.test.ts` (ledger semantics,
guard, precedence, live-sqlite folding) + the `migrate` e2e in
`packages/orm/src/commands/schema-types.test.ts`.
