# @rudderjs/orm-drizzle

## 1.8.0

### Minor Changes

- d472fd3: Pessimistic locking parity across adapters. **Drizzle**: `lockForUpdate()` / `sharedLock()` are now real — rendered via the builder's `.for('update' | 'share')` on pg/mysql, no-op on sqlite (no row locks; matches the native engine), skipped on union'd queries (`FOR UPDATE` isn't valid on a set operation). **Prisma**: both methods now throw a clear error with a raw-transaction pointer instead of failing with a bare `is not a function` — a silent no-op would be a correctness bug for job-queue-style reservations.
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

- 72282fc: Date-component predicates (`whereDate` / `whereTime` / `whereDay` / `whereMonth` / `whereYear` + `orWhere*` forms) and `whereNot` / `orWhereNot` negated groups are now real on the Drizzle adapter — same surface and semantics as the native engine. The per-dialect extraction SQL mirrors the native `Dialect.dateExtract` (sqlite `strftime` with `CAST(... AS INTEGER)` for day/month/year, pg `::date`/`::time`/`EXTRACT(...)::int`, mysql `DATE()`/`TIME()`/`DAY()`/`MONTH()`/`YEAR()`); `Date` values compare by their UTC components and numeric strings coerce on day/month/year. `whereNot` wraps the callback's conditions in `NOT (...)` via Drizzle's `not()`; named sugar (`whereIn`, `whereNull`, ...) composes inside the callback.
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

- 0d58a88: `onQuery` query listening on the Drizzle adapter — completes `DB.listen()` coverage across all three adapters (native, Prisma, Drizzle). Every fluent query reports `{ sql, bindings, duration, connection }` to registered listeners (SQL text + params via the builder's `toSQL()`), the raw `DB.*` seams (`selectRaw` / `affectingStatement`) report their text + bindings directly, and transaction-scoped queries report to the same listeners as top-level ones. Listener errors are swallowed; only successful executions report (Laravel `QueryExecuted` parity). pgvector similarity queries (raw `db.execute` path) are not reported.
- 65a92dd: Real `union()` / `unionAll()` on the Drizzle adapter — built on Drizzle's native set operators instead of throwing. Each member contributes its select body (its own ORDER BY / LIMIT are dropped); the base query's ORDER BY / LIMIT / OFFSET apply to the whole compound, and `count()` / `paginate()` count the combined rows. This was the last throwing query-builder method on Drizzle — the native and Drizzle adapters now have full query-builder parity (`selectRaw` remains the one DB-facade pointer).
- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

- f17742b: Named database connections on the Prisma and Drizzle adapters (multi-connection PR4a).

  Both providers now register a lazy `ConnectionManager` factory for every connection they claim in `config/database.ts` (connections selecting another engine — e.g. `engine: 'native'` — are skipped), so `DB.connection('reporting')`, `Model.on('reporting')`, and per-model `static connection` work on Prisma/Drizzle apps. The default connection boots eagerly through the same manager entry, sharing one adapter/client with the Models. The dev-HMR client caches are per-connection now (keyed by connection name): each named connection holds its own client, a config edit disposes/reopens only that connection, and a second named connection no longer evicts the first. Prisma query events report the connection name. Read/write-split config (`read:`/`write:`) fails loudly at boot on both adapters — Prisma points at `@prisma/extension-read-replicas` (or the native engine); Drizzle points at the native engine, with real Drizzle routing planned as a follow-up.

- bf1cca0: feat(orm): `distinct()` — SELECT DISTINCT (Laravel parity)

  `Model.query().distinct().get()` de-duplicates the result rows; pair it with `select(...)` to de-duplicate on specific columns. With `distinct()`, `count()` / `paginate()` count the distinct rows.

  Native engine only — on Drizzle and Prisma it throws with a pointer to the native engine / `DB.select(...)`, consistent with joins / groupBy / union.

- aed0757: Real `groupBy` / `having` / `distinct` on the Drizzle adapter

  `groupBy(...cols)`, `having`/`orHaving`/`havingRaw`/`orHavingRaw`, and `distinct()` now build native Drizzle queries instead of throwing — mapping onto Drizzle's `.groupBy()`, `.having()` and `.selectDistinct()`. `count()`/`paginate()` of a grouped or distinct builder wrap the projection as a subquery and `COUNT(*)` its rows, so they return the group count / distinct-row count (Laravel parity). The grouped count path projects just the GROUP BY keys for strict-dialect portability. Aggregate projections (`COUNT(*) AS total`) still require `selectRaw` (which throws on Drizzle) → filter aggregates with `havingRaw('COUNT(*) > ?', [n])`. `union`/`unionAll` remain a separate follow-up.

- 35929a8: feat(orm-drizzle): real joins + structured `select()`

  `join` / `leftJoin` / `rightJoin` / `crossJoin` and `select(...)` now work on the Drizzle adapter (previously they threw). They build on Drizzle's native `.innerJoin()` / `.leftJoin()` / `.rightJoin()` / `.crossJoin()`.

  - Referenced tables must be registered (via `tables: {...}` config or `DrizzleTableRegistry`), same requirement as `whereHas`.
  - With a join and no explicit `select(...)`, the projection defaults to the base table's columns so each row still hydrates as the base model (the join filters / fans out rows). `select('users.name', 'posts.title')` overrides the projection.
  - Simple form `join('posts', 'posts.userId', '=', 'users.id')` and callback form `join('posts', j => j.on(...).where(...))`.

  `groupBy` / `having` / `union` / `distinct` still throw on Drizzle (separate follow-ups) — use the native engine or the `DB` facade for those.

- e87bcb9: Real read/write splitting + sticky reads on the Drizzle adapter. `read` / `write` / `sticky` connection config (same shape as the native engine) now routes un-locked SELECT terminals and raw `DB.select` to a round-robin read pool — replica clients are opened per `readUrls` through the same lazy driver path as the write client — while writes, DDL, locked selects, and every transaction statement stay on the write connection. Sticky reads share the `@rudderjs/orm/sticky` request scope (the provider auto-installs the database-context middleware on the `web` + `api` groups), query events carry `target: 'read' | 'write'` on split connections plus the connection name (`connectionName ?? dialect`), the dev-HMR client cache holds the replica clients (replica list is part of the signature), and `disconnect()` closes them. Replaces the former boot-time throw for `read:` / `write:` config on Drizzle connections.
- 0b085a6: feat(orm): query-builder breadth — joins, structured `select()`, `groupBy` / `having`

  Adds Laravel-style joins, column projection, and grouping to the query builder. The native engine fully supports them:

  - **Joins** — `join` / `leftJoin` / `rightJoin` / `crossJoin`, with column-vs-column `on()` and bound `where()` conditions. Simple form `join('posts', 'posts.userId', '=', 'users.id')` and callback form `join('posts', j => j.on(...).where(...))`.
  - **Projection** — `select('users.id', 'posts.title')` (quoted, qualified columns; combines with `selectRaw`).
  - **Grouping** — `groupBy(...columns)` + `having(col, op, value)` / `orHaving` / `havingRaw('COUNT(*) > ?', [3])` / `orHavingRaw`. With a `GROUP BY` present, `count()` / `paginate()` count the number of groups (wrapped subquery), matching Laravel.

  Each is also a `Model` static (`User.join(...)`, `User.select(...)`, `User.groupBy(...)`, `User.having(...)`).

  On the Drizzle and Prisma adapters these throw with a pointer to the native engine or the `DB` facade — their typed clients can't map a join/projection/grouping result back to a single hydrated model (the same reason `selectRaw` throws there). Use `@rudderjs/orm/native`, or `DB.select(sql, bindings)`.

  `JoinClause` (the join-callback sub-builder type) is exported from `@rudderjs/contracts` and re-exported from `@rudderjs/orm`.

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

### Patch Changes

- 4a894cc: fix(orm-drizzle): `.with()` eager loading throws instead of silently dropping

  Direct-relation eager loading (`Model.with('author').get()`) was never
  implemented on the Drizzle adapter — `with()` was a no-op that returned the rows
  with the relation **unloaded**, so it looked like it worked while loading
  nothing. It now throws an actionable error instead, so a missing relation can't
  masquerade as success.

  **Behavior change** (the prior behavior was silent data-not-loaded): code that
  called `.with(...)` on a Drizzle-backed model and ignored the result no longer
  silently no-ops — it throws, pointing at the `related()` accessor / Drizzle's
  relational query API. `withWhereHas` (which implies eager loading) throws on
  Drizzle for the same reason — use `whereHas(relation)` for the filter-only case
  (it never calls `with()`). Polymorphic relations are eager-loaded in the ORM's
  Model layer and are unaffected.

  Full direct-relation eager loading on Drizzle is a follow-up.

- Updated dependencies [e199f5e]
- Updated dependencies [0e7db2c]
- Updated dependencies [fc97c10]
- Updated dependencies [7e6dc85]
- Updated dependencies [0109afb]
- Updated dependencies [0dcecaf]
- Updated dependencies [363d942]
- Updated dependencies [12b4a55]
- Updated dependencies [4085846]
- Updated dependencies [6f8760d]
- Updated dependencies [083672b]
- Updated dependencies [8ba6e7d]
- Updated dependencies [b31d1be]
- Updated dependencies [0d6c280]
- Updated dependencies [3b995b7]
- Updated dependencies [5eb4dd8]
- Updated dependencies [536b64d]
- Updated dependencies [ea9b982]
- Updated dependencies [ad17e79]
- Updated dependencies [f6afdf8]
- Updated dependencies [e25472c]
- Updated dependencies [ca644ad]
- Updated dependencies [bf1cca0]
- Updated dependencies [bc76570]
- Updated dependencies [acc2245]
- Updated dependencies [0b085a6]
- Updated dependencies [468dcd4]
- Updated dependencies [ffbb7f7]
- Updated dependencies [b897950]
- Updated dependencies [caff11d]
- Updated dependencies [26b7acf]
- Updated dependencies [ea510e0]
- Updated dependencies [b08aa1d]
- Updated dependencies [6bd32b0]
- Updated dependencies [370d2ec]
- Updated dependencies [c66e195]
- Updated dependencies [473dfd9]
- Updated dependencies [6e83e26]
- Updated dependencies [5617ec2]
- Updated dependencies [bb07d54]
- Updated dependencies [7b5d000]
- Updated dependencies [f1db9d9]
- Updated dependencies [a93455e]
- Updated dependencies [e9a3319]
- Updated dependencies [534bd8d]
  - @rudderjs/contracts@1.10.0
  - @rudderjs/orm@1.14.0
  - @rudderjs/ai@1.11.0
  - @rudderjs/console@1.4.0
  - @rudderjs/core@1.7.0
  - @rudderjs/support@1.5.0

## 1.7.1

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/ai@1.10.2
  - @rudderjs/console@1.2.1
  - @rudderjs/core@1.5.1
  - @rudderjs/orm@1.12.10

## 1.7.0

### Minor Changes

- 5d80f06: Require `drizzle-orm` `^0.45.2` (was `^0.38.0`) to clear a high-severity advisory in the 0.38–0.44 range, and pin `kysely` (drizzle's optional peer) to `^0.28.17` to clear its advisory. The adapter's drizzle imports (`sqliteTable`, `pgTable`, `mysqlTable`, `PgDialect`, `drizzle`, etc.) are unchanged across the bump — build, typecheck, and the full 105-test integration suite (better-sqlite3 + pglite) pass against 0.45.2.

### Patch Changes

- Updated dependencies [d2cf530]
  - @rudderjs/ai@1.9.0

## 1.6.2

### Patch Changes

- 8e5f6b0: Reuse one drizzle client across dev HMR re-boots instead of opening a fresh driver connection on every edit. `DrizzleAdapter.make()` now caches the live client on `globalThis.__rudderjs_drizzle_client__`, keyed by the resolved connection signature (driver + url): an unchanged signature reuses the client; a changed signature (a `config/database.ts` edit) builds a fresh client and disposes the superseded driver (`postgres.end()` / `pool.end()` / `libsql.close()` / `better-sqlite3.close()`). Mirrors the orm-prisma fix (#652) — without it, each dev re-boot leaked a connection (catastrophic on pooled drivers like MySQL: ~10–20 server connections per leaked pool). No-op in production (single boot); apps passing their own `config.client` opt out entirely.
- Updated dependencies [6f3cb2a]
- Updated dependencies [3bf71b9]
  - @rudderjs/core@1.4.0
  - @rudderjs/support@1.4.0

## 1.6.1

### Patch Changes

- 14b1ab9: Fix `increment` / `decrement` / `deleteAll` / `updateAll` on Drizzle + MySQL.

  MySQL drivers don't support `RETURNING`, so the existing implementations
  either threw (`increment` / `decrement` — "returned no rows") or silently
  reported a 0-row count (`deleteAll` / `updateAll`). The 0-count broke the
  `prune --mass` chunk loop, which exits as soon as the affected count drops
  below the chunk size — on MySQL it always exited after the first pass with
  rows still in the table.

  `DrizzleConfig` gains a new optional `dialect: 'pg' | 'mysql' | 'sqlite'`
  field. It's inferred from `driver` when present (`'postgresql'` → `'pg'`,
  `'sqlite'` / `'libsql'` → `'sqlite'`, `'mysql'` → `'mysql'`), and defaults
  to `'pg'` when a pre-built `client` is supplied without an explicit dialect
  (matches the previous code path, so existing Postgres / SQLite users see no
  behavior change).

  On MySQL:

  - `increment` / `decrement` run the `UPDATE` then re-select the target row
    (two round-trips instead of one — the trade-off for losing `RETURNING`).
  - `deleteAll` / `updateAll` read `affectedRows` from the driver result
    metadata. Both `mysql2`'s `affectedRows` and planetscale-serverless's
    `rowsAffected` shapes are accepted.

  `'mysql'` is now a valid `driver` value in `DrizzleConfig` and
  `DatabaseConnectionConfig`. When used, the adapter boots a `mysql2/promise`
  pool and routes it through `drizzle-orm/mysql2`. `mysql2` is declared as an
  optional peer.

  Closes Phase 4 of `docs/plans/2026-05-21-framework-orm-correctness.md`.

- c5e2408: fix(orm): `find(id)` composes accumulated wheres / scopes / soft-deletes

  Previously, `Model.find(id)` bypassed the query chain entirely on both adapters. `User.where('tenantId', t).find(5)` would return rows across tenants — a cross-tenant data leak by default. Drizzle honored the soft-delete scope but ignored everything else; Prisma ignored all of it.

  The fix:

  - **Prisma**: `find()` now uses `findFirst` (was `findUnique`) so the PK match can be AND-composed with the accumulated where chain, soft-delete filter, global scopes, and relation predicates. Empty chain stays as `{ id }` — no needless `AND` wrapper.
  - **Drizzle**: `find()` now uses the same `buildConditions()` aggregator that `get()` does, so it composes wheres + orWheres + soft-delete + `whereGroup` / `whereRelationExists` subqueries with the PK match. Drops the manual soft-delete-only branch.

  Regression tests added on both adapters:

  - Drizzle (real in-memory sqlite via integration suite): `where('age', '>=', 31).find(aliceId)` returns null when Alice is 30; `where('age', '>=', 30).find(aliceId)` resolves her.
  - Prisma (capturing client): asserts `findFirst` (not `findUnique`) is called; verifies the composed `{ AND: [{ id }, { tenantId }] }` shape; confirms unchained `find(id)` stays as plain `{ id }`.

  Note: this fix uses the existing `id` literal as the primary key column. The companion plan phase (`docs/plans/2026-05-21-framework-orm-correctness.md` Phase 2) covers threading `Model.primaryKey` through the adapter contract for non-`id` PK models.

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

- Updated dependencies [d24a914]
- Updated dependencies [a99ed3d]
- Updated dependencies [1553c9a]
- Updated dependencies [41f68b1]
- Updated dependencies [6652117]
- Updated dependencies [3e60f95]
  - @rudderjs/ai@1.8.1
  - @rudderjs/core@1.2.0
  - @rudderjs/orm@1.12.0
  - @rudderjs/contracts@1.8.0

## 1.6.0

### Minor Changes

- a3a7368: Phase 3 of `rudder doctor` — first wave of package-contributed checks.

  Thirteen framework packages now ship a `<package>/doctor` subpath whose
  side-effect import registers domain-specific health checks on the shared
  doctor registry. The CLI's lazy loader auto-imports them when
  `rudder doctor` runs.

  New checks (14 total, grouped by category):

  - **auth** — `auth:secret` (AUTH_SECRET set + length sane), `auth:views-vendored`
    (vendored when a frontend renderer is installed).
  - **auth** (cont.) — `session:secret` (SESSION_SECRET length when set), `hash:driver`
    (config string ∈ {bcrypt, argon2}; flags missing `argon2` peer).
  - **orm** — `orm-prisma:schema` (schema files present), `orm-prisma:client-generated`
    (mtime check vs schema), `orm-prisma:database-url`, `orm-drizzle:schema`,
    `orm-drizzle:database-url`.
  - **billing** — `cashier-paddle:api-key`, `cashier-paddle:webhook-secret`
    (both conditional on a cashier route being mounted).
  - **queue** — `queue-bullmq:redis-url`, `queue-inngest:event-key`,
    `queue-inngest:signing-key`.
  - **ai** — `ai:provider-keys` (greps `config/ai.ts` for declared driver
    literals, then checks each cloud provider's API key env var).
  - **mcp** — `mcp:route-mounted` (if `app/Mcp/` has tools, mcp route is
    registered).
  - **monitoring** — `telescope:dashboard`, `pulse:dashboard`,
    `horizon:dashboard` (dashboard route reachable from `routes/web.ts`).

  Adding a new contributing package: ship a `<package>/doctor` subpath with
  side-effect `registerDoctorCheck` calls and append the package name to
  `PACKAGES_WITH_CHECKS` in `@rudderjs/cli/src/doctor/load-package-checks.ts`.

  Implementation notes:

  - The CLI's loader resolves doctor subpaths via direct path
    (`<cwd>/node_modules/<pkg>/dist/doctor.js`), not `createRequire.resolve`,
    because the `./doctor` exports condition is `import`-only (no `require`)
    and the strict-mode pnpm node_modules don't expose user-installed
    packages from the CLI's location. Documented as the ESM-only-peer
    resolution workaround.
  - `deps:auth-views` was removed from the CLI's built-in checks — the
    identical concern now lives at `auth:views-vendored` in
    `@rudderjs/auth/doctor`, where it belongs. Net check count for a user
    with `@rudderjs/auth` installed: same (one each); for a user without
    auth, doctor stays silent on the topic instead of saying "auth not
    installed — skip".

  No tests added in this phase — each check is small enough to be tested
  implicitly via integration smoke (the existing temp-dir test suite in
  `@rudderjs/cli`, plus a manual smoke against `playground/`). Per-package
  test suites for these checks may land in a follow-up.

  Phase 4 (`--deep`) and Phase 5 (`--fix`) follow in subsequent releases.

### Patch Changes

- Updated dependencies [b28e51f]
- Updated dependencies [a3a7368]
  - @rudderjs/console@1.1.0
  - @rudderjs/ai@1.8.0

## 1.5.2

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/ai@1.6.3
  - @rudderjs/contracts@1.6.1
  - @rudderjs/core@1.1.5
  - @rudderjs/orm@1.9.2
  - @rudderjs/support@1.2.2

## 1.5.1

### Patch Changes

- 7eab2d2: Author `boost/guidelines.md` for the 6 packages that previously had no boost content. Adopting apps now get per-package guidelines for these packages too — `@rudderjs/boost` was already capable of consuming them, only the source content was missing.

  Also adds `"boost"` to the `files` array in `package.json` for the 5 packages that didn't include it (`@rudderjs/terminal` already did), so the guidelines actually ship via npm.

  No code changes.

- Updated dependencies [d0db9f0]
  - @rudderjs/ai@1.6.1
  - @rudderjs/orm@1.9.1

## 1.5.0

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

- Updated dependencies [82ca5b4]
- Updated dependencies [3788bab]
- Updated dependencies [4540248]
- Updated dependencies [94dc14a]
- Updated dependencies [d685bee]
- Updated dependencies [362a751]
- Updated dependencies [76822f6]
- Updated dependencies [3f67151]
- Updated dependencies [e9d4dba]
- Updated dependencies [0ec0abe]
- Updated dependencies [5fa661d]
- Updated dependencies [871e27e]
- Updated dependencies [5677b85]
- Updated dependencies [a5f49fe]
- Updated dependencies [f06331e]
- Updated dependencies [3ee9a97]
- Updated dependencies [a35c600]
- Updated dependencies [c17731f]
- Updated dependencies [d558a42]
- Updated dependencies [3d976cc]
- Updated dependencies [f80d2c1]
- Updated dependencies [3347acd]
- Updated dependencies [08e3603]
- Updated dependencies [71c6330]
- Updated dependencies [7f42235]
- Updated dependencies [f133d08]
- Updated dependencies [924b863]
- Updated dependencies [a37e361]
- Updated dependencies [6f63467]
  - @rudderjs/ai@1.6.0
  - @rudderjs/contracts@1.6.0
  - @rudderjs/orm@1.9.0

## 1.4.0

### Minor Changes

- 8e682a6: Add `NOT LIKE` where operator

### Patch Changes

- Updated dependencies [8e682a6]
  - @rudderjs/contracts@1.5.0

## 1.3.0

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
  - @rudderjs/orm@1.8.0

## 1.2.0

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

- Updated dependencies [6c03c74]
- Updated dependencies [3ccac5d]
- Updated dependencies [5447fa9]
- Updated dependencies [1805d0c]
- Updated dependencies [a089110]
- Updated dependencies [5703439]
- Updated dependencies [ad3a531]
- Updated dependencies [fcc57f9]
- Updated dependencies [a0b96f9]
  - @rudderjs/core@1.1.0
  - @rudderjs/orm@1.7.0
  - @rudderjs/contracts@1.2.0

## 1.1.0

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
  - @rudderjs/orm@1.4.0
  - @rudderjs/contracts@1.1.1

## 1.0.0

### Major Changes

- d33a492: Graduate to 1.0.0 with three correctness fixes and a new auto-discovered `DatabaseProvider`.

  **Bug fixes**

  - `orWhere(col, value)` previously pushed onto the same internal AND chain as `where()`, silently behaving identically. It now tracks an `_orWheres` list and emits a real `OR` condition. The operator overload `orWhere(col, op, value)` is also wired through.
  - `find(id)` previously bypassed the soft-delete filter and returned soft-deleted rows. It now respects `_softDeletes` / `_withTrashed` / `_onlyTrashed` exactly like `first()` and `get()`.
  - `all()` previously emitted `select * from <table>` and dropped wheres, orders, limits, offsets, and the soft-delete filter. It is now an alias of `get()` that applies the full chain.
  - The soft-delete filter previously emitted `deletedAt = NULL` (which never matches in SQL). It now uses `IS NULL` / `IS NOT NULL` via Drizzle's `isNull` / `isNotNull` helpers.

  **New: `DatabaseProvider`**

  Adds an auto-discovered `DatabaseProvider` that reads `config('database')` (matching the `@rudderjs/orm-prisma` shape: `default` + `connections`, with extra `tables` and `client` fields for Drizzle) and registers a `DrizzleAdapter` on the DI container as `db` plus on `ModelRegistry`. With both `@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle` installed, set `database.driver` to choose the active adapter.

  Run `pnpm rudder providers:discover` after installing or removing this package so `defaultProviders()` picks up the change.

  **Tests**

  The shape-only test suite is now backed by a real in-memory SQLite integration test (`integration.test.js`) that exercises the full QueryBuilder surface — wheres, OR clauses, soft deletes, `withTrashed` / `onlyTrashed`, `restore`, `forceDelete`, `increment`, `decrement`, and `paginate`.

## 0.1.0

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

## 0.0.10

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0

## 0.0.9

### Patch Changes

- Updated dependencies [be10c83]
  - @rudderjs/contracts@0.2.0

## 0.0.8

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0

## 0.0.7

### Patch Changes

- Updated dependencies [e1189e9]
  - @rudderjs/contracts@0.0.4

## 0.0.5

### Patch Changes

- @rudderjs/orm@0.0.5

## 0.0.4

### Patch Changes

- @rudderjs/orm@0.0.4

## 0.0.3

### Patch Changes

- @rudderjs/orm@0.0.3
