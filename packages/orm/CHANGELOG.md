# @rudderjs/orm

## 1.12.8

### Patch Changes

- e300385: ORM CLI commands (`db:push`, `migrate`, `make:migration`, `db:generate`) now fail with a clean error line instead of dumping a Node stack trace when the underlying tool exits non-zero. The subprocess (Prisma / drizzle-kit) already prints its own actionable message via inherited stdio (e.g. Prisma's "We found changes that cannot be executed…"), so `exec()` now throws a `CliError` — which the `rudder` CLI renders as a single red message + the original exit code — rather than a plain `Error` that surfaced as a stack trace. Found by dogfooding `db:push` against a schema-drifted dev database.
- Updated dependencies [bdfb88c]
  - @rudderjs/console@1.2.0

## 1.12.7

### Patch Changes

- 14a50d9: Second round of CodeQL source hardening.

  - `@rudderjs/orm` (**security**) — `make:migration <name>` ran through `spawn(..., { shell: true })` (load-bearing on Windows, where the `pnpm` shim is `pnpm.cmd`), so a crafted name (`pnpm rudder make:migration "x; rm -rf ."`) was a shell-injection vector. The migration name — the only caller-influenced token in the command — is now validated against a strict identifier allowlist (`assertSafeName`) at both the Prisma and Drizzle sink sites; everything else in the command is a hardcoded literal.
  - `@rudderjs/ai` — the `web_fetch` tool's HTML→text extraction now removes `<script>`/`<style>` blocks with a tag-filter-safe regex (tolerates `</script >`) and strips remaining tags iteratively to a fixed point. Output is fed to the model as text, never rendered as HTML — this improves extraction robustness, not a security boundary. New `htmlToText` export.
  - `@rudderjs/mail` — extracted a shared `stripHtmlTags` helper (loop-to-stable tag removal) used by the Markdown text-alternative and the LogAdapter preview, replacing two single-pass strips.
  - `@rudderjs/support` — `ConfigRepository.set()` now guards prototype-polluting keys (`__proto__`/`constructor`/`prototype`) with a literal comparison directly at each assignment site instead of an upfront set-membership check; behavior is unchanged.

## 1.12.6

### Patch Changes

- a39a983: fix(migrate:status): report cleanly instead of crashing with a JS stack trace

  `prisma migrate status` exits non-zero for _informational_ states (drift, pending migrations, or a `db:push`-managed DB with no migrations dir) — not just hard failures. The migrate command wrapper threw on any non-zero exit, so `rudder migrate:status` on a valid `db:push` project (the scaffolder/dev default) dumped a JS stack trace + `Error: Migration command failed (exit 1)`. `migrate:status` now tolerates the non-zero exit: it surfaces Prisma's own output and preserves the exit code (so CI can still gate on drift) without throwing. The other migrate commands still throw on failure.

## 1.12.5

### Patch Changes

- e732529: Guard the top-level `process.env` read in the ORM main entry so `@rudderjs/orm` evaluates in browser bundles. Since 1.12.4 the `RUDDER_ORM_TRACE` diagnostic read `process.env` unguarded at module top level, throwing `process is not defined` whenever a `Model` was reachable from a client bundle — which broke SPA navigation in Vike apps (React never hydrated). Now guarded with `typeof process !== 'undefined'` (same for the in-`morphTo` `NODE_ENV` dev-check); server behavior is unchanged.

## 1.12.4

### Patch Changes

- c8a43da: Dev HMR: `ModelRegistry.register()` now re-points at a re-imported model class instead of silently ignoring it.

  A dev re-boot re-evaluates `app/Models/*.ts`, producing a new class identity with the same `name`. The old guard (`_store.models.has(name)`) ignored it — leaving the registry pointed at the stale class and the fresh class's `belongsToMany`/morph accessors never installed on its prototype. A consumer that introspects the model (e.g. a resource schema-builder walking relations) then sees a half-wired model and can produce an incomplete schema persistently, with no self-recovery. A same-name but different-identity registration now updates the map and re-installs the accessors on the fresh prototype. No-op in production (a model is imported once, so the identity never differs) and for the exact same class.

## 1.12.3

### Patch Changes

- b7e918d: Trace the `count()` read terminal under `RUDDER_ORM_TRACE` (it previously fell through the proxy's pass-through and logged no terminal line). Without it, a list view's separate total/badge `count()` showed up as a `build` with no matching terminal — masquerading as a "dropped" `paginate` in the REOPEN #2 diagnosis. The read surface is now 1 `build` : 1 terminal, so the trace is unambiguous.

## 1.12.2

### Patch Changes

- e200375: Extend `RUDDER_ORM_TRACE` upstream to localize the REOPEN #2 wedge. The first probe showed the wedged query emits no read-terminal line at all — so the failure is upstream of `get`/`paginate`. This adds two more line types: `[orm] build …` at query construction (its absence proves `Model.query()` was never reached → the wedge is above the ORM), and `[orm] THREW <terminal> … :: <error>` when a terminal's adapter call throws and is re-thrown (the empty-not-error symptom means something swallows it upstream; the message names the real failure). Still zero overhead when the env var is off.

## 1.12.1

### Patch Changes

- 5852649: Add `RUDDER_ORM_TRACE=1` dev diagnostic: logs one line per read terminal (`find`/`first`/`get`/`all`/`paginate`) with the model name, a stable class-identity tag, resolved table, the adapter-object identity, applied soft-delete/global-scope filters, and the row count returned.

  Built to diagnose the "booted-ORM path returns empty after a dev re-boot, no error" residual (the HMR reboot-window plan's REOPEN #2): because the symptom is empty-not-error, the trace line surfaces which cause is in play — a wrong table, a stale re-imported model class (its `class=#N` tag differs from a working query's), a swapped adapter (`adapter=#M`), or a scope/soft-delete filtering everything out. Zero overhead when the env var is unset (every call early-returns). Class/adapter tags are stable across re-boots (this module is externalized, not re-evaluated), so re-imported `app/Models/*` deliberately get fresh tags — that contrast is the signal.

## 1.12.0

### Minor Changes

- 6652117: Thread `Model.primaryKey` through the `OrmAdapter` contract so models with
  `static primaryKey = 'uuid'` (or any non-`id` PK) work on both adapters.

  `OrmAdapter.query(table, opts?)` now accepts an optional `OrmAdapterQueryOpts`
  with a `primaryKey` field. `Model._q()` + `Model.query()` thread the model's
  configured `primaryKey` through it. The Prisma adapter, which previously
  hardcoded `where: { id }` on every mutation method, now emits
  `where: { [primaryKey]: id }` — fixing `find` / `update` / `delete` / `restore`
  / `forceDelete` / `increment` / `decrement`. The Drizzle adapter, which
  previously read a single adapter-global `primaryKey` from `drizzle()` config,
  now lets the per-query opts override it — so monorepos with mixed PKs
  (`users.id` + `subscriptions.uuid`) work without forcing every model onto the
  same PK.

  The contract widen is fully backwards-compatible: `opts` is optional, both
  adapters fall back to the historical `'id'` (Prisma) / adapter-global
  (Drizzle) when no opts are threaded. Third-party adapters that haven't
  been updated keep working for `id`-PK models.

  Closes Phase 2 of `docs/plans/2026-05-21-framework-orm-correctness.md`.
  Required prerequisite for the Phase 1 `find()` fix shipped in #582 to work
  correctly with non-`id` PK models.

### Patch Changes

- 41f68b1: Fix the deferred-pivot proxy used by `parent.related('tags')` / `.related('roles')`
  on `belongsToMany`, `morphToMany`, and `morphedByMany` relations.

  **Race fix.** The proxy previously captured `lastPivotRows` in a factory
  closure shared across terminal calls. `Promise.all([qb.get(), qb.get()])`
  interleaved `buildResolved()` / `postProcess()` and the second terminal
  stamped pivot columns using the _other_ call's pivot rows (or `[]` if it
  got there before the lookup landed). `buildResolved` now returns the
  QueryBuilder _and_ the pivot rows for the current call together; they're
  threaded into `postProcess(result, terminal, pivotRows)` per-invocation.

  **Unsupported chain methods now throw.** Calling `.whereHas(...)`,
  `.withCount(...)`, `.whereGroup(...)`, `.loadCount(...)` etc. on a deferred
  pivot relation previously hit the Proxy's `get` trap, returned `undefined`,
  and silently no-oped — the user's intent dropped on the floor. The proxy
  now throws on any string property that looks like a query-builder method
  (`where*`, `with*`, `load*`, `or<X>*`) but isn't in the recorded chain set.
  Runtime-internal access (`Symbol.iterator`, `then`, `toString`, …) still
  returns `undefined`, so `await qb`, spreads, and comparisons continue to
  work as before.

  Closes Phase 5 of `docs/plans/2026-05-21-framework-orm-correctness.md`.

- Updated dependencies [6652117]
- Updated dependencies [3e60f95]
  - @rudderjs/contracts@1.8.0

## 1.11.0

### Minor Changes

- e8707af: feat: `make:factory` + `make:seeder` scaffolders, plus dev-mode loader fix

  Completes the `make:*` family. Both scaffolders mirror existing patterns (`make:migration` / `make:agent` / `make:terminal`):

  ```bash
  $ pnpm rudder make:factory User
  ✓ Factory created: app/Factories/UserFactory.ts

  $ pnpm rudder make:seeder Users
  ✓ Seeder created: database/seeders/UsersSeeder.ts
  ```

  Generated stubs match the **real** `ModelFactory` + `Seeder` abstract-class APIs (not the `Factory.define()` callback shape the plan doc misremembered): subclass + `protected modelClass` + `definition()` for factories, subclass + `async run()` for seeders. Factory stems infer the model name (`UserFactory` imports `User`). Seeder stems show the matching `<Name>Factory` import + `this.call(...)` composition example commented out.

  Phase 4 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Final phase — all four DX gaps now closed.

  ## Bundled fix (load-bearing): `loadPackageCommands` cwd-walks

  The cli's `tryImport(pkg, subpath)` was building bare specifiers (`<pkg>/<subpath>`) and dispatching to `import()`. When the cli runs in dev mode via `tsx node_modules/@rudderjs/cli/src/index.ts` (the pnpm symlink target), Node resolves those specifiers relative to the SOURCE file — `packages/cli/src/`, where pnpm-strict has no peer-package entries. The catch in `Promise.all(loaders.map(fn => fn().catch(() => {})))` silently swallowed every failure. **Every package-contributed `make:*` was a no-op in dev:** `make:agent`, `make:mcp-tool`, `make:terminal`, `make:migration` — all silently broken.

  Phase 4 surfaced it (my new `make:factory` wasn't registering); without the fix, this PR ships a non-functional scaffolder. Bundled per the load-bearing-fix rule.

  Fix: walk `<cwd>/node_modules/<pkg>/dist/<subpath>.js` directly + `pathToFileURL` for Windows portability. Same shape doctor's `load-package-checks.ts` already uses for the identical reason.

## 1.10.0

### Minor Changes

- 05054d0: `Model.with(...)` now resolves polymorphic relations — `morphOne`, `morphMany`, `morphTo`, `morphToMany`, `morphedByMany` — instead of throwing or forcing N+1.

  The Model layer detects polymorphic relation names, partitions them away from the adapter call (which keeps using Prisma's `include` / Drizzle's `with` for direct relations), and resolves them in batched IN-queries after the terminal hydrates. One query per `morph{One,Many}` relation, two for pivot-mediated `morph{ToMany,edByMany}`, one query per distinct discriminator for `morphTo`. Soft-deletes on the related table are respected automatically (queries route through the Model's own query path).

  **Before:** `Post.with('comments').all()` threw `Unknown field 'comments' for include statement on model 'Post'` on Prisma — apps were forced into N+1 via per-row `instance.related('comments').get()` calls.

  **After:** Single batched query. Playground bench (100 posts): N+1 lazy = 22.3 ms → eager = 1.5 ms = **14.9× speedup** on the canonical example.

  Direct relations (`hasOne` / `hasMany` / `belongsTo` / `belongsToMany`) keep going through the adapter unchanged — no behavior change. Out-of-scope for v1: nested polymorphic eager-load (`Post.with('comments.author')`) and constrained polymorphic eager-load (`Post.with('comments', q => q.where(...))`). See `docs/plans/2026-05-18-polymorphic-eager-load.md` for the design.

### Patch Changes

- 761142f: Fast-path `Model.toJSON()` when the model declares no `casts` / `attributes` / `appends` / `hidden` / `visible` and no per-instance visibility overrides — the default state for most app Models. The slow path runs three sequential `Object.entries` / `Object.fromEntries` passes plus per-key cast/accessor/visibility lookups, even when there's nothing to apply. The fast path skips straight to a single `{ ...this }` spread, which `JSON.stringify` would do internally anyway.

  Bench (playground, 100 `Post` instances, median of 100 runs of `JSON.stringify`): **160.9 µs → 98.6 µs (-39%)**. Model-vs-plain overhead drops from 85 µs to 21.5 µs — 75% of the per-instance serialization tax goes away. Every API endpoint returning Model instances benefits.

  Configured models (anything with casts / accessors / hidden / visible / appends / instance overrides) keep the existing slow-path semantics — verified by 4 new pinning tests plus the existing toJSON suite.

## 1.9.3

### Patch Changes

- 16f87a4: Fast-path `Model._fireEvent` to return synchronously when the class has no observers or event listeners — recovers ~0.5 ms on `.all()` over 5000 rows by avoiding 5000 empty microtask schedules for the per-row `retrieved` event.

  The slow path (observers or listeners present) is unchanged — it routes through `_fireEventSlow` which is still `async` with the original semantics. Internal-only refactor; no public API change.

- 4634586: Route `ModelRegistry`'s state (adapter, model map, listeners) through `globalThis` so it survives the case where `@rudderjs/orm` is loaded twice — typical in a Vite-bundled server where the framework bundles `@rudderjs/orm` inline but externalizes `@rudderjs/orm-prisma` / `@rudderjs/orm-drizzle`. Those adapter packages resolve their own copy of `@rudderjs/orm` from `node_modules` at runtime; without a shared store, `DatabaseProvider.boot()` would land on a different `ModelRegistry` class than the one Model handlers read from, producing a misleading `No ORM adapter registered` error on every DB route in prod.

  No public API change — same `set` / `get` / `getAdapter` / `register` / `all` / `onRegister` / `reset` surface. Same pattern as the ai/mcp/http/queue/sync/broadcast observer registries.

- bdfe575: Defer the dirty-tracking baseline build past `Model.hydrate()` — recovers ~1.8 ms on a 5000-row hydration when the rows are read-and-discarded (the dominant bulk-read pattern). For rows that ARE dirty-checked or saved, the snapshot materializes on first access; total work is unchanged, just shifted later.

  Internal refactor only — `getOriginal` / `getDirty` / `isDirty` / `wasChanged` / `save()` diff semantics are preserved. No public API change.

## 1.9.2

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/contracts@1.6.1

## 1.9.1

### Patch Changes

- d0db9f0: **`@rudderjs/boost`** — overhauled the generated agent guidelines output.

  Inspired by Laravel Boost's recent shape. Concrete changes:

  - **`CLAUDE.md` is now ~135 lines, down from ~1,350.** Replaced the inline content dump of every package guideline with structured pointers to `.ai/guidelines/<package>.md`. The full per-package content still lives in `.ai/guidelines/` — agents load it on demand.
  - **New structure** in `CLAUDE.md`: XML wrapper (`<rudderjs-boost-guidelines>`), `=== foundation rules ===` / `=== boost rules ===` / `=== skills activation ===` dividers, a Foundational Context section listing installed `@rudderjs/*` versions, a Boost MCP Tools section listing every exposed tool, and a Skills Activation section with explicit `**ACTIVATE when:** …` / `**SKIP when:** …` heuristics per skill.
  - **Skill frontmatter enriched.** Each `SKILL.md` now declares `license`, `appliesTo`, `metadata.author`, plus the new `trigger` and `skip` fields that drive the CLAUDE.md activation section. `appliesTo` is the new filter — skills install only when at least one of their target packages is present (override with `--include-all-skills`).
  - **Three skills modularized** into `SKILL.md` + `rules/*.md`:
    - `orm-models` (`@rudderjs/orm`) — split into 5 rule files (defining-models, querying, crud-and-observers, factories, resources).
    - `auth-setup` (`@rudderjs/auth`) — split into 5 rule files (provider-setup, guards-and-handlers, auth-views, gates-and-policies, email-and-password-reset).
    - `mcp-servers` (`@rudderjs/mcp`) — split into 5 rule files (tools, resources-and-prompts, server-assembly, transports, testing-and-di).
    - Each `SKILL.md` is now a compact Quick Reference (~40 lines) linking to the matching rule file. Rule files use paired Incorrect/Correct examples consistently.
  - **`boost.json`** now records the active skill list under a `skills` field.

  Migration: run `pnpm rudder boost:update` (or `boost:install`) to regenerate the new CLAUDE.md / boost.json / skill files. The old output is fully replaced — local edits to `CLAUDE.md` will be overwritten, same as before. Per-package guidelines and skills install paths are unchanged.

  No API breaks. The `@rudderjs/*` package bumps are guideline / skill content changes for packages that ship `boost/` directories.

## 1.9.0

### Minor Changes

- 924b863: **B7 Phase 3 — Drizzle pgvector adapter + `make:migration --vector` helper. Closes B7.** Drizzle apps now have feature parity with `@rudderjs/orm-prisma` for vector queries (incl. Phase 2.5 chained `.where()` composition + auto-embed). New `make:migration --vector` flag scaffolds the `CREATE EXTENSION` + `ALTER TABLE` + HNSW index migration so apps don't have to hand-write it.

  ```ts
  // 1. Schema (Drizzle)
  import { pgTable, integer, text } from "drizzle-orm/pg-core";
  export const documents = pgTable("documents", {
    id: integer("id").primaryKey(),
    content: text("content"),
    embedding: text("embedding"), // pgvector column — Drizzle has no native vector type yet
  });

  // 2. Generate the migration:
  //    pnpm rudder make:migration --vector documents embedding 1536
  //    → writes drizzle/20260511XXXXXX_add_embedding_vector_to_documents.sql

  // 3. Use vector queries the same way as Prisma:
  const docs = await Document.whereVectorSimilarTo(
    "embedding",
    queryEmbedding,
    { minSimilarity: 0.7 }
  )
    .where("tenantId", currentTenant)
    .limit(10)
    .get();

  // 4. similaritySearch from @rudderjs/ai works against Drizzle Models too —
  //    nothing changes at the agent layer.
  ```

  `@rudderjs/orm-drizzle`:

  - `whereVectorSimilarTo(col, query, opts?)` — accepts `number[]` (literal) or `string` (auto-embed via `opts.embedWith`). String form throws `MissingEmbedderError` if `embedWith` is missing; otherwise defers the embed to terminal time and lazy-loads `@rudderjs/ai` via `resolveOptionalPeer` (orm-drizzle adds `@rudderjs/ai` as an optional peer + `@rudderjs/support` as a regular dep — same wiring as orm-prisma).
  - `selectVectorDistance(col, query, alias)` — projects the distance as a column on each row.
  - Terminal `get()` / `first()` route to a new `_getViaVector` that issues raw SQL via `db.execute(sql\`...\`)`. Composes the chained WHERE clause by reusing the existing `buildConditions()`, so flat `.where()`/`.orWhere()`/ soft-delete /`whereRelationExists`-EXISTS subqueries (Phase 2.5 parity) all flow into the SQL alongside the vector clause.
  - Vector literal (`'[0.1,0.2,...]'::vector`) and user values bind through Drizzle's `sql` template — never string-interpolated. Operators come from a closed allow-list. Defense-in-depth SQL-injection test asserts a `'; DROP TABLE...` payload travels through bind params, not the SQL string.
  - Errors: `db.execute()` missing on the driver → `VectorStorageUnsupportedError` with hint to use a Postgres driver; unknown column → same error class with the column name; pgvector extension/operator missing → wrapped with `CREATE EXTENSION` guidance message (matches orm-prisma).
  - Still throws: `.orderBy()` (redundant — vector queries order by similarity), aggregates (`withCount` etc.), `count()` (vector queries are top-K, not count-shaped). `.with()` / `whereGroup` are silently no-ops on this adapter as they were before.

  `@rudderjs/orm`:

  - Extends the existing `make:migration` command with a `--vector <table> <column> <dimensions>` short-circuit (no new subpath — helpers live in `commands/migrate.ts`). Optional `--metric cosine|l2|inner-product` picks the HNSW index ops class.
  - Generates an ORM-detected migration file: Prisma → `prisma/migrations/<ts>_add_<col>_vector_to_<table>/migration.sql`; Drizzle → `drizzle/<ts>_add_<col>_vector_to_<table>.sql`. Falls back to Drizzle layout when no ORM is detected.
  - Prisma projects get a printed `schema.prisma` snippet showing `Unsupported("vector(N)")` + the `@@index([col(ops: VectorCosineOps)], type: Hnsw)` declaration, plus a reminder to enable the `postgresqlExtensions` preview feature.
  - Exports `buildVectorMigrationSql`, `buildPrismaSchemaSnippet`, `parseVectorFlag`, `writeVectorMigration` for testing and for apps that want to compose the SQL into a hand-rolled migration.

  **B7 closes with this PR.** Next Track B parity item is **B8** — hosted vector stores + `FileSearch` provider tool wrapping OpenAI/Gemini hosted stores. The local Prisma/Drizzle path B7 ships becomes B8's fallback when no hosted provider is configured.

  Plan: `docs/plans/2026-05-10-b7-vector-storage.md` (Phase 3 marked in flight; flips to ✓ shipped on merge).

- 6f63467: **B7 Phase 1 — vector storage foundations + Prisma pgvector adapter.** Foundation for the `similaritySearch()` agent tool (Phase 2) and Drizzle adapter + migration helper (Phase 3). Postgres + pgvector only in v1; Drizzle and non-Postgres connections throw `VectorStorageUnsupportedError`.

  ```ts
  import { Model, vector, type CastDefinition } from "@rudderjs/orm";

  class Document extends Model {
    static table = "document";
    static casts = {
      embedding: vector({ dimensions: 1536 }),
    } as const satisfies Record<string, CastDefinition>;

    embedding!: number[];
  }

  // Standalone vector query (v1 — chaining with .where() lands in Phase 2)
  const docs = await Document.query()
    .whereVectorSimilarTo("embedding", queryEmbedding, { minSimilarity: 0.4 })
    .limit(10)
    .get();

  // Project the cosine distance as a column for explicit ordering / display
  const ranked = await Document.query()
    .whereVectorSimilarTo("embedding", queryEmbedding)
    .selectVectorDistance("embedding", queryEmbedding, "score")
    .limit(10)
    .get();
  ```

  **`@rudderjs/orm` (new exports):**

  - `vector({ dimensions })` cast factory. Returns a `CastUsing` class capturing `dimensions` in its closure. On write: validates the array length matches `dimensions`, validates every element is a finite number, serializes to pgvector text format `'[0.1,0.2,...]'`. On read: parses the text format back to `number[]`. Already-array values pass through (idempotent on roundtrips through caches/serializers).
  - `VectorDimensionMismatchError` (`code: 'VECTOR_DIMENSION_MISMATCH'`) — thrown by the cast when a write attempts to persist a wrong-dim vector. Carries `column`, `expected`, `actual`.
  - `VectorStorageUnsupportedError` (`code: 'VECTOR_STORAGE_UNSUPPORTED'`) — thrown by adapters that don't support pgvector or are connected to a non-Postgres backend / a Postgres instance without the `vector` extension.
  - `MissingEmbedderError` (`code: 'VECTOR_MISSING_EMBEDDER'`) — thrown when `whereVectorSimilarTo(col, 'natural-language string')` is called without `embedWith`. Auto-embed itself lands in Phase 2; the error guards against accidental paid API hits.

  **`@rudderjs/contracts` (`QueryBuilder<T>` extensions, both optional):**

  - `whereVectorSimilarTo?(column, query, opts?)` — pgvector similarity filter. `query` can be `number[]` (literal embedding) or `string` (auto-embed via `AI.embed()` once Phase 2 lands; throws `MissingEmbedderError` in v1 unless `embedWith` is set, then throws "Phase 2" error). Default metric `'cosine'` (`<=>`); `'l2'` (`<->`) and `'inner-product'` (`<#>`) supported. `minSimilarity` is normalized to cosine `[-1, 1]` (higher = closer) so apps never see raw distance.
  - `selectVectorDistance?(column, query, alias)` — projects the cosine distance as a column for ordering / display. `0` = identical, `1 - alias` gives back similarity.

  Both optional on the contract — adapters that don't support pgvector simply omit them. Apps that need vector storage on a non-supporting adapter get a clear `Cannot read properties of undefined` typeguard rather than a silent miss.

  **`@rudderjs/orm-prisma`** implements both. Uses `prisma.$queryRawUnsafe` to construct the pgvector SQL because Prisma's standard fluent API has no way to express pgvector ops. `_getViaVector` switches the terminal path on `get()` and `first()`; identifiers are double-quoted defensively. pgvector errors (`operator does not exist`, `type "vector" does not exist`, `extension "vector"`) are caught and re-thrown as `VectorStorageUnsupportedError` with a runnable `CREATE EXTENSION` hint.

  **v1 limitations** (deliberate, documented — lifted in Phase 2):

  - Chaining vector queries with `.where()` / `.orWhere()` / `.whereGroup()` / relation predicates throws — vector queries must be standalone.
  - Eager loading via `.with()` alongside vector queries throws.
  - `withCount` / aggregates alongside vector queries throws.
  - `.orderBy()` alongside vector queries throws (redundant — vector queries order by similarity).
  - `.count()` with a vector clause throws.
  - Auto-embed (`whereVectorSimilarTo(col, 'string')`) throws — pre-embed via `AI.embed()` and pass `number[]` for now.

  **`@rudderjs/orm-drizzle`** ships stub implementations of both methods that throw `VectorStorageUnsupportedError('drizzle', ...)` — Drizzle pgvector support lands in Phase 3 alongside the `pnpm rudder make:migration --vector <table> <column> <dim>` helper.

  **Out of this phase, deferred:**

  - **Phase 2 — `similaritySearch()` agent tool** in `@rudderjs/ai`. Wraps a Model + column as a drop-in agent tool with auto-embed via `AI.embed()`, configurable result projection, tag-based scoping. Lifts the v1 standalone-query restriction.
  - **Phase 3 — Drizzle adapter + migration helper.** Same SQL shape via Drizzle's `sql\`...\``template;`pnpm rudder make:migration --vector`scaffolds the`CREATE EXTENSION`+`ALTER TABLE`+`CREATE INDEX hnsw` snippets.
  - **pgvector-backed `EmbeddingUserMemory`.** A4 Phase 5's per-user memory uses Bytes packing + JS cosine; B7 targets app-scale corpora. Optional rewire after B7 ships if a customer reports recall slowdown.

  Plan: `docs/plans/2026-05-10-b7-vector-storage.md`.

### Patch Changes

- Updated dependencies [f133d08]
- Updated dependencies [6f63467]
  - @rudderjs/contracts@1.6.0

## 1.8.1

### Patch Changes

- 4d4991c: fix(orm,queue-bullmq,queue-inngest): Tier 3 quality sweep — JSON parse guards, BullMQ double-execution fix, dispatch serialization errors
- Updated dependencies [f867181]
  - @rudderjs/contracts@1.4.0

## 1.8.0

### Minor Changes

- 2398242: Read, update, and per-id sync of pivot-table extra columns on `belongsToMany` (and morph siblings).

  - **`QueryBuilder.withPivot(...columns)`** — declare which pivot columns to surface on each loaded related row. Stamps `row.pivot = { col: value, ... }` after the second-step query resolves. No-op when not called; calling with zero args throws so the contract is explicit. Works on `belongsToMany`, `morphToMany`, and `morphedByMany`.
  - **`BelongsToManyAccessor.updatePivot(relatedId, data)`** — patch extras on an existing pivot row without detach/re-attach. Locates the pivot row by `(foreignPivotKey = parentVal, relatedPivotKey = relatedId)` and writes only the supplied columns; returns the number of rows updated (0 when the link doesn't exist). Same shape on the morph siblings — the discriminator column is included in the WHERE.
  - **`sync(perIdPivotMap)` overload** — `sync({ id1: { role: 'owner' }, id2: { role: 'editor' } })` reconciles a desired set with per-id pivot data. Return value gains `updated: unknown[]` alongside the existing `attached` / `detached`. The single-`Record` (`flatPivot`) form is unchanged.
  - **`QueryBuilder.updateAll(data)`** — bulk update every row matching the chained `where`s. Returns the affected row count. Prisma routes through `updateMany`; Drizzle uses `update().set().where()`. Parallels the existing `deleteAll()`.

  Pure addition — no behavior change for code that doesn't call the new APIs. Adapter test fixtures and in-memory `QueryBuilder` test doubles pick up the two new method stubs.

- aa526b3: Nested AND/OR query groups via `whereGroup(fn)` and `orWhereGroup(fn)`.

  ```ts
  User.query()
    .where("status", "active")
    .whereGroup((g) => g.where("priority", "high").orWhere("starred", true));
  // WHERE status = 'active' AND (priority = 'high' OR starred = TRUE)
  ```

  - **`QueryBuilder.whereGroup(fn)` / `orWhereGroup(fn)`** — the callback receives a fresh sub-builder. Calls inside it compose into a single grouped clause that's spliced back into the parent under AND or OR. Sub-builders are themselves `QueryBuilder<T>`, so `whereGroup` nests arbitrarily deep and `whereHas` works inside the callback.
  - **Sub-builder terminals throw** — calling `get`/`first`/`find`/`count`/`paginate`/etc. on the inner builder errors with `Sub-builder is for where* chaining only — call get() on the parent builder.` Empty groups (`whereGroup(g => g)`) are a no-op.
  - **Adapters** — Prisma emits `AND: [...]` / `OR: [...]` array form only when groups are present, so the existing flat-spread shape is preserved for code that doesn't use the new API. Drizzle wraps the captured clauses with `and()` / `or()` SQL helpers and appends to the parent.

  Pure addition — no behavior change for existing `where`/`orWhere` chains. Mirrors the callback shape of the existing `whereHas(rel, fn)` API.

### Patch Changes

- Updated dependencies [2398242]
- Updated dependencies [aa526b3]
  - @rudderjs/contracts@1.3.0

## 1.7.1

### Patch Changes

- 17b3c33: Two correctness fixes on the parity surface that just landed:

  - **`whereHas` constrain callback now throws on `orWhere`.** Previously, `Model.whereHas('rel', q => q.where('a', 1).orWhere('b', 2))` silently dropped the `orWhere` clause — the recorder Proxy only intercepted `where`. The contract's `WhereClause` has no boolean (`and` | `or`) flag, so OR semantics can't round-trip to the adapter; throw a clear "not supported in v1" error instead of producing a wrong query. Same shape as the existing nested-`whereHas` error.

  - **`instance.delete()` now reflects soft-delete state locally.** On a model with `static softDeletes = true`, `await user.delete()` previously left `user.deletedAt` stale (still `null`), so `user.trashed()` returned `false` immediately after delete and the dirty-tracking baseline diverged from the database. The instance method now sets `deletedAt = new Date()` locally and calls `_syncOriginal()` after the static delete completes — `trashed()` returns `true`, `isDirty()` returns `false`. Hard-delete models are unchanged.

## 1.7.0

### Minor Changes

- 1805d0c: Aggregate eager loading — `withCount` / `withSum` / `withMin` / `withMax` / `withAvg` / `withExists` on the QueryBuilder + `loadCount` / `loadSum` / `loadMin` / `loadMax` / `loadAvg` / `loadExists` / `loadMissing` on instances (Laravel parity #2 plan #3).

  Closes the N+1 footgun for hot list pages without dropping into the adapter. Result columns are stamped onto each parent under deterministic camelCase aliases (`postsCount`, `postsSumViews`, `subscriptionExists`).

  ```ts
  // Multi-row aggregate (parent query)
  await User.query().withCount("posts").get(); // user.postsCount
  await User.query().withSum("posts", "views").paginate(1); // user.postsSumViews
  await User.query()
    .withCount({
      posts: (q) => q.where("published", true).as("publishedPosts"),
    })
    .get(); // user.publishedPostsCount

  // Per-instance aggregate
  const user = await User.find(1);
  await user!.loadCount("posts");
  console.log(user!.postsCount);

  // Eager-load only what's missing
  await user!.loadMissing("profile", "posts");
  ```

  **Notes:**

  - `withCount` on `belongsTo` throws (always 0 or 1; use `withExists` instead). On `morphTo` throws (related table is dynamic).
  - Aggregate columns are tagged on a `Symbol.for('rudderjs.orm.aggregates')` Set so `model.save()` strips them before write — they never reach the underlying schema.
  - Soft deletes on the related model are applied automatically — the adapter ANDs `deleted_at IS NULL` into the aggregate subquery.
  - Closure constraints (`q => q.where(...).as(...)`) cover the same surface as `whereHas` constraints.

  **Adapter changes:**

  - New `withAggregate(requests: AggregateRequest[])` method on `QueryBuilder<T>` (required). Out-of-tree adapters implement this single normalized shape — the public `withCount` / `withSum` / etc. overloads collapse into `AggregateRequest[]` in the orm Model layer.
  - New `_aggregate(fn, column?)` method on `QueryBuilder<T>` (required, `@internal`) — single-scalar terminal used by the per-instance `loadCount` / `loadSum` / etc.
  - `QueryState.aggregates: AggregateRequest[]` extends the existing state shape.
  - `@rudderjs/orm-prisma` uses Prisma's native `_count.select` for direct count/exists (no second round-trip) and second-batch `groupBy` for polymorphic / pivot / numeric aggregates.
  - `@rudderjs/orm-drizzle` emits one correlated subselect per aggregate in the SELECT list. Pivot-mediated aggregates JOIN through the pivot table when soft-deletes / constraints / numeric columns are involved.

  Additive — no migration needed for existing calls.

- a089110: Eloquent-style dirty tracking on Model instances (Laravel parity #2 PR1).

  Every Model instance now keeps an attribute snapshot as of the last
  `hydrate()` / `save()` / `refresh()` and exposes six methods over it:

  - `isDirty(key?)` / `isClean(key?)` — whether any (or the named) attribute
    has been changed since the last save / load / refresh.
  - `wasChanged(key?)` — whether the most recent `save()` actually
    persisted a change. Stays true until the next save / refresh.
  - `getOriginal(key?)` — snapshot value(s) as of the last save / load /
    refresh.
  - `getChanges()` — diff of attributes that changed during the most
    recent `save()`.
  - `getDirty()` — diff of attributes currently dirty (unsaved).

  Equality is strict for primitives, `getTime()` for Date, and structural
  JSON for arrays / plain objects (matching Eloquent's
  `originalIsEquivalent`). `refresh()` discards pending writes and
  re-baselines. `increment()` / `decrement()` re-baseline so the bumped
  counter is not reported as dirty.

  Additive — no existing API changes, no migration needed. See the orm
  README's "Dirty Tracking" section for full semantics and edge-case
  coverage.

- 5703439: Pruning — `Prunable` / `MassPrunable` markers + `pnpm rudder model:prune` (Laravel parity #2 plan #8).

  Models declaring `static prunable()` are picked up by the new `model:prune` command. Default `pruneMode = 'instance'` re-queries each chunk and calls `instance.delete()` per row — soft-deletes apply, `deleting` / `deleted` observers fire, optional `static pruning(model)` runs first. `pruneMode = 'mass'` (`MassPrunable`) runs a single `qb.deleteAll()` per chunk — no observers, no hooks, soft-deletes bypassed (mirrors the existing bulk-delete primitive).

  CLI flags: `--model=A,B`, `--except=A`, `--chunk=N`, `--pretend`. Schedule it with `scheduler.command('model:prune').daily()` — first-class retention hook with zero per-model wiring.

  Programmatic entry: `pruneModels({ models?, except?, chunk?, pretend? })` returns one `{ model, mode, count }` report per pruned model. Re-queries instead of `offset()` paging because deletions shift the cursor.

- ad3a531: Eloquent-style quiet event ops + `instance.restore()` (Laravel parity #2 PR2).

  Three instance methods that mute observer + listener events for a single
  operation, mirroring Eloquent's quiet variants:

  - `saveQuietly()` — persists without firing `saving` / `saved` /
    `creating` / `created` / `updating` / `updated`.
  - `deleteQuietly()` — deletes (or soft-deletes) without firing
    `deleting` / `deleted`.
  - `restoreQuietly()` — restores a soft-deleted row without firing
    `restoring` / `restored`.

  Plus `instance.restore()` — non-quiet symmetric counterpart to
  `instance.delete()`. Routes through the static `Model.restore()` so
  observers fire, refreshes the instance in place, and re-baselines the
  dirty-tracking snapshot.

  **Per-class isolation:** quiet ops mute only the calling class.
  Cascading observers that touch other classes still fire — wrap the
  cascade in a broader `Model.withoutEvents()` block if you need full
  silence.

  Additive — no existing API changes, no migration needed.

- fcc57f9: Eloquent-style relation predicates — `whereHas` / `whereDoesntHave` /
  `withWhereHas` / `whereBelongsTo` (Laravel parity #2 PR3).

  Filter a query by whether a relation has at least one matching row.
  The optional callback narrows the relation predicate further — chain
  plain `where()` calls inside it.

  ```ts
  await User.whereHas("posts", (q) => q.where("published", true)).get();
  await User.whereDoesntHave("posts").get();
  await User.withWhereHas("posts", (q) => q.where("published", true)).get();
  await Post.whereBelongsTo(user).get();
  await Comment.whereBelongsTo(post, "post").get();
  ```

  Supported relation types: `hasMany`, `hasOne`, `belongsTo`,
  `belongsToMany`, `morphMany`, `morphOne`, `morphToMany`, `morphedByMany`.
  `morphTo` is intentionally not supported — the related table is dynamic,
  so a single subquery can't represent it. Filter on `{morphName}Id` /
  `{morphName}Type` directly when you need that semantic.

  The four chainable methods are also exposed on `QueryBuilder` so
  they compose with flat `where()`/`orderBy()`/etc.

  **Adapter changes:**

  - New `RelationExistencePredicate` type in `@rudderjs/contracts` —
    carries the structural metadata adapters need (related table, parent /
    related columns, constraint wheres, optional `extraEquals` for morph
    discriminators, optional `through` for pivot relations).
  - New `whereRelationExists(predicate)` method on `QueryBuilder<T>`
    (required). Out-of-tree adapters need to implement it.
  - New optional `withConstrained(relation, wheres)` method on
    `QueryBuilder<T>` for constrained eager-load.
  - `@rudderjs/orm-prisma` uses native `some` / `none` filters for direct
    relations (`hasMany`/`hasOne`/`belongsTo`) — those relations must be
    declared in `schema.prisma` with the same name. Polymorphic and pivot
    paths route through a 2-step lookup so they work without a Prisma-
    declared relation. `withConstrained` maps to nested `include: { rel:
{ where } }`.
  - `@rudderjs/orm-drizzle` builds correlated `EXISTS (...)` /
    `NOT EXISTS (...)` subqueries via `exists()` / `notExists()`. Every
    related table referenced from a `whereHas` call must be registered via
    `tables: { ... }` on `drizzle()` config or
    `DrizzleTableRegistry.register(name, table)`. `withConstrained` is not
    yet implemented on Drizzle — `withWhereHas` falls back to plain
    `with(relation)`.

  Additive — no migration needed for existing calls.

### Patch Changes

- Updated dependencies [1805d0c]
- Updated dependencies [fcc57f9]
- Updated dependencies [a0b96f9]
  - @rudderjs/contracts@1.2.0

## 1.6.0

### Minor Changes

- 150b7e3: feat(orm): polymorphic many-to-many — `morphToMany` and `morphedByMany`. Owning side reads/writes route through a shared pivot table carrying `{morphName}Id` + `{morphName}Type`; `attach` / `detach` / `sync` stamp and filter by the parent's discriminator. Inverse side declares one relation per concrete inverse target (`Tag.posts`, `Tag.videos`) — keeps lookup deterministic without an inverse-side types list. Auto-installed accessors mirror the `belongsToMany` shape; declare an explicit override (`tags() { return Model.morphToMany(this, 'tags') }`) for typed wrappers (do not use a class field — it shadows the prototype method). Playground `/demos/polymorphic` extended with the Tag fan-out; scaffolder cascades the same demo into newly created apps.

## 1.5.0

### Minor Changes

- 096c0e1: Add polymorphic relations: `morphTo`, `morphMany`, `morphOne`. Three new `RelationDefinition` variants with thin runtime resolution via existing `where()` chains; no adapter contract change.

  The polymorphic side carries `{morphName}Id` + `{morphName}Type` columns in **camelCase** (a deliberate divergence from Laravel's snake_case for ORM consistency). The discriminator value defaults to the parent class name; override with `static morphAlias = 'post'` for rename-safe storage. `morphTo` takes a closed `types: () => [...]` list of allowed targets, with a dev-mode collision guard against duplicate discriminators.

  `Model.morph(name, parent)` is a write helper that builds the `{ nameId, nameType }` payload for spreading into `create()`/`update()`. `morphToMany` / `morphedByMany` remain deferred (drop to the adapter).

  Unblocks pilotiq's `RelationManager` auto-wiring for polymorphic resources.

## 1.4.0

### Minor Changes

- d6c2f4c: feat(orm): `belongsToMany` (many-to-many) relations

  Many-to-many is now first-class. Declare on `static relations` with `pivotTable` (required) and call `parent.related('roles').get()` for chainable reads through the pivot, or use the per-relation accessor (`user.roles().attach([1,2])`) for pivot mutations.

  ```ts
  class User extends Model {
    static override relations = {
      roles: {
        type: "belongsToMany",
        model: () => Role,
        pivotTable: "role_user",
      },
    } as const;
  }

  await user!.related("roles").where("active", true).get();
  await user!.roles().attach([1, 2], { addedBy: "admin" });
  await user!
    .roles()
    .attach({ 1: { addedBy: "admin" }, 2: { addedBy: "system" } });
  await user!.roles().sync([1, 3, 5]); // → { attached: [3, 5], detached: [2] }
  await user!.roles().detach();
  ```

  **Adapter contract additions** (`@rudderjs/contracts` patch — additive only, no breaks):

  - `QueryBuilder.insertMany(rows)` — bulk insert, no return value.
  - `QueryBuilder.deleteAll()` — delete every row matching the chained wheres, returns count.

  Both `@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle` implement the new methods. Third-party adapters need to add them; the existing surface is unchanged.

  **v1 limitations** (gated on real demand): pivot columns are not surfaced on read results, no `withTimestamps`, no polymorphic `morphToMany`. The deferred read query throws on mutation methods (`create`/`update`/`delete`/`insertMany`/`deleteAll`) — write the pivot via the accessor and the related rows via the related model directly.

### Patch Changes

- Updated dependencies [d6c2f4c]
  - @rudderjs/contracts@1.1.1

## 1.3.0

### Minor Changes

- 38b881b: Add atomic `increment` / `decrement` to the ORM. Final Tier 2 Eloquent parity item.

  ```ts
  // Static — atomic SQL UPDATE, returns hydrated instance
  await Post.increment(postId, "viewCount"); // +1
  await Post.increment(postId, "viewCount", 5); // +5
  await User.decrement(userId, "credits", 10, { lastSeen: new Date() }); // -10 + extras

  // Instance — same SQL, merges new value back onto the instance
  await post.increment("viewCount");
  ```

  The QueryBuilder contract gains `increment(id, column, amount?, extra?)` and `decrement(id, column, amount?, extra?)`. Prisma maps to `{ increment: n }` / `{ decrement: n }` field updates; Drizzle to a `sql\`${col} + ${n}\`` expression. Both run as a single atomic SQL UPDATE — safe under concurrent writes, no read-modify-write race.

  **Caveat — observers don't fire.** `increment` / `decrement` deliberately skip `updating` / `updated` / `saving` / `saved`. The observer payload would have to be either the delta (confusing) or the resolved value (would require a read, breaking atomicity). If you need observer hooks, read the row, compute the resolved value yourself, and call `Model.update()` instead.

  Custom adapters: third-party `OrmAdapter` implementations must add `increment` / `decrement` methods to their QueryBuilder. The signature is the same as `update`, plus `column` and `amount` parameters.

### Patch Changes

- Updated dependencies [38b881b]
  - @rudderjs/contracts@1.1.0

## 1.2.0

### Minor Changes

- 4036c3e: Enforce mass-assignment protection. `static fillable` (allowlist) and the new `static guarded` (denylist; pass `['*']` to lock everything) are now enforced on `Model.create()`, `Model.update()`, and `instance.fill()` — keys outside the policy are silently dropped before the data reaches the adapter. Both default to `[]` (no enforcement) so existing models that haven't set either keep working unchanged. When both are set, `fillable` wins.

  New escape hatch:

  - **`instance.forceFill(data)`** — mass-assign without applying the filter. Useful for trusted sources (factories, internal sync, fixtures).

  `instance.save()` continues to bypass the filter — properties set one-by-one (`user.role = 'admin'; await user.save()`) are intentional, not mass-assignment, so the protection doesn't apply. Internally this routes through new private `_doCreate`/`_doUpdate` paths that skip the filter while still firing observers and mutators.

  Heads-up for `firstOrCreate(attrs, values)`: the lookup `attrs` go through `create()` along with `values`, so they must be in `fillable` too — otherwise the lookup column won't be set on the new row. Add the lookup key to `fillable`, or build the record manually with `new Model().forceFill(...).save()`.

## 1.1.0

### Minor Changes

- 64bbff6: Hydrate query results into Model instances. Every read path (`find`/`first`/`all`/`paginate`/`where(...).first()`/`where(...).get()`/`create`/`update`/`restore`/`firstOrCreate`/`updateOrCreate`) now returns objects that are `instanceof Model` and carry the prototype chain. Adapters still return plain records — the Model wraps the QueryBuilder via a Proxy, so Prisma and Drizzle adapters didn't change.

  New instance methods on every hydrated record:

  - `save()` — inserts when the primary key is unset, otherwise updates. Routes through the static path so observers fire.
  - `fill(data)` — mass-assigns without persisting.
  - `refresh()` — re-reads the row and replaces fields in place. Throws `ModelNotFoundError` when the row is gone.
  - `delete()` — routes through the static so soft deletes and `deleting`/`deleted` observers behave the same as `Model.delete(id)`.
  - `replicate(except?)` — clones the instance without the primary key, `createdAt`/`updatedAt`/`deletedAt`, or any extra keys passed in.
  - `is(other)` / `isNot(other)` — identity by table + primary key.
  - `trashed()` — true when `deletedAt` is set.

  `Model.hydrate(record)` is the public escape hatch for wrapping plain records that didn't come through the adapter (cached JSON, fixtures).

  Internal serialization overrides moved from `_instanceHidden`/`_instanceVisible` to ECMAScript private (`#instanceHidden`/`#instanceVisible`) so they never appear in `Object.entries`, object spread, or `JSON.stringify`. `JSON.stringify(user)` and `Object.entries(user)` now produce wire-format-clean output suitable for direct Prisma writes and Telescope serialization.

  Note for downstream tests: assertions like `assert.deepStrictEqual(result, plainObject)` no longer hold for query results — node's `deepStrictEqual` checks prototypes. Compare via `{ ...result }` or assert `result instanceof Model`.

## 1.0.0

### Major Changes

- cd38418: ## RudderJS 1.0 — wave 1

  Graduate 29 framework packages from `0.x` to `1.0.0`. The first batch of `@rudderjs/*` packages is now public-API stable — breaking changes will require explicit major bumps and migration notes from here on.

  **No code changes** — this is a version-line reset. Existing `0.x` consumers need to update their `@rudderjs/*` ranges from `^0.x.y` to `^1.0.0`. The scaffolder (`create-rudder-app`) is updated to emit `1.x` ranges.

  **Why now.** Under semver caret rules, `^0.X.Y` is exact-minor — every minor bump on a `0.x` peer goes out of range and triggers a cascading major bump on every dependent. Even with the `onlyUpdatePeerDependentsWhenOutOfRange` flag in place, the `0.x` baseline keeps producing spurious cascades. Telescope's v9 is mostly that. Once at `1.0`, `^1.0.0` absorbs all `1.x` minor/patch updates — cascades only fire for actual breaking changes.

  **Cascade noise will drop significantly:**

  - `^1.0.0` absorbs all 1.x minor/patch updates
  - Cascade now only fires for actual breaking changes (real majors)

  **Packages graduating to 1.0.0 in this wave:**

  `@rudderjs/contracts`, `core`, `support`, `log`, `hash`, `crypt`, `context`, `testing`, `middleware`, `cache`, `session`, `broadcast`, `schedule`, `mail`, `notification`, `storage`, `localization`, `pennant`, `socialite`, `queue-bullmq`, `queue-inngest`, `router`, `server-hono`, `view`, `orm`, `orm-prisma`, `passport`, `boost`, `ai`.

  `@rudderjs/ai` was originally on the defer list (recent runtime-agnostic split), but it peer-depends on `@rudderjs/core` — graduating core forces ai to graduate via cascade regardless. Listing it explicitly so the version line is intentional rather than a side-effect.

  **Packages NOT yet graduated (still 0.x), to graduate individually as they stabilize:**

  - _Too new / not yet exercised in the dogfood loop:_ `@rudderjs/concurrency`, `image`, `process`, `http`, `console`
  - _Recent significant changes:_ `@rudderjs/orm-drizzle`, `sync`, `vite`

  These will only patch-bump in this release (cascade via regular `dependencies`, not `peerDependencies`).

  **Already past 1.0 (untouched by this release):** `@rudderjs/auth`, `cli`, `mcp`, `queue`, `horizon`, `pulse`, `sanctum`, `telescope`, `cashier-paddle`. These keep their existing version lines; no reset.

  **Expected cascade:** dependents like `telescope`, `pulse`, `horizon`, `cli`, `auth`, `mcp`, `queue`, `sanctum` will major-bump in this release because their peer/dep ranges shifted from `^0.x` to `^1.0.0`. This is the _last_ spurious cascade — future releases of those packages will patch-bump on in-range peer updates.

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0

## 0.1.2

### Patch Changes

- be10c83: Add `ModelLike` + `ModelQuery` interfaces to `@rudderjs/contracts` so downstream
  tools (e.g. `@pilotiq/pilotiq` for auto-wired CRUD) can target the Eloquent-style
  Model surface without depending on `@rudderjs/orm` directly. `Model` from
  `@rudderjs/orm` already structurally satisfies `ModelLike`, asserted at compile
  time via a `const _: ModelLike = Model` guard in `@rudderjs/orm`'s entry — any
  future change to `Model` that breaks the contract fails the build.
- Updated dependencies [be10c83]
  - @rudderjs/contracts@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0

## 0.1.0

### Minor Changes

- 8b0400f: Add `ModelRegistry.all()`, `.register()`, and `.onRegister()` so framework components can discover registered Model classes.

  Models are auto-registered on first `query()` or `find()`/`all()`/`first()`/`where()`/`count()`/`paginate()` call. Use `ModelRegistry.register(MyModel)` in a service provider to register eagerly before the first request hits.

  Telescope's model collector now subscribes via `onRegister()` so it also picks up models that appear after its own boot.

## 0.0.7

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/contracts@0.0.4
