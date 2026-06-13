# @rudderjs/database

## 1.5.2

### Patch Changes

- cc08369: Fix the SQLite `Schema.table(...).change()` rebuild silently dropping foreign keys and CHECK constraints. SQLite can't alter a column in place, so a `change()` rebuilds the table by reconstructing it from `PRAGMA table_info` + the user indexes — but foreign keys and CHECK constraints live inside the CREATE TABLE body, invisible to `table_info`, so they were lost on every rebuild (including a `change()` on an unrelated column). Referential integrity and enum validation silently disappeared.

  Foreign keys are now reconstructed from `PRAGMA foreign_key_list` (columns, referenced table/columns, and ON DELETE / ON UPDATE actions) and re-emitted on the rebuilt table. CHECK constraints can't yet be reproduced from introspection, so a rebuild of a table carrying one now throws a clear error (`NATIVE_DDL_CHANGE_CHECK`) with a workaround, instead of silently dropping it — full CHECK preservation is a follow-up. Postgres and MySQL are unaffected (their ALTER is in-place).

- Updated dependencies [273eaaa]
  - @rudderjs/contracts@1.17.1

## 1.5.1

### Patch Changes

- 27d29df: Forward `config.options` from a native connection to the underlying driver.

  `NativeConfig` gains an `options?: Record<string, unknown>` field that is threaded through to each built-in driver's `open()` — mysql2 pool/`timezone` options, porsager `postgres()` options (`max`, `ssl`), or better-sqlite3 `Database` options (`readonly`, `timeout`). The driver configs already accepted an `options` field, but the adapter's `openDriver` dead-ended at the URL and silently dropped the app's declarative options. Replica drivers (`readUrls`) open with the same options as the write connection.

  The options are folded into the dev-HMR cache signature, so editing them in `config/database.ts` disposes and reopens the connection instead of reusing a stale driver. The no-options signature is unchanged.

- Updated dependencies [7c79edc]
- Updated dependencies [5c80378]
  - @rudderjs/contracts@1.15.0

## 1.5.0

### Minor Changes

- 361b298: Nested `whereHas` / `whereDoesntHave` inside constrain callbacks now works on the native engine: `User.whereHas('posts', q => q.where('published', true).whereHas('comments', c => c.where('approved', true)))`. Strictly more expressive than the dot-path form — constraints at EVERY level (not just the deepest), inner `whereDoesntHave` ("posts with NO flagged comments"), sibling branches that AND together, unbounded recursion, and dot-paths composing inside callbacks. The predicate contract's `nested` field widens to `RelationExistencePredicate | RelationExistencePredicate[]` (dot-paths keep the singular form; existing emitters unaffected) and the native compiler normalizes each level to a child list, compiling one correlated EXISTS per child with its own polarity and constraints. Drizzle and Prisma keep rejecting nested predicates via the `supportsNestedRelationPredicates` marker guard with a clear error (adapter implementations planned separately). `withWhereHas` with a nesting callback falls back to plain `with()` — the flat `withConstrained` shape can't carry children.
- c1c8b58: `whereHas` / `whereDoesntHave` / `has(relation, op, n)` / `withCount` and the other aggregates now work on through relations (`hasOneThrough` / `hasManyThrough`) on all three adapters — Laravel parity for the previously documented v1 gap. The predicate reuses the pivot two-hop `through` shape with the intermediate table in the pivot slot, plus a new `through.fanOut` marker (`@rudderjs/contracts`) for the 1:N intermediate→related cardinality: plain existence keeps the fan-out-safe nested-EXISTS shape, while count comparisons and aggregates run over the JOINED far rows — counts count far rows (a country reaching 3 posts via 2 users has `postsCount === 3`), and a bare intermediate row never satisfies existence. Constrain callbacks apply to the far table (Laravel semantics); nested dot-paths may include through levels; `withWhereHas` on a through relation falls back to plain `with()` (the two-hop eager load is Model-layer). Drizzle requires the intermediate table registered in `tables: { ... }` (same as pivots); Prisma routes whereHas through the existing deferred 2-step lookup and aggregates through a new fan-out-aware batch path. Also fixes a latent Drizzle bug: the pivot-aggregate JOIN's ON clause rendered unqualified column names — ambiguous whenever pivot and related share a column name (always true for through relations, both having `id`).

### Patch Changes

- b1f748d: Fix timestamp and soft-delete stamping on the native MySQL engine. The Model layer stamped `createdAt`/`updatedAt`/`deletedAt` as ISO-8601 strings — MySQL strict mode rejects the trailing `Z` (`Incorrect datetime value`), so every `create()`/`save()`/soft `delete()` on a timestamps-enabled table failed on native MySQL. Stamps are now `Date` objects and each driver serializes them in its own wire format: the sqlite driver normalizes `Date` → ISO-8601 UTC text at bind time (the same stored format as before — no migration needed), pg and mysql2 handle `Date` natively. Side effect: `Date` values in any payload now bind on sqlite instead of throwing better-sqlite3's `can only bind` error, and `creating`/`saving` observers see a `Date` (not a string) in stamped fields.
- Updated dependencies [361b298]
- Updated dependencies [c1c8b58]
  - @rudderjs/contracts@1.14.0

## 1.4.0

### Minor Changes

- dca4bf5: schema:types now folds blueprint-declared column types into the generated registry as a fallback layer for cast-less columns — precedence is `cast > blueprint intent > introspected storage type`. On SQLite a `t.boolean()` column types as `boolean` (instead of the INTEGER affinity's `number`) and `t.json()`/`t.jsonb()` as `unknown` (instead of `string`, which wrongly rejected the object writes the engine JSON-stringifies) without declaring any model cast. Intent is recovered by replaying the APPLIED migrations' blueprints against an in-memory ledger at generation time — no DDL or data statements re-execute (a guard at the adapter's executor funnel refuses runtime statements during replay and the migration's remaining intent is skipped). Date/time columns deliberately stay storage-typed without a cast: a cast-less SQLite column reads strings and rejects `Date` bindings, so the `date`/`datetime` cast remains the way to get `Date` semantics. New exports: `collectBlueprintIntent`/`TableIntent` (`@rudderjs/database/native`); `runNativeSchemaTypes` accepts an optional migrations-dir argument and `NativeAdapter.generateSchemaTypes` an optional intent map.

## 1.3.1

### Patch Changes

- b74544d: Native engine: plain-object and array bindings now JSON-stringify at the compiler's binding funnel, so an object payload on a `t.json()` column works without declaring `static casts = { col: 'json' }`. Previously better-sqlite3 threw the opaque `TypeError: You cannot specify named parameters in two different objects`, mysql2 silently mangled the object into `` `key`='val' `` SQL pairs, and Postgres only survived when the server described the param as json/jsonb — all three dialects now store identical JSON text, round-tripping with the `json` cast's read path and pg/mysql's native JSON column parsing. `Date`/`Buffer`/class-instance bindings keep their driver-level handling.

## 1.3.0

### Minor Changes

- da07742: Automatic `createdAt`/`updatedAt` stamping (Laravel's `$timestamps`, `static timestamps = true` by default). On the native engine, `Model.create()` now stamps both columns and `update()`/`save()` bumps `updatedAt` — previously they were written NULL unless the migration added DB defaults. Stamping is schema-gated via the new optional `OrmAdapter.tableColumns()` capability (implemented by `NativeAdapter` with cached introspection): tables without the columns are silently skipped, and Prisma/Drizzle are untouched (their schemas own timestamp defaults). Opt out per model with `static timestamps = false`.
- bef393f: Generated type registries consolidate under the committed `.rudder/types/` directory: `views.d.ts` (was `pages/__view/registry.d.ts`), `routes.d.ts` (was `routes/__registry.d.ts`), `models.d.ts` (was `app/Models/__schema/registry.d.ts`). The Vike page stubs stay in `pages/__view/` (pinned by Vike's filesystem routing).

  Migration is automatic — the first dev/build/`routes:sync`/`view:sync`/`migrate` after upgrading writes the new path and deletes the legacy file. One manual step for existing apps: add `".rudder/**/*"` to the `tsconfig.json` `include` array (dot-directories are invisible to `**/*` globs and to bare-directory include entries; new scaffolds ship it). A `.rudder/README.md` is generated alongside, describing each file and its regen command.

### Patch Changes

- Updated dependencies [da07742]
  - @rudderjs/contracts@1.13.0

## 1.2.1

### Patch Changes

- d346185: Suppress Vite's "dynamic import cannot be analyzed" dev-server warning from the native migrator. The migration-file loader imports user files from a runtime-computed path by design, so the import is marked `/* @vite-ignore */`.

## 1.2.0

### Minor Changes

- f3cf833: fix: make the schema ALTER + fresh paths real on Postgres/MySQL — three latent bugs surfaced by the first live DDL coverage: (1) `migrate:fresh` read `sqlite_master` unconditionally, so it threw on pg/mysql native connections — `Migrator.dropAllTables()` now delegates to the new dialect-aware `SchemaBuilder.dropAllTables()` (catalog via `information_schema`, FK-safe sweep: pg drops with `CASCADE`, mysql wraps the batch in `FOREIGN_KEY_CHECKS=0`, sqlite unchanged), with `SchemaBuilder.allTables()` exposed alongside; (2) foreign keys declared in a `Schema.table(...)` alter (`constrained()` columns or table-level `foreign()`) were silently dropped on pg/mysql — they now emit `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`, and `dropForeign(nameOrColumns)` emits `DROP CONSTRAINT` (pg) / `DROP FOREIGN KEY` (mysql); (3) `dropIndex()` compiled to the standalone `DROP INDEX "name"` form, which MySQL rejects — it now emits the table-scoped `DROP INDEX … ON <table>` there.
- a0206a6: feat: column `.change()` on Postgres and MySQL (7.4b) — `Schema.table('users', (t) => t.string('email', 100).nullable().change())` now compiles to native DDL instead of throwing: one comma-joined `ALTER TABLE … ALTER COLUMN` statement on pg (TYPE + SET/DROP NOT NULL + SET/DROP DEFAULT — the chained definition fully replaces the old one, Laravel semantics; type conversions rely on pg's implicit casts, incompatible ones need a raw `USING` via `DB.statement`), and a single `MODIFY` carrying the full new spec on mysql (positional `.after()`/`.first()` compose). Changes mix freely with other alter ops in one `Schema.table` call on pg/mysql (renames → changes → adds → indexes → FKs → drops). SQLite keeps the table-rebuild path unchanged. Changing a column into a primary-key/auto-increment column throws a clear `NATIVE_DDL_CHANGE_PRIMARY` error.
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
- d89d2cd: feat: lock wait-behavior options — `lockForUpdate(opts?)` / `sharedLock(opts?)` accept `{ skipLocked?: boolean }` (skip rows another transaction holds — `FOR UPDATE SKIP LOCKED`, the concurrent job-reservation pattern) or `{ noWait?: boolean }` (fail immediately instead of blocking — `NOWAIT`). Mutually exclusive — both set throws at the call site. The native engine emits the clauses via `Dialect.lockSql(mode, opts)` on Postgres/MySQL 8 (SQLite stays a no-op, options included); the Drizzle adapter maps to `.for(strength, { skipLocked | noWait })` on pg/mysql. Prisma keeps throwing on the lock methods (no `FOR UPDATE` in its query API).
- 255a755: feat: after-commit hooks — `afterCommit(fn)` (orm) and `DB.afterCommit(fn)` / `DB.connection(name).afterCommit(fn)` (facade) queue side effects (emails, webhooks, queue dispatches) to run only after the transaction open in the current async context commits, mirroring Laravel's `DB::afterCommit`. Callbacks flush in registration order after the OUTERMOST transaction commits (the awaited `transaction()` resolves after they finish) and are dropped on rollback; a rolled-back savepoint discards only the callbacks registered inside it, a released savepoint hands its callbacks to the enclosing level. Named-connection transactions keep separate queues (pass `{ connection }` to target one explicitly); with no open transaction the callback runs immediately. The queue lives in the orm's `transaction()` wrapper itself — above the adapter seam — so it works identically on the native engine, Drizzle, and Prisma. `@rudderjs/database` gains the `registerAfterCommitRunner`/`resolveAfterCommitRunner` bridge seam and the facade methods.
- 1da0b39: Weighted/custom read-replica picker on read/write-split connections. `read.picker` in `config/database.ts` selects the replica per query: `'round-robin'` (default, the previous behavior), `'random'`, a weights array (one non-negative weight per replica — `[3, 1]` sends ~75% of reads to the first), or a custom `(count) => index` function (Drizzle's `getReplica` equivalent). Shared `makeReplicaPicker` in `@rudderjs/database` powers both the native engine and the Drizzle adapter: malformed weight lists fail fast at adapter construction, a custom function's return is validated per call, and the picker runs after the sticky check so a sticky-routed read never consumes a pick.
- 1b8474a: Multi-database migrations on the native engine (Laravel `--database` / `Schema::connection` parity). `migrate`, `migrate:status`, `migrate:rollback`, `migrate:reset`, `migrate:refresh`, and `migrate:fresh` take `--connection=<name>` — the suite runs against the named connection with its `migrations` state table on that connection — plus `--path=<dir>` to keep per-database migration sets apart. Works even when the app's default engine is prisma/drizzle, as long as the named connection is `engine: 'native'`. Inside migrations (or anywhere the app has booted), `Schema.connection('reporting').create(…)` scopes one DDL operation to a named native connection through the same resolver seam as `DB.connection()`; non-native connections throw a clear error, and the call refuses under `migrate --pretend` (the dry run can't record a second connection). Cross-connection DDL runs outside the migrator's batch transaction — documented boundary.
- ac3d8d0: feat: typed window functions on the native engine — `selectWindow(fn, { as, partitionBy, orderBy })` adds `ROW_NUMBER` / `RANK` / `DENSE_RANK` / `PERCENT_RANK` / `CUME_DIST` … `OVER (PARTITION BY … ORDER BY …)` projections. Additive (rows still hydrate as full models with the alias as an extra attribute), identifier-quoted throughout, identical SQL on SQLite 3.25+/Postgres/MySQL 8. Available as a `Model` static and on query chains; Drizzle/Prisma throw the forward-or-throw guard error. Aggregates-OVER / lag / lead / frames stay on the documented `selectRaw` recipe.
- eb3bdfe: feat: transaction isolation levels — `transaction(fn, { isolationLevel })` / `DB.transaction(fn, { isolationLevel })` / `Model.transaction(fn, { isolationLevel })` with `'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'`. The native engine emits `SET TRANSACTION ISOLATION LEVEL …` at transaction start on Postgres/MySQL; the Drizzle adapter passes the level through to Drizzle's transaction config; the Prisma adapter maps it to `$transaction`'s `isolationLevel` option. SQLite throws a clear unsupported error (no isolation levels — single-writer is already serializable), and a nested `transaction()` call (savepoint) rejects the option on every adapter.

### Patch Changes

- Updated dependencies [345d805]
- Updated dependencies [d89d2cd]
- Updated dependencies [eb3bdfe]
  - @rudderjs/contracts@1.12.0

## 1.1.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

- ad17e79: feat(orm): `onQuery` query listening on the native engine + app-facing `DB.listen()`

  Laravel's `DB::listen` arrives in RudderJS:

  - **`@rudderjs/contracts`**: `onQuery?(listener)` is now an optional capability on the `OrmAdapter` contract, with new `QueryEvent` (`{ sql, bindings, duration, connection?, model? }`) and `QueryListener` types — the shape Telescope's QueryCollector and Pulse's slow-query recorder already consume.
  - **`@rudderjs/orm` (native engine)**: the `NativeAdapter` implements `onQuery` by instrumenting its executor — every executed query (Model reads/writes, `DB.*` raw calls, and queries inside `transaction()`, which share the top-level listener list) is timed with `performance.now()` and reported with its SQL + bindings. Listener errors are swallowed and never break the query; only successful executions report (Laravel `QueryExecuted` parity). Transaction control statements (BEGIN/COMMIT/SAVEPOINT) are not reported.
  - **`@rudderjs/database`**: new `DB.listen(listener)`, mirroring Laravel's `DB::listen` — delegates to the active adapter's `onQuery` hook and throws a clear adapter-named error when the adapter doesn't support query listening. `QueryEvent` / `QueryListener` are re-exported.
  - **`@rudderjs/orm-prisma`**: the existing ad-hoc `onQuery` method is now typed to the shared contract (no behavior change).

  The Drizzle adapter does not implement the hook yet — `DB.listen()` throws its clear unsupported error there; a follow-up adds it.

- b897950: Named database connections (multi-connection PR1): `DB.connection('name')` + a lazy `ConnectionManager` + per-connection transaction scoping.

  - **`@rudderjs/orm`**: new `ConnectionManager` (globalThis-backed registry of lazy connection factories — registering does no I/O and no driver import, so `config/database.ts`'s `connections` map keeps its menu semantics). `transaction(fn, { connection: 'name' })` runs a transaction on a named connection; the transaction ALS now keys scoped adapters **by connection name**, so a named-connection transaction never captures default-connection queries (and vice versa). `ModelRegistry.getAdapter(name?)` / `getScopedAdapter(name?)` resolve named connections. The native provider registers a factory for every `engine: 'native'` connection (the default stays eager and shares one adapter with `DB.connection(default)`), and the native dev-HMR driver cache is now per-connection (a config edit disposes/reopens only that connection's driver).
  - **`@rudderjs/database`**: `DB.connection(name)` — a scoped facade (`select`/`insert`/`update`/`delete`/`statement`/`transaction`/`listen`) over a named connection, opened lazily on first use; inside `transaction(fn, { connection: name })` its calls join that open transaction. New bridge hooks (`registerConnectionResolver`, `registerNamedTransactionRunner`) keep the orm→database dependency direction.

  `Model.on('name')` / per-model `static connection` and read/write splitting land in follow-up PRs (see `docs/plans/2026-06-03-orm-multi-connection-read-write-split.md`).

### Patch Changes

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

- Updated dependencies [e199f5e]
- Updated dependencies [fc97c10]
- Updated dependencies [7e6dc85]
- Updated dependencies [ad17e79]
- Updated dependencies [0b085a6]
- Updated dependencies [26b7acf]
- Updated dependencies [b08aa1d]
- Updated dependencies [c66e195]
- Updated dependencies [473dfd9]
- Updated dependencies [a93455e]
  - @rudderjs/contracts@1.10.0
