# @rudderjs/orm

## 1.19.0

### Minor Changes

- dca4bf5: schema:types now folds blueprint-declared column types into the generated registry as a fallback layer for cast-less columns — precedence is `cast > blueprint intent > introspected storage type`. On SQLite a `t.boolean()` column types as `boolean` (instead of the INTEGER affinity's `number`) and `t.json()`/`t.jsonb()` as `unknown` (instead of `string`, which wrongly rejected the object writes the engine JSON-stringifies) without declaring any model cast. Intent is recovered by replaying the APPLIED migrations' blueprints against an in-memory ledger at generation time — no DDL or data statements re-execute (a guard at the adapter's executor funnel refuses runtime statements during replay and the migration's remaining intent is skipped). Date/time columns deliberately stay storage-typed without a cast: a cast-less SQLite column reads strings and rejects `Date` bindings, so the `date`/`datetime` cast remains the way to get `Date` semantics. New exports: `collectBlueprintIntent`/`TableIntent` (`@rudderjs/database/native`); `runNativeSchemaTypes` accepts an optional migrations-dir argument and `NativeAdapter.generateSchemaTypes` an optional intent map.

### Patch Changes

- Updated dependencies [dca4bf5]
  - @rudderjs/database@1.4.0

## 1.18.0

### Minor Changes

- 3569364: Boost's DB-facing MCP tools now work on native-engine apps (the create-rudder default), not just Prisma:

  - `db_schema` parses the committed native typed registry (`.rudder/types/models.d.ts`) first, falling back to `prisma/schema*` — same `{ models, raw }` shape on both engines, pure file-read posture (never boots the app).
  - `db_query` spawns the new `rudder db:query` command (rides `DB.select`, so it returns real JSON rows on native, drizzle, AND prisma); `prisma db execute --stdin` remains only as a no-boot fallback for Prisma apps — it never returned rows for SELECTs. The query is never interpolated into a shell string (argv element / stdin).
  - `model_list` walks `app/Models/**` recursively and resolves columns for `Model.for<'table'>()` models (which declare no fields in-file) from the native typed registry.

  New `@rudderjs/orm` command: `rudder db:query "<SELECT …>"` — adapter-agnostic read-only SELECT printing `{ "rows": [...] }` as JSON (SELECT-only guard; BigInt-tolerant serialization).

### Patch Changes

- Updated dependencies [b74544d]
  - @rudderjs/database@1.3.1

## 1.17.1

### Patch Changes

- 40fccbc: Pivot ops (`sync`/`attach`/`detach`/`updatePivot`) now compare ids loosely and write DB-typed values. Ids arriving as strings from an HTML form (`sync(["1","3"])`) no longer re-attach already-present numeric ids — previously a UNIQUE-constraint violation on a constrained pivot, or a silent duplicate-then-delete on an unconstrained one — and `detach`/`updatePivot` WHERE values are coerced to the id type observed on the stored pivot rows, so typed adapters (Prisma/Drizzle) never see a string bound against an Int column. Applies to `belongsToMany`, `morphToMany`, and `morphedByMany`.
- Updated dependencies [f0fc21f]
  - @rudderjs/core@1.9.0

## 1.17.0

### Minor Changes

- da07742: Automatic `createdAt`/`updatedAt` stamping (Laravel's `$timestamps`, `static timestamps = true` by default). On the native engine, `Model.create()` now stamps both columns and `update()`/`save()` bumps `updatedAt` — previously they were written NULL unless the migration added DB defaults. Stamping is schema-gated via the new optional `OrmAdapter.tableColumns()` capability (implemented by `NativeAdapter` with cached introspection): tables without the columns are silently skipped, and Prisma/Drizzle are untouched (their schemas own timestamp defaults). Opt out per model with `static timestamps = false`.

### Patch Changes

- be26c2b: `model:prune` now sweeps `app/Models/**` into the `ModelRegistry` before discovery. Model registration is lazy (a model registers on its first query, which never fires before discovery in a prune run), so in every real CLI invocation the registry was empty and the command always printed "No prunable models registered." — the feature was unreachable outside tests that hand-seeded the registry. Same fix shape as the `schema:types` cast-folding sweep (#934).
- bef393f: Generated type registries consolidate under the committed `.rudder/types/` directory: `views.d.ts` (was `pages/__view/registry.d.ts`), `routes.d.ts` (was `routes/__registry.d.ts`), `models.d.ts` (was `app/Models/__schema/registry.d.ts`). The Vike page stubs stay in `pages/__view/` (pinned by Vike's filesystem routing).

  Migration is automatic — the first dev/build/`routes:sync`/`view:sync`/`migrate` after upgrading writes the new path and deletes the legacy file. One manual step for existing apps: add `".rudder/**/*"` to the `tsconfig.json` `include` array (dot-directories are invisible to `**/*` globs and to bare-directory include entries; new scaffolds ship it). A `.rudder/README.md` is generated alongside, describing each file and its regen command.

- Updated dependencies [87783f7]
- Updated dependencies [da07742]
- Updated dependencies [bef393f]
- Updated dependencies [940406d]
  - @rudderjs/core@1.8.0
  - @rudderjs/database@1.3.0
  - @rudderjs/contracts@1.13.0

## 1.16.1

### Patch Changes

- 318f6e1: fix(orm): `schema:types` / post-`migrate` generation now actually folds `static casts` into the typed registry

  Cast folding read `ModelRegistry.all()`, but models register lazily on their first query — which never fires during a CLI generation run — so the registry was always empty at generation time and a `t.boolean()` column with `static casts = { col: 'boolean' }` still generated `col: number`, for every app, always. The generator now sweeps `app/Models/**` (importing each model module, tolerating unloadable files) before collecting casts. Models living outside `app/Models/` can self-register via `ModelRegistry.register(TheModel)` in a provider.

## 1.16.0

### Minor Changes

- cfab7aa: feat: common table expressions on the native engine — `withExpression(name, query, opts?)` / `withRecursiveExpression(...)` on query chains and as `Model` statics. The body is another native query (`Model.query()` chain) or a raw SQL string with `?` placeholders + `opts.bindings` (recursive bodies are usually raw — they reference the CTE's own name); `opts.columns` emits the explicit column list. Compiles to a `WITH [RECURSIVE] …` prefix on reads (`get`/`first`/`find`/`count`/`paginate`) with CTE bindings first (SQL text order); reference the CTE via `join('name', …)`. Native engine only — Drizzle/Prisma throw the forward-or-throw guard error.
- a5f7950: feat: `insertUsing(columns, query)` on the native engine — `INSERT INTO table (cols) SELECT …` with rows produced by a subquery (another native query chain or a raw SQL string with `?` placeholders + bindings; same body forms as `whereExists`). The explicit column list maps the subquery projection positionally; returns the inserted-row count (`RETURNING *` on sqlite/pg, driver `affectedRows` on MySQL). Bulk data-plane write: no observer events, no `fillable`/`guarded` filtering, no key generation — like `insertMany`/`upsert`. Available on query chains and as a `Model.insertUsing` static. Native engine only — Drizzle/Prisma throw the forward-or-throw guard error.
- c704a48: feat: arbitrary EXISTS subqueries on the native engine — `whereExists` / `whereNotExists` / `orWhereExists` / `orWhereNotExists` on query chains (+ `Model.whereExists`/`whereNotExists` statics). The subquery is another native query (`Model.query()` chain — correlate to the outer table via qualified `whereColumn('orders.userId', 'users.id')`) or a raw SQL string with `?` placeholders + bindings. Compiles to a `[NOT] EXISTS (…)` predicate at its position in the WHERE (composes with groups, `orWhere`, sugar); for relation-shaped checks prefer `whereHas`. Native engine only — Drizzle/Prisma throw the forward-or-throw guard error.
- 345d805: Phase-2 engine relocation, step 1 (decouple): the sticky-read scope moves to `@rudderjs/database/sticky`, and `BuiltInCast` moves to `@rudderjs/contracts`.

  - **`@rudderjs/database`** gains the node-only `./sticky` subpath — `runWithDatabaseContext()`, `hasDatabaseContext()`, `markWrote()`, `stickyWrote()`, and `databaseContextMiddleware()` relocate verbatim from `@rudderjs/orm/sticky`. The AsyncLocalStorage stays on `globalThis['__rudderjs_orm_sticky__']` (key unchanged), so the old and new import paths — and any mix of package versions across a dev re-boot — share one scope.
  - **`@rudderjs/orm/sticky`** becomes a re-export shim of `@rudderjs/database/sticky`. Every existing import (including `@rudderjs/orm-drizzle` and app queue-job wrappers) keeps working unchanged; `@rudderjs/database/sticky` is the canonical path going forward.
  - **`@rudderjs/contracts`** now owns the `BuiltInCast` cast-name union; `@rudderjs/orm` re-exports it from the same places as before (`@rudderjs/orm` main entry / `cast.ts`). Moved because the native engine's schema→TS type generator also consumes it, and the engine's new home (`@rudderjs/database`) must never import `@rudderjs/orm`.

  No behavior change; no `native/**` files touched. Part of `docs/plans/2026-06-04-database-extraction-phase-2.md` (PR-A1).

- 0d7c992: Phase-2 engine relocation, step 2: the native engine's core moves to `@rudderjs/database/native`.

  The SQL compiler, the three dialects (sqlite/pg/mysql), the driver seam (`Driver`/`AffectingExecutor`), the concrete drivers (`BetterSqlite3Driver`/`PostgresDriver`/`MysqlDriver`), `NativeQueryBuilder`, the engine errors, and the schema column definitions relocate from `packages/orm/src/native/` to `@rudderjs/database`'s new node-only `./native` subpath. `@rudderjs/database` now declares the driver packages (`better-sqlite3`/`postgres`/`mysql2`) as optional peers, mirroring `@rudderjs/orm`.

  **No public surface changes.** `@rudderjs/orm/native` re-exports every relocated name from `@rudderjs/database/native`, byte-compatible with the previous barrel — app migration files, `NativeAdapter` wiring, and standalone-Node consumers are unaffected. The dev-HMR driver cache key (`__rudderjs_native_client__`) and its signature format are unchanged, so a dev re-boot across this upgrade reuses (or cleanly disposes) live connections instead of leaking them.

  `NativeAdapter`, the schema builder + migrator, and `NativeDatabaseProvider` still live in `@rudderjs/orm` and follow in the next step (PR-A3). Part of `docs/plans/2026-06-04-database-extraction-phase-2.md`.

- ba50682: Phase-2 engine relocation, step 3 (final): `NativeAdapter` and the schema builder + migrator move to `@rudderjs/database` — the native engine now fully lives there.

  - **`@rudderjs/database`** gains the rest of the engine: `NativeAdapter`/`native` (with the dev-HMR driver cache key `__rudderjs_native_client__` and its signature format unchanged — re-boots across this upgrade reuse or cleanly dispose live connections), `SchemaBuilder`, `Blueprint`/`AlterBlueprint`, the DDL compiler, `Migration`/`Schema`/`Migrator`, introspection, and the schema→TS type generator. The headline API (`Migration`, `Schema`, `NativeAdapter`, the drivers) is now also re-exported from the **main entry** — `import { Migration, Schema } from '@rudderjs/database'` is the canonical migration-file form going forward.
  - **`@rudderjs/orm/native`** is now a pure re-export shim of `@rudderjs/database/native` — byte-compatible surface, every historical import keeps working (app migration files, standalone-Node consumers, the queue's database driver). `NativeDatabaseProvider` deliberately stays at `@rudderjs/orm/native/provider` (it wires `ModelRegistry`/`ConnectionManager`/the DB-facade bridge — orm-side state), so provider auto-discovery is untouched.

  No behavior change and no consumer-visible API change. Completes the relocation arc of `docs/plans/2026-06-04-database-extraction-phase-2.md` (PR-A3).

- f88660f: feat: `db:show` / `db:table` CLI commands — Laravel-parity database inspection over the native engine. `db:show` lists every table with on-disk sizes (`--counts` adds row counts, `--views` adds the view list); `db:table <name>` shows columns, indexes (incl. a synthesized PRIMARY entry on SQLite rowid tables), and foreign keys with update/delete rules. Both support `--json`. New `@rudderjs/database` exports: `inspectDatabase`/`inspectTable`/`readIndexes`/`readForeignKeys` (+ `NativeAdapter.inspectDatabase()`/`.inspectTable()`). Prisma/Drizzle apps get a friendly pointer to `prisma studio` / `drizzle-kit studio`.
- 255a755: feat: after-commit hooks — `afterCommit(fn)` (orm) and `DB.afterCommit(fn)` / `DB.connection(name).afterCommit(fn)` (facade) queue side effects (emails, webhooks, queue dispatches) to run only after the transaction open in the current async context commits, mirroring Laravel's `DB::afterCommit`. Callbacks flush in registration order after the OUTERMOST transaction commits (the awaited `transaction()` resolves after they finish) and are dropped on rollback; a rolled-back savepoint discards only the callbacks registered inside it, a released savepoint hands its callbacks to the enclosing level. Named-connection transactions keep separate queues (pass `{ connection }` to target one explicitly); with no open transaction the callback runs immediately. The queue lives in the orm's `transaction()` wrapper itself — above the adapter seam — so it works identically on the native engine, Drizzle, and Prisma. `@rudderjs/database` gains the `registerAfterCommitRunner`/`resolveAfterCommitRunner` bridge seam and the facade methods.
- 8a53671: feat: optimistic locking — `static version` on a Model (`true` → integer column `version`, string → custom column name). `create()` stamps the column with 1; `save()` and `Model.update()` with a version baseline write conditionally (`UPDATE ... SET version = v + 1 WHERE pk = ? AND version = v`) and throw the new `OptimisticLockError` (stable `code: 'OPTIMISTIC_LOCK'`, `expectedVersion`/`actualVersion`, duck-typed `httpStatus = 409`) when another writer got there first — nothing is written on a stale save. Updates without a baseline bump the column atomically with no stale check. Built on the `where().updateAll()` / `increment` contract primitives, so it works identically on the native engine, Drizzle, and Prisma with no adapter changes. The version column survives a `fillable` list that omits it (lock metadata, not data) and `replicate()` strips it so clones restart at version 1.
- 1da0b39: Weighted/custom read-replica picker on read/write-split connections. `read.picker` in `config/database.ts` selects the replica per query: `'round-robin'` (default, the previous behavior), `'random'`, a weights array (one non-negative weight per replica — `[3, 1]` sends ~75% of reads to the first), or a custom `(count) => index` function (Drizzle's `getReplica` equivalent). Shared `makeReplicaPicker` in `@rudderjs/database` powers both the native engine and the Drizzle adapter: malformed weight lists fail fast at adapter construction, a custom function's return is validated per call, and the picker runs after the sticky check so a sticky-routed read never consumes a pick.
- 1b8474a: Multi-database migrations on the native engine (Laravel `--database` / `Schema::connection` parity). `migrate`, `migrate:status`, `migrate:rollback`, `migrate:reset`, `migrate:refresh`, and `migrate:fresh` take `--connection=<name>` — the suite runs against the named connection with its `migrations` state table on that connection — plus `--path=<dir>` to keep per-database migration sets apart. Works even when the app's default engine is prisma/drizzle, as long as the named connection is `engine: 'native'`. Inside migrations (or anywhere the app has booted), `Schema.connection('reporting').create(…)` scopes one DDL operation to a named native connection through the same resolver seam as `DB.connection()`; non-native connections throw a clear error, and the call refuses under `migrate --pretend` (the dry run can't record a second connection). Cross-connection DDL runs outside the migrator's batch transaction — documented boundary.
- ac3d8d0: feat: typed window functions on the native engine — `selectWindow(fn, { as, partitionBy, orderBy })` adds `ROW_NUMBER` / `RANK` / `DENSE_RANK` / `PERCENT_RANK` / `CUME_DIST` … `OVER (PARTITION BY … ORDER BY …)` projections. Additive (rows still hydrate as full models with the alias as an extra attribute), identifier-quoted throughout, identical SQL on SQLite 3.25+/Postgres/MySQL 8. Available as a `Model` static and on query chains; Drizzle/Prisma throw the forward-or-throw guard error. Aggregates-OVER / lag / lead / frames stay on the documented `selectRaw` recipe.
- eb3bdfe: feat: transaction isolation levels — `transaction(fn, { isolationLevel })` / `DB.transaction(fn, { isolationLevel })` / `Model.transaction(fn, { isolationLevel })` with `'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'`. The native engine emits `SET TRANSACTION ISOLATION LEVEL …` at transaction start on Postgres/MySQL; the Drizzle adapter passes the level through to Drizzle's transaction config; the Prisma adapter maps it to `$transaction`'s `isolationLevel` option. SQLite throws a clear unsupported error (no isolation levels — single-writer is already serializable), and a nested `transaction()` call (savepoint) rejects the option on every adapter.

### Patch Changes

- 246f5b0: fix: `whereNull`/`where(col, null)` on a JSON arrow path now matches an explicit json `null` on MySQL, not just a missing key (Laravel parity). MySQL's `JSON_EXTRACT` returns a JSON null literal — not SQL NULL — for an explicit null, so null equality now compiles to Laravel's `(extract IS NULL OR JSON_TYPE(extract) = 'NULL')` grammar shape on both the native engine (new `Dialect.jsonNullComparison` seam) and the Drizzle adapter. sqlite/pg SQL is unchanged.
- Updated dependencies [f3cf833]
- Updated dependencies [a0206a6]
- Updated dependencies [cfab7aa]
- Updated dependencies [a5f7950]
- Updated dependencies [c704a48]
- Updated dependencies [345d805]
- Updated dependencies [0d7c992]
- Updated dependencies [ba50682]
- Updated dependencies [f88660f]
- Updated dependencies [d89d2cd]
- Updated dependencies [255a755]
- Updated dependencies [1da0b39]
- Updated dependencies [1b8474a]
- Updated dependencies [ac3d8d0]
- Updated dependencies [eb3bdfe]
  - @rudderjs/database@1.2.0
  - @rudderjs/contracts@1.12.0

## 1.15.0

### Minor Changes

- 39eec73: JSON arrow-path keys in update payloads on the native engine — `Model.update(id, { 'meta->prefs->lang': 'en' })` (and `updateAll`) writes one path inside a JSON column via the new per-dialect `Dialect.jsonSet` seam: sqlite `json_set(col, path, json(?))`, mysql `JSON_SET(col, path, CAST(? AS JSON))`, pg nested `jsonb_set((col)::jsonb, ARRAY[…], $n::jsonb)`. Values bind as JSON text so every type (string/number/boolean/null/array/object) round-trips identically; multiple writes on one column merge into a single assignment; mixing a whole-column write and an arrow write on the same column throws; path segments run the same injection gate as JSON reads. Plain payloads compile byte-identical to before. Under `fillable`/`guarded` the arrow key itself must be listed (Laravel parity). Adapters without the capability (Drizzle/Prisma for now) throw a clear Model-layer error instead of leaking the arrow key downstream.
- 135aa78: Arrow-path JSON predicates now work inside `whereHas` / `whereDoesntHave` / `has()` / `whereRelation` constrain callbacks (and aggregate constraints like `withCount`) on the native engine — `User.whereHas('posts', q => q.where('meta->lang', 'en'))` compiles the constraint through the same per-dialect `jsonExtract` seam as top-level arrow `where()`, with the base column qualified to the related table inside the correlated EXISTS body. Path segments are validated by the same injection gate; bindings stay in SQL-text order. Closes the whereHas-constraint deferral from the JSON-path arc.
- 5bfe9b1: Nested whereHas on the native engine — dot-path relation chains (`User.whereHas('posts.comments', q => q.where('approved', true))`) compile as nested correlated EXISTS, with Laravel `hasNested` semantics: the constrain callback and any `has()` count comparison apply to the DEEPEST relation, outer levels are plain existence, `whereDoesntHave('a.b')` flips only the outermost EXISTS (a parent row with childless intermediates doesn't defeat it), and `has('a.b', '<', 1)` flips to doesn't-have. Works across `whereHas` / `whereDoesntHave` / `orWhereHas` / `orWhereDoesntHave` / `has` / `orHas` / `whereRelation`, any chain depth, and every relation type the single-level form supports (including belongsToMany pivot hops and arrow-path JSON constraints on the deepest level). `RelationExistencePredicate` (contracts) gains an optional `nested` child predicate. Adapters without support (Drizzle/Prisma for now) throw a clear Model-layer error instead of silently ignoring the field; the nested-whereHas-inside-a-constrain-callback error now points at the dot-path form.
- 7c39c47: Native engine: `Model.with('relation')` now eager-loads direct relations (`hasOne`/`hasMany`/`belongsTo`/`belongsToMany`). The adapter advertises `eagerLoadStrategy: 'model-layer'` (same as Drizzle), so the ORM resolves them with one batched WHERE-IN query per relation, stitched onto the parents — previously a dev-warn no-op that returned rows without the relation populated. Constrained eager-load (`withWhereHas`) remains unsupported on native: chain `.whereHas(...)` for the filter plus `.with(...)` for the load.

### Patch Changes

- 0e0a9c5: Native MySQL engine fixes — `Schema.hasTable()` / `Schema.hasColumn()` now work on the mysql dialect (information_schema scoped to `DATABASE()`; previously threw `NATIVE_NOT_IMPLEMENTED`), `tinyint(1)` columns read back as JS booleans via a mysql2 `typeCast` (Postgres parity for `t.boolean()` columns; a plain `t.tinyInt()` stays numeric, override via driver `options`), and `create()` re-selects the inserted row by primary key instead of synthesizing it from the input — so the returned instance carries the real stored row (DB defaults, driver type mapping), consistent with the RETURNING dialects.
- Updated dependencies [5bfe9b1]
  - @rudderjs/contracts@1.11.0

## 1.14.0

### Minor Changes

- e199f5e: feat(database): scaffold @rudderjs/database + the DB facade skeleton

  Establishes the data-layer extraction boundary (Phase 2, PR1) — a new
  `@rudderjs/database` package (1.0.0) owning the public `DB` facade
  (`DB.select/insert/update/delete/statement/raw`), with the `@rudderjs/orm →
@rudderjs/database` dependency direction. The native engine internals are not
  relocated yet (a later step).

  - **@rudderjs/contracts** — promote the model-independent execution types
    (`Row`, `Executor`, `Transaction`, `Connection`) into the zero-dep foundation
    beside `OrmAdapter`, and add two optional raw-exec seam methods to `OrmAdapter`:
    `selectRaw(sql, bindings)` and `affectingStatement(sql, bindings)`. Single
    import point for every adapter — no flag-day.
  - **@rudderjs/orm** — depends on `@rudderjs/database`; native adapter implements
    the raw-exec seam; new node-only `@rudderjs/orm/db-bridge` subpath pushes the
    `ModelRegistry` adapter accessor into the facade (kept off the client bundle).
  - **@rudderjs/orm-prisma / @rudderjs/orm-drizzle** — implement `selectRaw` /
    `affectingStatement` over `$queryRawUnsafe`/`$executeRawUnsafe` and
    `db.execute(...)` respectively; both register the db-bridge on provider load.

  The new `@rudderjs/database` package publishes at 1.0.0 (new-package policy) and
  is intentionally omitted from this changeset's version bumps so its first release
  is exactly 1.0.0 rather than a bumped 1.1.0.

- 0e7db2c: feat(database): cross-adapter transaction() + DB.transaction() facade

  Closes the top correctness gap (gap-analysis §8 #1): `transaction()` now works on
  every adapter, not just the native engine, and is reachable from the new
  `@rudderjs/database` `DB` facade. The strategy is "boundary now, fill
  incrementally" — the `OrmAdapter.transaction?` contract was already in place
  (PR1), so this PR is pure implementation, no contract-shape change.

  - **@rudderjs/orm-prisma** — implement `transaction(fn)` over Prisma's interactive
    `$transaction`. The callback's adapter re-binds to Prisma's transaction client,
    so every `Model.*` / `DB.*` call inside the callback runs on that one
    connection. Nesting maps to a `SAVEPOINT` / `RELEASE SAVEPOINT` (or
    `ROLLBACK TO SAVEPOINT` on failure) bracket on the transaction connection,
    since Prisma's interactive client can't open a nested `$transaction`.
  - **@rudderjs/orm-drizzle** — implement `transaction(fn)` over `db.transaction`.
    The scoped adapter re-binds to Drizzle's transaction `db`; because Drizzle's
    `tx` is itself a `db`, nested `transaction()` opens a real SAVEPOINT for free.
  - **@rudderjs/orm** — `DB.transaction()` reuses the ORM's `AsyncLocalStorage`
    scoping: the `db-bridge` now also pushes the ORM `transaction()` free function
    in as the facade's transaction runner, so `Model.*` AND `DB.*` writes inside a
    `DB.transaction(fn)` callback join the _same_ open transaction (one connection,
    not two). The native provider now registers the bridge too, so `DB.*` /
    `DB.transaction()` work in native-engine apps.

  The `@rudderjs/database` `DB.transaction(fn)` surface ships in that package's
  first publish (still 1.0.0 — same deferral as PR1; it is intentionally kept off
  this changeset's version bumps so its initial npm release is exactly 1.0.0).

- fc97c10: feat(orm-drizzle): real eager loading for `Model.with()` on the Drizzle adapter

  `Model.with('relation').get()` now actually eager-loads direct relations on the
  Drizzle adapter, replacing the throw added in #826. Drizzle's adapter can't
  resolve a relation from its name alone (its relational query API needs
  pre-declared `relations()` schemas the adapter doesn't hold), so resolution
  moves to the ORM's Model layer:

  - `@rudderjs/contracts` — new optional `OrmAdapter.eagerLoadStrategy?: 'native' |
'model-layer'`. Omitted/`'native'` (Prisma) forwards relation names to the
    adapter's `with()`/`include`; `'model-layer'` routes direct relations into the
    Model-layer batched loader.
  - `@rudderjs/orm` — `partitionEagerLoads` gains a strategy param and a `direct`
    lane; a new `attachDirectRelations` fires one batched `WHERE … IN` query per
    relation against the related model and stitches the results onto each parent
    (mirroring the existing polymorphic loader). Covers `hasOne`, `hasMany`,
    `belongsTo`, `belongsToMany`. Undeclared / nested (`'a.b'`) names throw a clear
    error. Foreign-key conventions match the lazy `related()` accessor.
  - `@rudderjs/orm-drizzle` — `DrizzleAdapter` advertises
    `eagerLoadStrategy: 'model-layer'`, so `Model.with(...)` works. The QB-level
    `with()` still throws, but only via the `withWhereHas` constrained-eager
    fallback, which Drizzle still can't satisfy — use `whereHas` + `related()`
    there.

  Prisma is unaffected (it omits `eagerLoadStrategy`, keeping native `include`).

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

- 0109afb: JSON-path predicates on the native engine: arrow paths in `where()` (`where('meta->prefs->lang', 'en')` — also in `orWhere`, group callbacks, `whereNot`, and the `whereIn`/`whereNull`/`whereBetween` sugar), plus `whereJsonContains` / `whereJsonDoesntContain` / `whereJsonLength` (+ `orWhere*` forms) with Model statics. Compiled through new per-dialect `Dialect.jsonExtract` / `jsonContains` / `jsonLength` seams — sqlite `json_extract`/`json_each`, pg arrow-operator chains with `::numeric`/`::boolean` casts + `@>` + `jsonb_array_length`, mysql `JSON_EXTRACT`/`JSON_CONTAINS`/`JSON_LENGTH`. Path segments are validated (quotes/backslashes/backticks/control chars rejected); numeric segments address array indexes (`meta->items->0`). Prisma/Drizzle throw a clear "not supported on this adapter" error until their follow-ups. Also fixes the native Postgres driver double-encoding bound JSON params (porsager's default json serializer re-stringified already-stringified JSON text — `@>` containment silently matched nothing; strings now pass verbatim, mirroring the earlier date-type fix).
- 0dcecaf: New `make:resource` scaffolder — `pnpm rudder make:resource User` writes `app/Resources/UserResource.ts` with a `JsonResource` subclass stub (inferred model import, `toArray()` body, conditional-helper examples). Spec lives at `@rudderjs/orm/commands/make-resource` (same MakeSpec pattern as `make:factory`/`make:seeder`); the CLI loader registers it automatically.
- 363d942: Model ↔ resource wiring (mirrors the `static factoryClass` precedent). **`static resourceClass = UserResource`** binds a model to its API resource; **`user.toResource()`** then wraps the instance (`new UserResource(user)`), with an explicit class argument winning over the binding (`user.toResource(AdminUserResource)`). **`ModelCollection.toResourceCollection(cls?)`** wraps every item and returns a `ResourceCollection` — composing with the paginator/`additional()` envelope (`await users.toResourceCollection().toResponse()`). Unbound + no argument throws a clear pointer error; an empty collection resolves to `{ data: [] }` without needing a class. Supporting DX fix: the `JsonResource`/`ResourceCollection`/`ModelCollection` generic constraints are widened from `Record<string, unknown>` to `object`, so `class UserResource extends JsonResource<User>` (a class instance type) now typechecks — previously any class-typed model tripped the missing-index-signature error. Widening only; no existing call site changes.
- 12b4a55: feat(orm): date helpers (`whereDate`/`whereTime`/`whereDay`/`whereMonth`/`whereYear`) + `whereNot` group-negation on the native engine

  Laravel's date-based wheres and `whereNot` arrive on the native query engine:

  - **Date helpers** — `whereDate('createdAt', '2026-01-01')`, `whereYear('createdAt', '>=', 2026)`, etc. (+ `orWhere*` forms). Two-arg form is equality; three-arg carries the operator. Compiled through a new per-dialect `Dialect.dateExtract(part, column)` seam: SQLite `strftime` (with `CAST(... AS INTEGER)` for day/month/year), Postgres `::date`/`::time`/`EXTRACT(...)::int`, MySQL `DATE()`/`TIME()`/`DAY()`/`MONTH()`/`YEAR()`. Values bind positionally like any other clause. A `Date` value compares by its UTC components; numeric strings on day/month/year coerce to integers.
  - **`whereNot(cb)` / `orWhereNot(cb)`** — negated group: the callback's conditions compile as one parenthesized sub-tree wrapped in `NOT (…)`, reusing the `whereGroup` sub-builder machinery. The callback receives a hydrating sub-builder, so named sugar (`whereIn`, `whereNull`, …) composes inside it.

  All methods live on `HydratingQueryBuilder` + as `Model` statics — NOT on the `QueryBuilder` contract (zero adapter/stub churn). On adapters that don't implement them yet (Drizzle, Prisma), the Model-layer proxy throws a clear `<method>() is not supported on this adapter — use whereRaw(...) or DB.select(...)` error instead of a bare TypeError; the Drizzle implementation is a planned follow-up.

- 4085846: feat(orm): native schema builder — foreign keys (`constrained()` / `foreign()` / `onDelete`)

  The native engine's `Schema.create` migrations can now declare foreign keys, Laravel-style:

  ```ts
  Schema.create("posts", (t) => {
    t.id();
    t.foreignId("user_id").constrained(); // → REFERENCES users(id)
    t.foreignId("author_id").constrained("users"); // explicit table
    t.foreignId("editor_id").references("id").on("users").onDelete("cascade");
  });

  // composite / explicit:
  Schema.create("memberships", (t) => {
    t.foreign(["org_id", "user_id"])
      .references(["org_id", "user_id"])
      .on("org_users");
  });
  ```

  - **`constrained(table?, column = 'id')`** infers the referenced table from the column name (`user_id` → `users`, `authorId` → `authors`) or takes it explicitly.
  - **`references(cols).on(table)`** builds the FK explicitly; **`foreign(cols)`** records a table-level (composite) FK.
  - **`onDelete` / `onUpdate`** accept `cascade` | `restrict` | `set null` | `no action` (plus `setNull` / `noAction` aliases); anything else throws — arbitrary text never reaches the SQL.
  - FKs compile to `CONSTRAINT "{table}_{col}_foreign" FOREIGN KEY (...) REFERENCES "tbl" (...) [ON DELETE ...] [ON UPDATE ...]` table constraints, with every identifier validated + quoted.

  **SQLite notes:** FK enforcement requires `PRAGMA foreign_keys = ON` (better-sqlite3 leaves it off by default; this release does not change that). SQLite can't ADD or DROP a foreign key in place, so `Schema.table(...)` adding an FK column or `dropForeign(...)` throws a clear error pointing at creating the table with the FK or a column `change()`/rebuild.

- 6f8760d: feat(orm): `make:migration <name>` now generates a native migration stub for native-engine apps

  For an app on the native SQLite engine (no `@rudderjs/orm-prisma` / `@rudderjs/orm-drizzle` installed), `rudder make:migration <name>` writes a timestamped, hand-authored up/down stub to `database/migrations/<timestamp>_<name>.ts` instead of shelling out to an external migration tool. Laravel-style name inference scaffolds the common case: a `create_<table>_table` name produces an `up()` with `Schema.create('<table>', …)` (`t.id()` + `t.timestamps()`) and a `down()` that drops the table; any other name yields a generic empty stub with `// TODO` markers. Prisma/Drizzle apps and the `--vector` flag path are unchanged.

- 083672b: feat(orm): native `migrate:rollback` / `migrate:refresh` / `migrate:fresh` + transactional batches

  The native SQLite engine can now reverse migrations, not just apply them:

  - **`migrate:rollback`** reverts the last batch — each migration's `down()` runs in reverse apply order and its `migrations` row is deleted.
  - **`migrate:refresh`** rolls every migration back and re-runs them all.
  - **`migrate:fresh`** drops all tables and re-applies from scratch (now wired for native; prisma/drizzle keep shelling out).
  - On prisma/drizzle apps, `migrate:rollback` / `migrate:refresh` print a clear "forward-only — use `migrate:fresh`" message instead of shelling out.

  Each batch (the `up()`s in a `run()`, the `down()`s in a rollback) now executes inside a **single transaction**, so a failure mid-batch rolls the whole batch back atomically — the DDL and the `migrations` state-table writes commit or roll back together. The `Migrator` gains `rollback()`, `rollbackAll()`, `lastBatch()`, `migrationsInBatch()`, and `dropAllTables()`; `MigratorAdapter` now requires `transaction()` (already implemented by `NativeAdapter`).

- 8ba6e7d: feat(orm): native `Schema.table` column `change()` via the SQLite table-rebuild (Phase 7.4b)

  Completes `Schema.table` for the native engine: `t.<type>('col').change()` now changes an existing column's type/nullability/default. SQLite can't alter a column in place, so this runs the canonical 12-step rebuild — introspect the live table, create a shadow table with the new column set, copy the data across, drop the original, rename the shadow into place, and recreate the user indexes — preserving every non-changed column, the primary key (including `INTEGER PRIMARY KEY AUTOINCREMENT`), and unique/regular indexes.

  v1 scope: `change()` must be the only operation in its `Schema.table()` call (split adds/drops/renames/index changes into a separate call); changing a primary-key column isn't supported. New `rebuildTable` + SQLite introspection helpers (`readColumns` / `readIndexSql` / `isAutoincrement`) are exported from `@rudderjs/orm/native`. Atomicity comes from the migrator's per-batch transaction. SQLite only.

- b31d1be: feat(orm): native migration runner — `Migration` + `Schema` facade + `migrate` / `migrate:status` (Phase 7.2)

  Builds the migration runner on top of the 7.1 schema builder, so the native SQLite engine now runs Laravel-style migrations in-process (no external tool):

  - **`Migration`** base class (`up()` / `down()`) and the static **`Schema`** facade (`Schema.create` / `drop` / `dropIfExists` / `hasTable` / `hasColumn`) that migration files call — exported from `@rudderjs/orm/native`.
  - **`Migrator`** — tracks applied migrations in a `migrations` table (`id`, `migration`, `batch`, mirroring Laravel), applies pending ones in a new batch, and reports status. Plus **`discoverMigrations(dir)`** which loads `database/migrations/*.{ts,js,mts,mjs}` files sorted by name.
  - **`NativeAdapter.schemaBuilder()`** — exposes a connection-bound `SchemaBuilder` for the runner.
  - **CLI**: `rudder migrate` and `rudder migrate:status` now detect a native-engine app (no prisma/drizzle adapter package installed) and run the in-process `Migrator` against the booted adapter, instead of shelling out. Prisma/Drizzle apps are unchanged. The CLI boots the app on demand for the native path (`migrate*` otherwise skip boot).

  `migrate:rollback` / `migrate:refresh` (which reverse a batch via `down()`) and transactional batches land in 7.5; the `batch` column is recorded now so rollback has the grouping it needs. `make:migration` for native (the stub generator) is 7.3 — for now, author migration files by hand. SQLite only; additive and opt-in.

- 0d6c280: Native ORM engine: generate TypeScript model types from a live **Postgres** schema (Phase 7.7c). `schema:types` now introspects Postgres via `information_schema` (`readTables`/`readColumns` are dialect-aware) and maps column types through a new `pgTypeToTs` that reflects what the driver returns on read (`jsonb` → `unknown`, `timestamptz`/`date` → `Date`, `int8`/`bigint` → `number`, `numeric`/`money` → `string`, `bytea` → `Uint8Array`). The per-dialect storage mapper is threaded through `resolveColumnType` / `buildTableTypes` / `collectSchemaTypes` and defaults to the SQLite mapping, so existing behavior is unchanged. Declared `casts` still override the generated storage type. Completes Postgres support for the native engine (dialect + driver landed previously).
- 3b995b7: Native ORM engine: add Postgres support — Phase 7.7. The native engine (`@rudderjs/orm/native`) now runs against Postgres in addition to SQLite.

  - **`PgDialect`** — maps the portable schema-builder column types to Postgres storage types (`bigserial` PK, `varchar(n)`, `jsonb`, `timestamptz`, native `uuid`/`bytea`, `numeric(p,s)`, `double precision`), with `"`-quoted identifiers, `$n` placeholders, and `RETURNING` support. Adds a `Dialect.booleanLiteral(value)` seam so a boolean column `DEFAULT` renders correctly per dialect (Postgres `true`/`false`; SQLite/MySQL `0`/`1`).
  - **`PostgresDriver`** — a `Driver` over the `postgres` package (porsager, a new optional peer dependency), with pooled connections and real transactions/savepoints. `int8`/`bigserial` columns parse as JS numbers so a model's `id` matches the SQLite engine.
  - **Driver selection** — `native({ driver: 'pg', url })` wires the Postgres driver + dialect; `SchemaBuilder.hasTable`/`hasColumn` introspect via `information_schema` on Postgres.

  Opt-in and additive — SQLite apps are unaffected. MySQL (7.8) is a separate follow-up.

- 5eb4dd8: feat(orm): native schema builder — `Schema.create` + `Blueprint` for the SQLite engine (Phase 7.1)

  Adds a Laravel-style schema builder to the native engine at `@rudderjs/orm/native`: a `Blueprint` records column/index/primary-key intents, a pure per-dialect DDL compiler turns them into `CREATE TABLE` / `CREATE INDEX` statements, and `SchemaBuilder` executes them against a driver (plus `drop`/`dropIfExists`/`hasTable`/`hasColumn` introspection).

  This is the first slice of native migrations (Phase 7.1) — the schema-definition engine. The static `Schema` facade, `Migration` base class, and the `migrate` / `migrate:rollback` runner land in 7.2+. Column types cover the common set (`id`/`increments`, `string`, `text`, `integer`/`bigInteger`, `boolean`, `dateTime`/`timestamp`, `json`, `uuid`, `decimal`, `float`, `binary`, `foreignId`) with `nullable`/`default`/`useCurrent`/`unique`/`index`/`primary` modifiers and `timestamps()`/`softDeletes()` clusters. SQLite only for now (the DDL compiler is dialect-pluggable; pg/mysql arrive in 7.7/7.8). Additive and opt-in — Prisma/Drizzle apps are untouched.

- 536b64d: feat(orm): native `Schema.table` alters + `Schema.rename` (Phase 7.4)

  Adds table-alteration to the native engine's schema builder (`@rudderjs/orm/native`):

  - **`Schema.table('users', (t) => …)`** — add columns (any `Blueprint` column method), `t.dropColumn(...)`, `t.renameColumn(from, to)`, add indexes (`t.index` / `t.unique` / per-column `.unique()`/`.index()`), and `t.dropIndex(name)`. Compiled to separate `ALTER TABLE` / `CREATE INDEX` / `DROP INDEX` statements in dependency order (rename → add → add-index → drop-index → drop-column).
  - **`Schema.rename(from, to)`** — `ALTER TABLE … RENAME TO …`.
  - New `AlterBlueprint` + `compileAlterTable` / `compileRenameTable` + `ColumnBuilder.change()`.

  SQLite's ADD COLUMN limits are enforced with clear errors: you can't add a primary-key column to an existing table, and a NOT NULL column must carry a default (`.default(...)` or `.nullable()`). Changing an existing column's _type_ (`.change()`) needs the SQLite table-rebuild dance and throws a clear "lands in 7.4b" error for now. SQLite only; additive and opt-in.

- ea9b982: feat(orm): schema → TypeScript types generator + SchemaRegistry (GATE 7-types, foundation)

  The headline of the native migrations plan: model column types **generated from the migrated schema** instead of hand-maintained, so they can't drift. This lands the foundation:

  - **Pure type generator** (`@rudderjs/orm/native`): `sqliteTypeToTs` (affinity mapping), `castToTs` (a declared `cast` overrides the storage type — `boolean`/`date`/`json`/…), `resolveColumnType` (nullability + PK rules), `buildTableTypes`, and `emitRegistryDts` — which emits an `app/Models/__schema/registry.d.ts` augmenting `@rudderjs/orm`'s new `SchemaRegistry` interface, one entry per table. Mirrors `@rudderjs/vite`'s scanner pattern.
  - **Introspection**: `readTables` (user tables, excluding `sqlite_*` + the `migrations` bookkeeping table).
  - **Orchestrator**: `collectSchemaTypes` / `generateSchemaTypes` — introspect every table, fold in each model's `casts`, write the registry file.
  - **`SchemaRegistry` + `SchemaColumns<TName>`** exported from `@rudderjs/orm`: empty by default (so nothing changes until you generate), augmented by the generated `.d.ts`. Verified end-to-end with `tsc`: after augmentation, `SchemaColumns<'users'>` resolves to the typed column shape and a wrong column type fails type-checking.

  Non-breaking and opt-in — `Model` is unchanged; until the file is generated, `SchemaRegistry` is empty and everything behaves as before. Follow-ups: the `rudder schema:types` CLI command + post-`migrate` auto-generation, and binding the registry onto `Model<'users'>` so a model needs zero hand-declared fields. SQLite only.

- ad17e79: feat(orm): `onQuery` query listening on the native engine + app-facing `DB.listen()`

  Laravel's `DB::listen` arrives in RudderJS:

  - **`@rudderjs/contracts`**: `onQuery?(listener)` is now an optional capability on the `OrmAdapter` contract, with new `QueryEvent` (`{ sql, bindings, duration, connection?, model? }`) and `QueryListener` types — the shape Telescope's QueryCollector and Pulse's slow-query recorder already consume.
  - **`@rudderjs/orm` (native engine)**: the `NativeAdapter` implements `onQuery` by instrumenting its executor — every executed query (Model reads/writes, `DB.*` raw calls, and queries inside `transaction()`, which share the top-level listener list) is timed with `performance.now()` and reported with its SQL + bindings. Listener errors are swallowed and never break the query; only successful executions report (Laravel `QueryExecuted` parity). Transaction control statements (BEGIN/COMMIT/SAVEPOINT) are not reported.
  - **`@rudderjs/database`**: new `DB.listen(listener)`, mirroring Laravel's `DB::listen` — delegates to the active adapter's `onQuery` hook and throws a clear adapter-named error when the adapter doesn't support query listening. `QueryEvent` / `QueryListener` are re-exported.
  - **`@rudderjs/orm-prisma`**: the existing ad-hoc `onQuery` method is now typed to the shared contract (no behavior change).

  The Drizzle adapter does not implement the hook yet — `DB.listen()` throws its clear unsupported error there; a follow-up adds it.

- f6afdf8: Cast breadth (Laravel parity): three new casts in the built-in registry.

  - **`decimal:N`** — parameterized fixed-precision cast (`static casts = { price: 'decimal:2' }` / `@Cast('decimal:2')`). Both read and write normalize to a string with N fractional digits (`'9.50'`) — strings avoid float-rounding drift on money columns.
  - **enum** — a TypeScript `enum` (or plain const object) used directly as a cast (`static casts = { status: StatusEnum }`). Validates the value against the enum's members on read/write and throws a clear error (listing the allowed set) on an unknown value. Numeric enums are handled — the reverse-mapping labels are not treated as valid stored values.
  - **`hashed`** — one-way hash on write via the optional `@rudderjs/hash` peer (resolved synchronously through its shared registry, so `cast.ts` stays client-bundle safe). Re-hashing an already-hashed value is a no-op (Laravel's behavior). Requires a sync-capable driver (bcrypt); argon2 throws a clear message. On read the stored hash is returned verbatim.

- e25472c: feat(orm): `chunk()` / `lazy()` — memory-bounded iteration over large result sets

  Adds Laravel's `chunk` and `lazy` to the query builder (and as Model statics), so
  you can process huge tables without loading every row at once.

  ```ts
  // Pages of 200; return false to stop early.
  await User.query().orderBy('id').chunk(200, async (users) => { … })

  // Async iterator, 1000 rows per page by default.
  for await (const user of User.query().orderBy('id').lazy()) { … }
  ```

  Both page the query via the existing `LIMIT`/`OFFSET` primitives at the Model
  layer — no adapter or contract changes, so every adapter (native, Prisma,
  Drizzle) supports them. `chunk` re-queries per page and resolves `true` (ran to
  completion) or `false` (callback bailed); `lazy(size?)` returns an async
  generator. Add an `orderBy` for stable paging (offset paging needs a consistent
  sort, same as Laravel's `chunk`).

- ca644ad: feat(orm): `Model.query().cursorPaginate(perPage?, cursor?)` — keyset pagination (Laravel parity)

  Adds cursor (keyset) pagination alongside the existing offset `paginate()`. Instead of `OFFSET`, it filters `WHERE (orderCols) > lastSeenValues` against the query's `orderBy` columns and fetches `LIMIT perPage + 1` (the probe row tells it whether another page exists) — so paging stays O(1) regardless of depth, the right tool for infinite scroll and large API list endpoints.

  ```ts
  const page = await Post.query()
    .orderBy("createdAt", "desc")
    .cursorPaginate(20);
  //   { data, perPage, nextCursor, prevCursor, hasMore }
  const next = await Post.query()
    .orderBy("createdAt", "desc")
    .cursorPaginate(20, page.nextCursor);
  ```

  - Returns a `CursorPaginator` — `{ data, perPage, nextCursor, prevCursor, hasMore }` (+ `toJSON()`). The cursor is an opaque base64url-encoded JSON of the boundary row's order-column values; decoded on input, encoded on output. `encodeCursor` / `decodeCursor` are exported too.
  - **Requires at least one `orderBy()`** (keyset needs a deterministic sort) — throws a clear error otherwise. The primary key is appended as a tiebreaker when it isn't already an order column, giving a stable total order.
  - **Multi-column orderBy is supported** — compound keyset via the lexicographic `(a, b) > (?, ?)` expansion, composed so it `AND`s correctly with any pre-existing `where()` clauses.
  - `Model.cursorPaginate(perPage?, cursor?)` (static) defaults to ordering by the primary key.
  - **Forward-only in v1** — `nextCursor` advances; `prevCursor` is always `null` (backward navigation deferred).

  Built entirely at the Model layer on the existing `where` / `orderBy` / `limit` / `get` primitives — no adapter, contract, or native-engine changes — so it works identically across the native engine, Drizzle, and Prisma.

- bf1cca0: feat(orm): `distinct()` — SELECT DISTINCT (Laravel parity)

  `Model.query().distinct().get()` de-duplicates the result rows; pair it with `select(...)` to de-duplicate on specific columns. With `distinct()`, `count()` / `paginate()` count the distinct rows.

  Native engine only — on Drizzle and Prisma it throws with a pointer to the native engine / `DB.select(...)`, consistent with joins / groupBy / union.

- bc76570: feat(orm): factory relationship building + `Model.factory()` + mass-assignment bypass

  Closes the three Laravel-parity gaps in `ModelFactory` (gap-analysis §8 factory arc):

  - **`Model.factory()` entry point** — link a factory with `static factoryClass = UserFactory` on the model, then call `User.factory()` (≡ `UserFactory.new()`), chaining the same verbs (`.state()`, `.with()`, `.has()`, `.for()`, `.create()`, `.make()`). Unlinked models throw a clear error.
  - **Relationship building** — `has(childFactory, count?, relationName?)` (hasMany/hasOne children with the parent FK set), `for(parentFactory, relationName?)` (belongsTo — create the parent first, set this row's FK), and `hasAttached(relatedFactory, count?, pivotData?, relationName?)` (belongsToMany — create related rows and attach through the pivot). FKs resolve from `static relations`; the relation name is inferred when a single relation of the right kind points at the other model. Polymorphic relations are not yet supported (clear error).
  - **Mass-assignment bypass** — factory `create()` now persists via `forceFill()` + `save()` instead of `Model.create()`, so a guarded model still receives every factory attribute (Laravel behavior). Observer events (`creating`/`created`/`saving`/`saved`) still fire; `make()` is unaffected.

  `ModelFactory.new()` also accepts concrete-generic factories (`extends ModelFactory<{ ... }>`) and returns the precise factory type.

- acc2245: Relations: `hasOneThrough` / `hasManyThrough` (Laravel parity). A parent reaches a distant relation through an intermediate model — e.g. `Country → hasManyThrough(Post, User)` walks `countries.id = users.countryId` then `users.id = posts.userId`.

  Declared as object literals on `static relations` (same shape as the other relation types): `{ type: 'hasManyThrough', model: () => Post, through: () => User, firstKey?, secondKey?, localKey?, secondLocalKey? }`. Keys default by Laravel convention — `firstKey` = `${camelCase(Parent)}Id`, `secondKey` = `${camelCase(Through)}Id`, `localKey`/`secondLocalKey` = each model's primary key.

  Both access paths resolve the two hops with batched `WHERE … IN` queries (no join SQL), entirely in the Model layer — so every adapter gets them with no contract/adapter change:

  - **Lazy** — `parent.related('posts')` returns a deferred QueryBuilder (reuses the pivot deferred-proxy machinery); chain `where`/`orderBy`/etc. and terminate with `get`/`first`.
  - **Eager** — `Model.with('posts')` via the Model-layer batched loader (`attachHasThrough`); always routed to the Model layer regardless of adapter eager strategy (no adapter can express the two-hop walk natively).

  `whereHas` / `withCount` on a through relation throw a clear "not supported yet" error (a two-level EXISTS / aggregate is deferred) pointing at `with()` / `related()`.

- 0b085a6: feat(orm): query-builder breadth — joins, structured `select()`, `groupBy` / `having`

  Adds Laravel-style joins, column projection, and grouping to the query builder. The native engine fully supports them:

  - **Joins** — `join` / `leftJoin` / `rightJoin` / `crossJoin`, with column-vs-column `on()` and bound `where()` conditions. Simple form `join('posts', 'posts.userId', '=', 'users.id')` and callback form `join('posts', j => j.on(...).where(...))`.
  - **Projection** — `select('users.id', 'posts.title')` (quoted, qualified columns; combines with `selectRaw`).
  - **Grouping** — `groupBy(...columns)` + `having(col, op, value)` / `orHaving` / `havingRaw('COUNT(*) > ?', [3])` / `orHavingRaw`. With a `GROUP BY` present, `count()` / `paginate()` count the number of groups (wrapped subquery), matching Laravel.

  Each is also a `Model` static (`User.join(...)`, `User.select(...)`, `User.groupBy(...)`, `User.having(...)`).

  On the Drizzle and Prisma adapters these throw with a pointer to the native engine or the `DB` facade — their typed clients can't map a join/projection/grouping result back to a single hydrated model (the same reason `selectRaw` throws there). Use `@rudderjs/orm/native`, or `DB.select(sql, bindings)`.

  `JoinClause` (the join-callback sub-builder type) is exported from `@rudderjs/contracts` and re-exported from `@rudderjs/orm`.

- 468dcd4: Model: `static keyType = 'uuid' | 'ulid'` for application-generated primary keys. When set and the primary key is unset on `Model.create()` / `instance.save()`, the ORM stamps a fresh UUID v4 (Web Crypto `randomUUID`) or a lexicographically sortable 26-char Crockford Base32 ULID before the insert — Laravel's `HasUuids` / `HasUlids` traits. Implemented purely in the Model layer, so all three adapters get it with no contract/adapter change. Default `'int'` stays database-assigned auto-increment (unchanged). A caller-supplied key is never overwritten.
- ffbb7f7: Per-model named connections (multi-connection PR2): `static connection` + `Model.on('name')`.

  A model can bind every query to a named connection with `static connection = 'reporting'` (Laravel's `protected $connection`), or run a one-off query on another connection with `User.on('reporting').where(...)` — `Model.on()` keeps its two-arg lifecycle-listener form (`User.on('creating', fn)`); the one-arg form starts the connection-scoped query. Named connections open lazily on the model's first query via a deferred record-and-replay QueryBuilder: chainables recorded before the open replay onto the real adapter builder at the first terminal — only the first query per connection pays this; afterwards queries build directly on the opened adapter. Queries inside `transaction(fn, { connection })` join that open transaction; observer events, hydration, scopes, and the Model-layer sugar (`whereIn`, `chunk`/`lazy`, …) all work unchanged on named connections.

- b897950: Named database connections (multi-connection PR1): `DB.connection('name')` + a lazy `ConnectionManager` + per-connection transaction scoping.

  - **`@rudderjs/orm`**: new `ConnectionManager` (globalThis-backed registry of lazy connection factories — registering does no I/O and no driver import, so `config/database.ts`'s `connections` map keeps its menu semantics). `transaction(fn, { connection: 'name' })` runs a transaction on a named connection; the transaction ALS now keys scoped adapters **by connection name**, so a named-connection transaction never captures default-connection queries (and vice versa). `ModelRegistry.getAdapter(name?)` / `getScopedAdapter(name?)` resolve named connections. The native provider registers a factory for every `engine: 'native'` connection (the default stays eager and shares one adapter with `DB.connection(default)`), and the native dev-HMR driver cache is now per-connection (a config edit disposes/reopens only that connection's driver).
  - **`@rudderjs/database`**: `DB.connection(name)` — a scoped facade (`select`/`insert`/`update`/`delete`/`statement`/`transaction`/`listen`) over a named connection, opened lazily on first use; inside `transaction(fn, { connection: name })` its calls join that open transaction. New bridge hooks (`registerConnectionResolver`, `registerNamedTransactionRunner`) keep the orm→database dependency direction.

  `Model.on('name')` / per-model `static connection` and read/write splitting land in follow-up PRs (see `docs/plans/2026-06-03-orm-multi-connection-read-write-split.md`).

- caff11d: feat(orm): native MySQL dialect + driver (Phase 7.8)

  Adds MySQL to the built-in native engine, mirroring the shipped Postgres path
  (7.7). Native now drives SQLite, Postgres, **and** MySQL with one query/DDL/
  introspection/types pipeline.

  - **`MysqlDialect`** — backtick identifier quoting, `?` placeholders, `1`/`0`
    boolean literals, and the MySQL column-type map (`t.id()` →
    `bigint AUTO_INCREMENT PRIMARY KEY`, `boolean` → `tinyint(1)`, `json` → `json`,
    `uuid` → `char(36)`, `dateTime`/`timestamp` → `datetime`/`timestamp`, etc.).
  - **`MysqlDriver`** (`mysql2`, optional peer) — pooled; autocommit statements run
    on the pool, `transaction()` reserves a connection (BEGIN/COMMIT/ROLLBACK) and
    nested transactions map to SAVEPOINTs on that pinned connection.
  - **No-RETURNING write path** — MySQL 8 has no `RETURNING`, so the query builder
    branches on `dialect.supportsReturning`: it reads `insertId` / `affectedRows`
    from the driver's result metadata (a new native-only `AffectingExecutor` seam)
    and re-SELECTs by primary key for terminals that return a row. SQLite/Postgres
    keep their exact existing `RETURNING *` path.
  - **Introspection + type generation** — `information_schema` reads scoped to
    `DATABASE()` and a `mysqlTypeToTs` mapper, so `rudder schema:types` /
    post-`migrate` generation works against MySQL (`tinyint` → `number`, refined to
    `boolean` by a declared cast; `decimal` → `string`; `json` → `unknown`).
  - **Provider gate reconciled** — the `engine: 'native'` config path previously
    hard-rejected every non-sqlite driver, leaving the shipped Postgres engine
    unreachable via `config/database.ts` (and `rudder migrate`, which boots through
    the provider). The gate now validates the driver name and accepts `sqlite` /
    `pg` / `mysql` (pg + mysql enabled together); `NativeAdapter.make` then loads
    the matching optional peer with a clear install/connection error.
  - `mysql2` added as an optional peer dependency (lazy-imported only —
    `pnpm test:client-bundle` stays green).

- 26b7acf: Read/write split + sticky reads on the native engine (multi-connection PR3).

  A native connection can declare read replicas in `config/database.ts` — `read: { url: string | string[] }` (round-robin per query), optional `write: { url }` (defaults to `url`), and `sticky: true` for read-your-writes: after a write within the current request scope, reads on that connection route to the writer. Routing rules (Laravel parity): un-locked SELECT terminals + `selectRaw`/`DB.select` → read pool; writes, DDL, locked selects (`lockForUpdate`/`sharedLock`), and **everything inside a transaction** → write connection. The sticky request scope is entered by a middleware the native provider auto-installs on the `web` + `api` groups when a sticky split connection is configured; outside a request scope (jobs, commands) sticky is a no-op and reads go to replicas — wrap with `runWithDatabaseContext()` from the new node-only `@rudderjs/orm/sticky` subpath for read-your-writes there. Query events (`DB.listen`/`onQuery`) now carry the **connection name** (config name when known, driver name otherwise) and — on split connections only — a `target: 'read' | 'write'` field (`QueryEvent.target`, new optional contract field). The dev-HMR driver cache includes the replica list in its signature and `disconnect()` closes replica drivers too.

- ea510e0: Native engine schema/migration breadth (Laravel parity). The `@rudderjs/orm/native` schema builder gains:

  - **`morphs()` / `nullableMorphs()` / `dropMorphs()`** — polymorphic-relation column scaffolding (`{name}Id` + `{name}Type` + composite index, camelCase).
  - **More column types** — `tinyInteger`/`smallInteger`/`mediumInteger`, `char`, `mediumText`/`longText`, `double`, `date`, `time(precision?)`, `jsonb`, `ulid`, `foreignUuid`/`foreignUlid`/`foreignIdFor`, and `enum`/`set` — mapped across all three native dialects (sqlite/pg/mysql); `set` throws a clear unsupported error on pg/sqlite.
  - **Column modifiers** — `comment()` (inline on MySQL, `COMMENT ON COLUMN` on pg), `useCurrentOnUpdate()` (MySQL), `after()`/`first()` (MySQL positional ALTER), raw `Expression` defaults (e.g. `raw('gen_random_uuid()')`), and FK shorthands `cascadeOnDelete()` / `restrictOnDelete()` / `nullOnDelete()` / `cascadeOnUpdate()`.
  - **Migrate command flags** — `migrate --step`/`--pretend`/`--force`, `migrate:rollback --step[=N]`/`--batch=N`, standalone `migrate:reset`, `migrate:refresh --step`/`--seed`, and `migrate:fresh --seed`.

- b08aa1d: feat(orm): raw-SQL expressions — `selectRaw` / `whereRaw` / `orWhereRaw` / `orderByRaw` + `DB.raw(...)` everywhere

  Adds Laravel's raw-SQL escape hatch to the query builder for the clauses the
  structured builder can't express:

  ```ts
  // Bound `?` placeholders are rebound to the dialect's form ($n on Postgres).
  const adults = await User.query().whereRaw("age > ?", [18]).get();

  // Compose with structured wheres + OR raw fragments.
  await User.query().where("active", true).orWhereRaw("age > ?", [65]).get();

  // Raw ORDER BY + raw projection.
  await User.query()
    .orderByRaw("field(status, ?, ?)", ["urgent", "high"])
    .get();
  await User.query()
    .selectRaw("count(*) as total, max(created_at) as latest")
    .get();

  // DB.raw(...) splices verbatim as a where value or order column.
  import { DB } from "@rudderjs/database";
  await User.query()
    .where("created_at", ">", DB.raw("NOW()"))
    .orderBy(DB.raw("age asc"))
    .get();
  ```

  Threaded through the native engine's compiler (a `?`-placeholder rebinder shares
  the one positional bindings accumulator, so `$n` indices stay correct across the
  whole statement). The Drizzle adapter implements `whereRaw`/`orWhereRaw`/
  `orderByRaw` via its `sql` template; `selectRaw` throws there (its typed select
  can't map an arbitrary raw projection back to hydrated models). The Prisma
  adapter throws on all four — its structured client can't splice raw SQL — and
  points you at the `DB` facade (`DB.select(sql, bindings)`) for raw queries.

  The `Expression` wrapper behind `DB.raw(...)` moved from `@rudderjs/database` to
  `@rudderjs/contracts` (re-exported from `@rudderjs/database`, so `DB.raw()` and
  `import { raw } from '@rudderjs/database'` are unchanged) — it now lives on a
  client-safe path so the query builder's raw methods stay out of `@rudderjs/database`'s
  node-only graph.

- 6bd32b0: feat(orm): generated model types — `Model.for<'table'>()` binding + `rudder schema:types` (GATE 7-types)

  Finishes the GATE 7-types consumption layer on top of the #817 generator. A model can now derive its column types from the migrated schema with zero hand-declared fields:

  ```ts
  export class User extends Model.for<"users">() {
    static override table = "users";
  }

  await User.find(1); // u.id / u.name / u.email — typed
  await User.where("active", true).first(); // chains are typed too
  await User.create({ name, email }); // unknown columns fail tsc
  ```

  - `Model.for<TName>()` resolves a model's instance type from `SchemaRegistry[TName]` (open-decision #1 → generic binding). Purely additive: `static casts` still refine the storage type, plain `extends Model` and hand-declared fields are unaffected.
  - `rudder schema:types` regenerates `app/Models/__schema/registry.d.ts` on demand (native engine; boots on demand like `migrate*`).
  - Native `migrate` / `migrate:fresh` / `migrate:refresh` / `migrate:rollback` auto-regenerate the registry after a successful apply.
  - The generated `registry.d.ts` should be **committed** (so `tsc`/CI is green without a generate step).

- 370d2ec: feat(orm): `union` / `unionAll` — combine queries (Laravel parity)

  `base.union(other)` / `base.unionAll(other)` combine the current query with another (`UNION` removes duplicate rows, `UNION ALL` keeps them). The combined result takes the base query's `ORDER BY` / `LIMIT` / `OFFSET`; `count()` / `paginate()` count the combined rows.

  Native engine only — on Drizzle and Prisma these throw with a pointer to the native engine / `DB.select(...)`, consistent with joins/groupBy. `other` must be another native `Model.query()`.

- c66e195: feat(orm): `Model.upsert(rows, uniqueBy, update?)` — bulk insert-or-update across native, Drizzle, and Prisma

  Adds Laravel's bulk upsert. Insert every row; on a unique-key conflict (the
  `uniqueBy` columns) update the `update` columns from the incoming values instead
  of failing. `update` defaults to every inserted column except `uniqueBy`; an
  empty list means insert-or-ignore. Returns the number of rows affected.

  ```ts
  await User.upsert(
    [
      { email: "a@x.com", name: "Ada" },
      { email: "b@x.com", name: "Bob" },
    ],
    "email", // uniqueBy (single column or string[])
    ["name"] // overwrite on conflict; omit → all inserted columns minus uniqueBy
  );
  ```

  - **native** — one atomic statement: `ON CONFLICT (…) DO UPDATE / DO NOTHING`
    (SQLite/Postgres) or `ON DUPLICATE KEY UPDATE` (MySQL), via a new
    `Dialect.upsertClause()` seam + `compileInsert({ upsert })`.
  - **Drizzle** — `onConflictDoUpdate` / `onConflictDoNothing` (SQLite/Postgres) or
    `onDuplicateKeyUpdate` (MySQL).
  - **Prisma** — no portable bulk ON CONFLICT, so each row maps to a single-row
    `delegate.upsert` batched in one `$transaction`.
  - **`@rudderjs/contracts`** — new optional `QueryBuilder.upsert?(rows, uniqueBy,
update)`; the Model layer throws an adapter-named error if an adapter omits it.

  Like `insertMany`, upsert is a bulk write: `fillable`/`guarded` do **not** apply
  (write-side casts/mutators still do) and observer events do **not** fire. A
  matching UNIQUE constraint on `uniqueBy` must exist. MySQL's returned count is
  rows-touched (1 per insert, 2 per update), not rows-distinct.

- 473dfd9: feat(orm): `whereColumn` + `whereHas` OR/count operators — finishing the where/existence families

  - **`whereColumn(a, b)` / `whereColumn(a, op, b)`** (+ `orWhereColumn`) — compare two
    columns with both sides identifier-quoted per dialect (unlike `whereRaw`, which is
    verbatim). Native real (new column-vs-column compiler clause); Drizzle real (column
    refs through `sql`); Prisma throws and points at `DB.select`/`whereRaw`.
  - **`orWhereHas` / `orWhereDoesntHave`** — OR-rooted relation-existence predicates.
  - **`has(rel, op, n)` / `orHas`** — count comparison on a relation (`has('posts', '>=', 3)`),
    compiled as `(SELECT COUNT(*) …) op n`. Defaults to `>= 1` (≡ `whereHas`).
  - OR/count are **native-only**; Drizzle and Prisma throw a clear pointer (their query
    APIs can't express a count filter or an OR-rooted existence join). Plain
    `whereHas`/`whereDoesntHave` are unchanged on every adapter.

  `whereColumn`/`has`/`orWhereHas` are surfaced as Model statics and on the hydrating
  query builder. `RelationExistencePredicate` gains optional `boolean` + `count` fields.

- 6e83e26: feat(orm): `whereRelation` / `orWhereRelation` — column-on-relation filter sugar (Laravel parity)

  Shorthand for `whereHas(relation, q => q.where(column, …))`:

  ```ts
  await User.whereRelation("posts", "published", true).get(); // = operator
  await User.whereRelation("posts", "views", ">=", 100).get(); // explicit operator
  await User.orWhereRelation("posts", "flagged", true).get(); // OR-rooted
  ```

  Available as `Model` statics and as chainable methods on the query builder
  (`User.where(...).whereRelation(...)`). Delegates to the existing `whereHas`
  predicate machinery, so it works across every relation type `whereHas` supports
  (including pivot relations) and carries the same adapter support — no adapter or
  contract change.

- 5617ec2: feat(orm): `whereX` query sugar — `whereIn`/`whereNull`/`whereBetween`/`when`/`unless` + `pluck`/`value`/`sum`/`exists` terminals

  Adds Laravel's everyday query-builder sugar to the Model query layer:

  ```ts
  await User.query().whereIn('role', ['admin', 'editor']).get()
  await User.query().whereNotNull('verifiedAt').whereBetween('age', [18, 65]).get()

  // Conditional clauses — no if-ladders around query building.
  await User.query().when(role, (q, r) => q.where('role', r)).get()
  await User.query().unless(includeArchived, (q) => q.whereNull('deletedAt')).get()

  // Ordering + terminals.
  await User.query().latest('createdAt').limit(10).get()
  const emails = await User.query().where('active', true).pluck('email')
  const total  = await User.query().where('role', 'admin').sum('credits')
  if (await User.query().where('email', e).exists()) { … }
  ```

  Full set: `whereIn`/`whereNotIn`/`orWhereIn`/`orWhereNotIn`, `whereNull`/`whereNotNull`/`orWhereNull`/`orWhereNotNull`, `whereBetween`/`whereNotBetween`/`orWhereBetween`/`orWhereNotBetween`, `when`/`unless`, `latest`/`oldest`, and the scalar terminals `pluck`/`value`/`sum`/`max`/`min`/`avg`/`exists`/`doesntExist`. Each is also a `Model` static entry point (`User.whereIn(...)`, `User.sum(...)`, etc.).

  Implemented entirely at the Model layer — they compose the existing `where`/`orWhere`/`whereGroup`/`orderBy`/`get`/`first`/`_aggregate` primitives in the hydrating query-builder proxy — so **every adapter (native, Drizzle, Prisma) gets them for free** with no contract or adapter changes. Typed on `HydratingQueryBuilder` (not the `QueryBuilder` contract).

- bb07d54: feat(orm): belongsToMany pivot query constraints — `wherePivot` family (Laravel parity)

  `belongsToMany` / `morphToMany` / `morphedByMany` relation reads can now filter by
  pivot-table columns, not just project them with `withPivot`:

  - `wherePivot(column, value)` / `wherePivot(column, operator, value)`
  - `wherePivotIn(column, values)` / `wherePivotNotIn(column, values)`
  - `wherePivotBetween(column, [min, max])`
  - `orWherePivot(column, value?)`

  ```ts
  await user.related("roles").wherePivot("active", 1).get();
  await user
    .related("roles")
    .wherePivotBetween("level", [3, 5])
    .withPivot("level")
    .get();
  ```

  The constraints apply to the pivot-rows query in step 1 of the existing two-step
  load, so all three adapters get it with no adapter or contract change. The chainable
  read surface is exported as the `PivotQueryBuilder` type.

- 7b5d000: feat(orm): `withDefault` on belongsTo / hasOne relations (Laravel parity)

  A `belongsTo` / `hasOne` relation can now return a null-object default instead
  of `null` when it resolves to no row — mirroring Laravel's `->withDefault()`:

  ```ts
  static relations = {
    author: { type: 'belongsTo', model: () => Author, withDefault: true },              // empty instance
    author: { type: 'belongsTo', model: () => Author, withDefault: { name: 'Guest' } }, // with attributes
    author: { type: 'belongsTo', model: () => Author,
              withDefault: (author, post) => { author.name = `by ${post.id}` } },       // callback
  }
  ```

  Applies on both reads and is pure Model-layer (no adapter or contract change),
  so all three adapters honour it:

  - **lazy** — `post.related('author').first()` yields the default (and survives a
    `.where(...)` chain); for `belongsTo`, a null FK no longer throws when
    `withDefault` is set.
  - **eager** — `Post.with('author')` substitutes the default after the terminal
    returns, for any parent whose relation came back null.

  `withDefault` is ignored on `hasMany` (an empty list is already its own
  null-object). The `RelationDefault` type is exported.

- a93455e: feat(queue): native database-backed queue driver (`@rudderjs/queue/native`)

  A persistent, self-hosted queue driver backed by the native ORM engine — the
  zero-infrastructure default tier, modeled on Laravel's `database` driver.
  Selected with `driver: 'database'` in `config/queue.ts`; BullMQ and Inngest
  remain the high-throughput / cloud tiers, unchanged.

  - Jobs persist in a `jobs` table; exhausted jobs move to `failed_jobs`. Stub the
    migrations with `pnpm rudder queue:table`, then `pnpm rudder migrate`.
  - For apps on a non-native ORM (Prisma/Drizzle), set `engine` + `url` on the
    queue connection to give the queue its own dedicated SQLite/Postgres/MySQL
    store — its `jobs` / `failed_jobs` tables are created automatically on first
    use (its private DB, no migration step). Omit `engine` to run against the app's
    native ORM connection instead.
  - `pnpm rudder queue:work [queues] [--once --sleep --tries --backoff --timeout
--max-jobs --stop-when-empty]` — a polling worker with comma-separated queue
    **priority** order, retries with backoff, and `retry_after` reclaim of jobs
    abandoned by a crashed worker. Atomic reservation via a transaction +
    `lockForUpdate()` (`FOR UPDATE` on Postgres/MySQL; a serializing write
    transaction on SQLite — run a single worker on SQLite).
  - `queue:status` / `queue:clear` / `queue:failed` / `queue:retry` all work
    against the new driver.

  Supporting changes:

  - `@rudderjs/orm` (native): new `QueryBuilder.lockForUpdate()` / `sharedLock()`
    — first-class pessimistic row locking (Laravel parity). The compiler emits the
    dialect's `FOR UPDATE` / `FOR SHARE` suffix, a no-op on SQLite.
  - `@rudderjs/contracts`: `QueryBuilder` gains optional `lockForUpdate?()` /
    `sharedLock?()` (additive; adapters without row locking omit them).
  - `@rudderjs/queue`: `executeJob` gains an opt-out `invokeFailedHook` flag so the
    database worker fires `failed()` exactly once, on terminal failure (Laravel
    parity); existing drivers are unaffected.

  Deferred to a follow-up (same limits as the BullMQ driver today): chains,
  batches, and closure dispatch.

- e9a3319: Broader conditional helpers on `JsonResource` (Laravel parity): **`whenHas(attribute, value?, fallback?)`** includes only when the attribute is present on the underlying resource (covers Model partial-select hydration; `value` defaults to the attribute). **`whenCounted(relation, fallback?)`** includes the stamped `<relation>Count` only when `withCount('<relation>')` loaded it — a loaded zero is included. **`whenAggregated(relation, fn, column?)`** generalizes to any stamped aggregate alias (`whenAggregated('posts', 'sum', 'views')` reads `postsSumViews`); alias derivation reuses the ORM's own `aggregateAlias` builder, so the helpers can never drift from the loader's camelCase rules. `whenPivotLoaded` is deliberately not included — gated on pivot-column reads (a v1 non-goal).
- 534bd8d: API-resource envelopes (Laravel parity, non-breaking). **`Resource.collection()` now accepts paginator results directly** and auto-derives the envelope `meta`: a `Model.paginate()` result → `meta: { total, page, perPage, lastPage }`; a `Model.cursorPaginate()` result → `meta: { perPage, nextCursor, prevCursor, hasMore }`; a plain array keeps the original behavior. Detection is duck-typed (no `instanceof` — HMR re-import safe), and an explicit `meta` second argument merges over the derived values. **`additional(extra)`** on both `JsonResource` and `ResourceCollection` merges extra top-level keys into the `toResponse()` envelope (alongside `data`/`meta`, never inside; envelope keys win on conflict). **`JsonResource.toResponse(req?)`** wraps a single resource as `{ data: ..., ...additional }` — async-safe where `toJSON()` throws on an async `toArray()`.

### Patch Changes

- f1db9d9: Fix: bound string timestamps no longer store TZ-shifted on the native Postgres engine. porsager/postgres's default `date` type serializer round-trips every bound value the server describes as `date`/`timestamp`/`timestamptz` through `new Date(x).toISOString()` — a plain `'2026-01-20 11:20:45'` string was parsed as machine-local time and silently stored shifted on any non-UTC server (e.g. `Model.create({ at: '2026-01-20 11:20:45' })` landed as `09:20:45` on a UTC+2 machine; UTC CI never showed it). The driver now overrides the type so strings pass through verbatim (Postgres casts text natively, machine-TZ independent). `Date` values keep the exact previous serialization (`toISOString()`, same instant) and reads are unchanged.
- Updated dependencies [e199f5e]
- Updated dependencies [fc97c10]
- Updated dependencies [7e6dc85]
- Updated dependencies [ad17e79]
- Updated dependencies [0b085a6]
- Updated dependencies [b897950]
- Updated dependencies [26b7acf]
- Updated dependencies [b08aa1d]
- Updated dependencies [c66e195]
- Updated dependencies [473dfd9]
- Updated dependencies [a93455e]
  - @rudderjs/contracts@1.10.0
  - @rudderjs/console@1.4.0
  - @rudderjs/core@1.7.0
  - @rudderjs/database@1.1.0

## 1.13.0

### Minor Changes

- edd1747: Native engine Phase 8 (scoped) — ship native as an opt-in SQLite engine.

  The native engine (`@rudderjs/orm/native`) is now wired as a selectable, batteries-included database engine — no external ORM package, just `@rudderjs/orm` + `better-sqlite3`.

  - **`NativeDatabaseProvider`** (auto-discovered via `rudderjs.providerSubpath: './native'`) boots a `NativeAdapter` from `config('database')`. It's **opt-in and inert by default**: it activates only when the default connection sets `engine: 'native'`. Because `@rudderjs/orm` is installed in every app, this config gate is what lets the provider be auto-discovered without clobbering a Prisma/Drizzle adapter — in those apps it discovers, sees no `engine: 'native'`, and returns early. An explicit `nativeDatabase()` helper is also exported for hand-wired `bootstrap/providers.ts`.
  - **Doctor:** new `@rudderjs/orm/doctor` subpath contributes an `orm-native:db-connect` `--deep` check that reuses the driver opened during boot (skips cleanly when the app isn't on native). Registered in the CLI's doctor loader.
  - **`@rudderjs/core`** is now an optional peer of `@rudderjs/orm` (used only by the node-only native provider; the client-bundle gate is unaffected since the main entry never imports the subpath).
  - **Docs:** the database guide documents native as a selectable engine, the `engine: 'native'` config, transactions, the client-safety contract, and the explicit "no native migrations yet — bring your own schema" caveat.

  **Not in scope (deliberate):** `create-rudder` still defaults to Prisma/Drizzle — flipping the scaffolder default needs a native schema/migration story (Phase 7, deferred). Postgres/MySQL and native migrations remain out.

- b03289e: Add the built-in native database engine at the node-only `@rudderjs/orm/native` subpath — Phase 1 (SQLite read path).

  `@rudderjs/orm/native` ships a first-party query engine that talks directly to `better-sqlite3` (an optional peer), alongside the existing optional `@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle` adapters. This first phase implements the **read** path only — `first` / `find` / `get` / `all` / `count` / `paginate`, the full `WhereOperator` set, `where` / `orWhere`, `whereGroup` / `orWhereGroup` with Laravel precedence, ordering, limit/offset, and soft-delete scoping (`withTrashed` / `onlyTrashed`). Write, relation, aggregate, and vector terminals throw `NativeNotImplementedError` until their phases land.

  The engine is split into two seams from day one for runtime portability: a pure `Dialect` (SQL text — `SqliteDialect` first) and a per-platform `Driver` (`execute`/`close` — `BetterSqlite3Driver` now). The SQL compiler is driver-free and fully parameterized — values always flow through bindings, identifiers are validated and quoted — so a React Native / browser driver can drop in later without touching it. The native code lives entirely under the `./native` subpath and is never re-exported from the client-reachable main entry.

- 0f20ccb: Native engine Phase 3 — relations & aggregates at `@rudderjs/orm/native`.

  Implements the relation/aggregate terminals on `NativeQueryBuilder` (previously throwing `NativeNotImplementedError`), compiling correlated subqueries via the existing pure `Dialect`/compiler + `Executor` seams:

  - **`whereRelationExists`** (`whereHas` / `whereDoesntHave`) → correlated `EXISTS` / `NOT EXISTS`. Direct relations (hasMany/hasOne/belongsTo/morphMany/morphOne) compile to a single subquery; through-pivot relations (belongsToMany/morphToMany/morphedByMany) to a nested pivot→related `EXISTS`. `extraEquals` (morph discriminators) and constraint wheres are bound parameters; correlation references the outer table by qualified column.
  - **`withAggregate`** (`withCount`/`withExists`/`withSum`/`withMin`/`withMax`/`withAvg`) → one correlated `(subselect) AS alias` per request in the SELECT list, including through-pivot joins, `extraEquals`, and related-model soft-delete scoping. `exists` wraps the count in `(… ) > 0`; `sum` coalesces to 0.
  - **`_aggregate(fn, column?)`** → single-scalar terminal (`SELECT fn(col) FROM table WHERE …`) powering `instance.loadCount`/`loadSum`/etc. Empty-set semantics: count→0, sum→0, min/max/avg→null, exists→false.

  This makes native's `whereHas` work with **no per-driver setup** — unlike orm-prisma (needs a declared `@relation`) and orm-drizzle (needs a table registry).

  Every value is bound; identifiers are validated + quoted. Binding order is preserved across SELECT-list aggregate subselects and the WHERE.

  **Known limitation (deferred):** direct (non-polymorphic) eager `with()` is not yet native — the current adapter contract passes relation names only, with no join shape, so a direct `with()` would silently return rows without the relation populated. Native now emits a one-time dev-mode warning instead of silently no-op'ing; polymorphic `with()` already works (resolved in the Model layer). Real native direct-eager-load is a contract-gap decision deferred to a later phase.

- 7a258fb: Native engine Phase 4 — transactions.

  Adds first-class database transactions to the ORM, implemented on the native engine (`@rudderjs/orm/native`):

  - **`transaction(fn)`** (exported from `@rudderjs/orm`) and the **`Model.transaction(fn)`** alias run `fn` inside a database transaction. Every `Model` query issued anywhere inside the callback — across any model — executes on the transaction's connection, threaded transparently via `AsyncLocalStorage` (no call-site changes, no explicit handle passing). The unit commits when `fn` resolves and rolls back (re-throwing) when it rejects.
  - **Nesting maps to SAVEPOINTs.** A nested `transaction()` opens a savepoint; an inner failure rolls back only its own work and leaves the outer transaction intact, while an uncaught inner error propagates and rolls back the whole outer transaction.
  - **Contract addition:** `OrmAdapter` gains an **optional** `transaction?<T>(fn: (tx: OrmAdapter) => Promise<T>)`. It passes a transaction-scoped adapter; the Model layer threads it through `AsyncLocalStorage`. Optional = a capability flag — adapters without transaction support omit it, and `transaction()` surfaces a clear error against one. The native engine implements it; the Prisma/Drizzle adapters do not expose it yet (follow-up).
  - The native `Driver` seam gains a `Transaction` type (an `Executor` that can open a nested savepoint); the `better-sqlite3` driver implements BEGIN/COMMIT/ROLLBACK with depth-tracked SAVEPOINT nesting over an async callback.

  Client-bundle-safe by construction: `node:async_hooks` is lazy-imported only from `transaction()`, never at module-eval time, so `@rudderjs/orm`'s main entry stays out of any browser graph (`Client Bundle Smoke` green).

  **Single-connection caveat (SQLite):** transactions assume they aren't run concurrently against one SQLite handle (SQLite serializes writers anyway). Pooled drivers (pg/mysql, later phases) will pin a dedicated client per transaction.

- 0a75a7a: Native engine Phase 2 — the SQLite write path at `@rudderjs/orm/native`.

  Implements the write terminals on `NativeQueryBuilder` (previously throwing `NativeNotImplementedError`), compiling parameterized DML via the existing Dialect/Driver seams:

  - `create(data)` → `INSERT … RETURNING *`; `update(id, data)` → `UPDATE … WHERE pk = ? RETURNING *`
  - `updateAll(data)` / `deleteAll()` → bulk DML; affected count from `RETURNING *` rows
  - `delete(id)` (soft-delete-aware — stamps `deletedAt` when enabled, else hard `DELETE`), `restore(id)`, `forceDelete(id)`
  - `insertMany(rows)` → batched multi-row insert
  - `increment` / `decrement(id, col, amount, extra?)` → atomic `SET col = col ± ?` (no observer events — pure data-plane)

  Every value is bound; identifiers are validated + quoted. Affected-row counts come from `RETURNING *` (`rows.length`), so the `Driver` result shape stays `Row[]` — no driver metadata (`changes`/`lastInsertRowid`) is read.

  **Transaction-aware by construction (no public API yet):** the `Driver` interface gains `transaction(fn)` yielding a transaction-scoped `Executor`, and the query builder runs writes through an `Executor` rather than the top-level connection. This lets the Phase-4 public `transaction()` API slot in without a refactor. `BetterSqlite3Driver` implements it with `BEGIN`/`COMMIT`/`ROLLBACK`.

  Also fixes a Phase-1 issue: `NativeAdapter.disconnect()` now evicts the cached `globalThis` client so a later `make()` with the same `driver::url` signature opens a fresh driver instead of reusing the closed one.

  Conformance: the write + soft-delete slices of the `@rudderjs/orm` Model suite run green against the native engine + in-memory `better-sqlite3` (`native-write.test.ts`); `compiler-write.test.ts` covers INSERT/UPDATE/DELETE/increment SQL shape, bindings, and identifier safety.

### Patch Changes

- fcabe3b: Fix the native SQLite engine throwing on raw boolean bindings.

  `better-sqlite3` only binds numbers, strings, bigints, buffers, and `null` — a raw JS `boolean` raised `TypeError: SQLite3 can only bind …`. The `better-sqlite3` driver now maps `true`/`false` to the integers `1`/`0` (SQLite has no boolean type), so raw boolean values that bypass a column cast bind cleanly: an untyped `where('flag', true)` predicate, or a `query().create({ flag: true })` on a column without a `boolean` cast. Typed boolean columns were already fine — the cast layer serializes `true → 1` before the value reaches the driver. Other unbindable values (`Date`, plain objects) are still passed through so the driver rejects them with its own clear error.

- 4c82967: Decouple `@rudderjs/orm` from `@rudderjs/console` for standalone (any-Node-app) use.

  `@rudderjs/console` was a hard `dependency`, so `npm i @rudderjs/orm` dragged the CLI/`@clack` graph into every install — even a plain Node project that only uses `Model` + the native engine and never touches the framework CLI. It's now an **optional peer** (matching `@rudderjs/core` and `better-sqlite3`).

  The Model layer, the `@rudderjs/orm/native` engine, and `./commands/prune` never imported it; only the framework-CLI subpaths do (`./doctor`, `./commands/migrate` at runtime; `./commands/make-factory` / `./commands/make-seeder` are type-only). Those subpaths only ever load inside a Rudder app, where `@rudderjs/console` is already present via `@rudderjs/cli` / `@rudderjs/core` — so **Rudder apps are unaffected**. Standalone installs now get a leaner dependency graph with no CLI tooling pulled in.

- d1a28f6: Fix `@rudderjs/orm/native` requiring `@rudderjs/core` in a standalone (non-Rudder) Node app.

  The `@rudderjs/orm/native` barrel re-exported `NativeDatabaseProvider`, which `extends ServiceProvider` from `@rudderjs/core` (an optional peer) — so importing the engine eagerly loaded `@rudderjs/core` and crashed (`ERR_MODULE_NOT_FOUND`) in a plain Node project that installed only `@rudderjs/orm` + a driver.

  The framework provider now lives on its own subpath, **`@rudderjs/orm/native/provider`** (auto-discovery picks it up via `rudderjs.providerSubpath` — no app change needed). The `./native` engine barrel is now framework-free, so `import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/orm/native'` works with no `@rudderjs/core` installed.

  Apps that wire the provider by hand should import `nativeDatabase` from `@rudderjs/orm/native/provider` instead of `@rudderjs/orm/native`.

  A new CI gate (`scripts/orm-standalone-smoke.mjs`) packs the package and installs it outside the workspace to certify standalone use and guard against a framework dependency regressing back into the install.

- Updated dependencies [7a258fb]
  - @rudderjs/contracts@1.9.0

## 1.12.11

### Patch Changes

- 9d00619: Make `migrate` / `db:generate` / `db:push` resilient to pnpm 11's
  `verify-deps-before-run` deps-status check, which fatally exits
  (`ERR_PNPM_IGNORED_BUILDS`) when any dependency has an un-approved build script
  (e.g. a transitive `msw` postinstall) — aborting the Prisma/Drizzle command
  before it runs. The CLI now passes `--config.verify-deps-before-run=false` to its
  `pnpm exec` invocations; the dependencies were already installed.

## 1.12.10

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/console@1.2.1

## 1.12.9

### Patch Changes

- 27c0e0e: ORM cast and `JsonResource` errors now include the column / cast type / next step instead of bare opaque text.

  - **`Invalid JSON in "<column>" cast`** (`packages/orm/src/cast.ts:_parseJson`) — now reads `Invalid JSON in cast column "<col>": <first 80 chars>… Verify the column stores serialized JSON; if it stores raw strings, change the cast to "string" or remove it.`
  - **`Vector column "<col>" expected number[], got <type>`** (`cast.ts:103`) — gains a next-step hint pointing at `JSON.parse()` for pgvector text strings AND the `static casts = { <col>: vector({ dimensions: N }) }` declaration.
  - **`Vector cast failed to parse value (…)`** (`cast.ts:91`) — now leads with the column name (renamed the cast `get()` parameter from `_key` → `key` since we're now using it), names the failed input, and points at the `vector(N)` schema column type.
  - **`JsonResource.toJSON() does not support async toArray()`** (`resource.ts:108`) — now names the concrete resource class (`<UserResource>.toJSON()…`) via `this.constructor.name`, and the proposed fix becomes `res.json(await resource.toArray())` instead of the unhelpful "Use toArray() directly."

  No behavior change; only message text + one parameter rename. All 430 ORM tests pass. Found by the Phase 2 error-message audit.

- 2af4fb6: ORM "unset relation key" and "unsaved model" error messages now distinguish `null/undefined` from `not selected` and name the recovery step instead of leaving the user to figure it out.

  - **`Cannot resolve "<relation>" on <Model>`** — `belongsTo`, `hasOne`, `hasMany`, `belongsToMany`, `morphToMany`, `morphedByMany`, and pivot lazy-fetch deferred-query throws now end with: `… is null/undefined. Either save the parent first, or include that column in your select() list when reading the parent.` Same shape across all six call sites in `packages/orm/src/index.ts` plus `packages/orm/src/relations/pivot-deferred.ts`.
  - **`Cannot resolve morphTo "<relation>" on <Model>`** — was `commentableId/commentableType unset.` now `… is null/undefined. Save the morph host first, or assign both columns before calling .related().`
  - **`Cannot {refresh,delete,restore,increment,decrement} a <Model> without a primary key`** — now ends with `. Call .save() / Model.create() first so a primary key is assigned.` across all five instance lifecycle methods.

  No behavior change — only message text. Tests that asserted on the literal `is unset` / `commentableId/commentableType unset` substrings were updated to the new wording (`is null\/undefined`). Found by the Phase 2 error-message audit.

- 18dc667: `make:factory` paired with `make:model` of the same name didn't compile — the factory stub declared `extends ModelFactory<{ name: string; email: string }>`, but `make:model` emits a class with no field declarations, so `Partial<InstanceType<typeof Model>>` (what `Model.create` accepts) had no `name`/`email` keys. TypeScript failed function-parameter contravariance on `modelClass = <Model>` and surfaced `TS2416: Property 'modelClass' is not assignable …`.

  Switched the stub's initial generic to `ModelFactory<any>` so the default `make:model X; make:factory X` pair compiles out of the box. A multi-line comment in the stub explains why and points at the concrete shape the user should tighten to once the model's fields are declared (e.g. `ModelFactory<{ name: string; email: string }>` — the documented pattern). The `any` is intentionally scaffolded-only — `definition()` and the `Model.create` call site still constrain the runtime data. An `// eslint-disable-next-line @typescript-eslint/no-explicit-any` keeps the stub lint-clean. Found by the Phase 1 scaffolder audit.

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
