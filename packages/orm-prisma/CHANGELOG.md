# @rudderjs/orm-prisma

## 2.3.0

### Minor Changes

- 40a1424: Nested `whereHas` now works on the Prisma adapter for all-direct chains — `whereHas('posts', q => q.where('published', true).whereHas('comments', c => c.where('approved', true)))` (and the dot-path form) composes as native nested `some`/`none` filters, with constraints at every level, inner `whereDoesntHave` (`none`), sibling branches (same-relation siblings survive via the collision-safe `AND` array), and unbounded recursion. A pivot/polymorphic/through relation is allowed only at the OUTERMOST position of the chain — its deferred 2-step lookup's related filter carries the direct-chain children — and throws a clear mixed-chain error anywhere deeper (the native engine and Drizzle support those; an innermost-first hybrid is a documented follow-up). Every nested level must be declared as a relation in `schema.prisma`, same as top-level direct `whereHas`.
- c1c8b58: `whereHas` / `whereDoesntHave` / `has(relation, op, n)` / `withCount` and the other aggregates now work on through relations (`hasOneThrough` / `hasManyThrough`) on all three adapters — Laravel parity for the previously documented v1 gap. The predicate reuses the pivot two-hop `through` shape with the intermediate table in the pivot slot, plus a new `through.fanOut` marker (`@rudderjs/contracts`) for the 1:N intermediate→related cardinality: plain existence keeps the fan-out-safe nested-EXISTS shape, while count comparisons and aggregates run over the JOINED far rows — counts count far rows (a country reaching 3 posts via 2 users has `postsCount === 3`), and a bare intermediate row never satisfies existence. Constrain callbacks apply to the far table (Laravel semantics); nested dot-paths may include through levels; `withWhereHas` on a through relation falls back to plain `with()` (the two-hop eager load is Model-layer). Drizzle requires the intermediate table registered in `tables: { ... }` (same as pivots); Prisma routes whereHas through the existing deferred 2-step lookup and aggregates through a new fan-out-aware batch path. Also fixes a latent Drizzle bug: the pivot-aggregate JOIN's ON clause rendered unqualified column names — ambiguous whenever pivot and related share a column name (always true for through relations, both having `id`).
- fbb223d: Resolve a model's `static table` against the Prisma client's runtime datamodel when it isn't a direct delegate name. Previously `static table` had to be the camelCase Prisma delegate name (`paddleCustomer`) because the adapter does `prisma[table]` — but on the native engine the same field is the literal SQL table name (`paddle_customers`), so a single package model couldn't run on both adapters. The adapter now falls back to `_runtimeDataModel.models` (present on every generated client since Prisma 5): the model whose `@@map` name (or, when unmapped, its own name) equals the requested table resolves to its delegate. Direct delegate-name lookups keep the historical fast path, so existing models are untouched. This unblocks shipping package models (cashier-paddle, and later passport/notification/etc.) with real SQL table names that work on the native engine AND Prisma.

### Patch Changes

- 45b9cf0: whereHas constrain callbacks no longer silently drop query sugar. Historically the constraint recorder captured only `.where()` and silently no-oped everything else — a `whereIn(...)` inside a callback silently matched MORE rows than intended. The recorder now records the AND-expressible surface (`whereIn`/`whereNotIn`/`whereNull`/`whereNotNull`/`whereBetween` — lowered to its two bounds — plus `when`/`unless` conditionals, all typed via the new exported `ConstraintQueryBuilder`), keeps ignoring methods that can't change an existence test (`orderBy`/`limit`/…), and **throws a clear error** for everything that can't round-trip through the flat AND-only constraint list (date/JSON helpers, raw SQL, groups, `whereNotBetween`, column comparisons, soft-delete scopes, terminals) instead of silently widening the filter. Companion Prisma fix: multi-clause filters on the SAME column (e.g. `whereBetween`'s two bounds, or `where('views','>=',10).where('views','<=',20)` on the main query) were composed with last-wins `Object.assign` and silently dropped all but the last clause — collisions now route through Prisma's `AND: [...]` array form (distinct-column filters keep their historical shape byte-identical).
- Updated dependencies [361b298]
- Updated dependencies [d6f0e79]
- Updated dependencies [c1c8b58]
- Updated dependencies [b1f748d]
- Updated dependencies [45b9cf0]
  - @rudderjs/contracts@1.14.0
  - @rudderjs/orm@1.20.0
  - @rudderjs/core@1.10.0

## 2.2.0

### Minor Changes

- eb3bdfe: feat: transaction isolation levels — `transaction(fn, { isolationLevel })` / `DB.transaction(fn, { isolationLevel })` / `Model.transaction(fn, { isolationLevel })` with `'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'`. The native engine emits `SET TRANSACTION ISOLATION LEVEL …` at transaction start on Postgres/MySQL; the Drizzle adapter passes the level through to Drizzle's transaction config; the Prisma adapter maps it to `$transaction`'s `isolationLevel` option. SQLite throws a clear unsupported error (no isolation levels — single-writer is already serializable), and a nested `transaction()` call (savepoint) rejects the option on every adapter.

### Patch Changes

- 635d09e: Fix nested transactions (SAVEPOINT) failing on MySQL: the mariadb driver adapter now uses the text protocol. MySQL cannot prepare SAVEPOINT / ROLLBACK TO SAVEPOINT / RELEASE SAVEPOINT (error 1295), and the adapter's nested `transaction()` support emits those through `$executeRawUnsafe`, which the default binary protocol routes through a prepared statement — so every nested transaction on a `make()`-constructed mysql connection failed. If you pass your own PrismaClient on mysql, construct its `PrismaMariaDb` adapter with `{ useTextProtocol: true }`.
- Updated dependencies [cfab7aa]
- Updated dependencies [a5f7950]
- Updated dependencies [c704a48]
- Updated dependencies [345d805]
- Updated dependencies [0d7c992]
- Updated dependencies [ba50682]
- Updated dependencies [f88660f]
- Updated dependencies [d89d2cd]
- Updated dependencies [255a755]
- Updated dependencies [246f5b0]
- Updated dependencies [8a53671]
- Updated dependencies [1da0b39]
- Updated dependencies [1b8474a]
- Updated dependencies [ac3d8d0]
- Updated dependencies [eb3bdfe]
  - @rudderjs/orm@1.16.0
  - @rudderjs/contracts@1.12.0

## 2.1.0

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

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

- f17742b: Named database connections on the Prisma and Drizzle adapters (multi-connection PR4a).

  Both providers now register a lazy `ConnectionManager` factory for every connection they claim in `config/database.ts` (connections selecting another engine — e.g. `engine: 'native'` — are skipped), so `DB.connection('reporting')`, `Model.on('reporting')`, and per-model `static connection` work on Prisma/Drizzle apps. The default connection boots eagerly through the same manager entry, sharing one adapter/client with the Models. The dev-HMR client caches are per-connection now (keyed by connection name): each named connection holds its own client, a config edit disposes/reopens only that connection, and a second named connection no longer evicts the first. Prisma query events report the connection name. Read/write-split config (`read:`/`write:`) fails loudly at boot on both adapters — Prisma points at `@prisma/extension-read-replicas` (or the native engine); Drizzle points at the native engine, with real Drizzle routing planned as a follow-up.

- bf1cca0: feat(orm): `distinct()` — SELECT DISTINCT (Laravel parity)

  `Model.query().distinct().get()` de-duplicates the result rows; pair it with `select(...)` to de-duplicate on specific columns. With `distinct()`, `count()` / `paginate()` count the distinct rows.

  Native engine only — on Drizzle and Prisma it throws with a pointer to the native engine / `DB.select(...)`, consistent with joins / groupBy / union.

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

- ad17e79: feat(orm): `onQuery` query listening on the native engine + app-facing `DB.listen()`

  Laravel's `DB::listen` arrives in RudderJS:

  - **`@rudderjs/contracts`**: `onQuery?(listener)` is now an optional capability on the `OrmAdapter` contract, with new `QueryEvent` (`{ sql, bindings, duration, connection?, model? }`) and `QueryListener` types — the shape Telescope's QueryCollector and Pulse's slow-query recorder already consume.
  - **`@rudderjs/orm` (native engine)**: the `NativeAdapter` implements `onQuery` by instrumenting its executor — every executed query (Model reads/writes, `DB.*` raw calls, and queries inside `transaction()`, which share the top-level listener list) is timed with `performance.now()` and reported with its SQL + bindings. Listener errors are swallowed and never break the query; only successful executions report (Laravel `QueryExecuted` parity). Transaction control statements (BEGIN/COMMIT/SAVEPOINT) are not reported.
  - **`@rudderjs/database`**: new `DB.listen(listener)`, mirroring Laravel's `DB::listen` — delegates to the active adapter's `onQuery` hook and throws a clear adapter-named error when the adapter doesn't support query listening. `QueryEvent` / `QueryListener` are re-exported.
  - **`@rudderjs/orm-prisma`**: the existing ad-hoc `onQuery` method is now typed to the shared contract (no behavior change).

  The Drizzle adapter does not implement the hook yet — `DB.listen()` throws its clear unsupported error there; a follow-up adds it.

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

## 2.0.3

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

## 2.0.2

### Patch Changes

- 12015c9: fix(doctor): `doctor --deep` db-connect check works on Prisma 7 (was a raw unhandled exception)

  The `orm-prisma:db-connect` runtime check spawned a bare `new PrismaClient()`, which Prisma 7's `prisma-client` generator rejects (it requires the driver adapter the app wires) — and the construction was outside the check's try/catch, so it surfaced as a raw _unhandled exception_ on `doctor --deep` for any app on Prisma 7 + driver adapters (the framework's current default). The check now reuses the app's already-constructed client (cached on `globalThis` by the adapter during the `--deep` boot, built with the correct adapter/options) and runs `SELECT 1` on it; it no longer disconnects the client (it's the app's shared pool) and degrades to a clean `warn` when no Prisma client was constructed. Verified on the playground (Prisma 7.4.2): the check now reports the connection instead of crashing.

- Updated dependencies [a39a983]
  - @rudderjs/orm@1.12.6

## 2.0.1

### Patch Changes

- 8ecf5f7: Dev HMR: reuse one PrismaClient across re-bootstraps instead of opening (and leaking) a fresh DB connection on every edit.

  Each dev re-boot re-ran `DatabaseProvider.boot()` → `PrismaAdapter.make()`, which built a brand-new `PrismaClient` and opened a new driver connection (a new better-sqlite3 handle, a new pg/mariadb pool, …) every time — and never disconnected the superseded one. Under Prisma 7's driver-adapter model the app owns the client lifecycle and Prisma performs no HMR de-duplication of its own, so abandoned connections piled up across edits.

  - **`@rudderjs/orm-prisma`** — `PrismaAdapter.make()` now caches the live `PrismaClient` on `globalThis`, keyed by the resolved connection signature (driver + url). The same signature reuses the live client (no new connection opened); a changed connection (a `config/database.ts` edit) builds a fresh client and `$disconnect()`s the superseded one so its handle is released. No-op in production (single boot → one client, built once). Apps passing their own `config.client` opt out entirely.
  - **`@rudderjs/core`** — under `RUDDER_HMR_TRACE=1`, `Application.create()` and the app-builder now log a per-re-boot construct counter, so the "one fresh instance per re-boot" invariant is observable when diagnosing HMR. Diagnostic only; no behavior change otherwise.

- Updated dependencies [8ecf5f7]
  - @rudderjs/core@1.3.2

## 2.0.0

### Major Changes

- 77b6af5: fix(orm-prisma)!: Laravel-parity `where + orWhere` precedence — **breaking semantics**

  ORM-correctness Phase 3 from the 2026-05-21 code-review sweep (`docs/plans/2026-05-21-framework-orm-correctness.md`). Resolves the cross-adapter precedence divergence that has been quietly shipping since the ORM was first released.

  ## The bug

  `@rudderjs/orm-prisma`'s `buildWhere()` emitted

  ```ts
  { ...andSpread, OR: [...orFilters] }
  ```

  which Prisma read as `andSpread AND (or1 OR or2 ...)`. Every `.orWhere()` / `.orWhereGroup()` was constrained by the prior AND chain — the opposite of Eloquent's left-associative behaviour and out of step with `@rudderjs/orm-drizzle`, which has always emitted Laravel-parity `or(andChain, ...orFilters)`.

  Concrete example:

  ```ts
  Post.where("status", "active")
    .where("priority", "high")
    .orWhere("priority", "low")
    .get();
  ```

  | Adapter                 | Pre-Phase-3 semantics                                            | New semantics (Phase 3)                                   |
  | ----------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
  | `@rudderjs/orm-drizzle` | `(status='active' AND priority='high') OR priority='low'`        | **unchanged**                                             |
  | `@rudderjs/orm-prisma`  | `status='active' AND priority='high' AND priority='low'` ← buggy | `(status='active' AND priority='high') OR priority='low'` |

  The Prisma adapter's `where-group.test.ts` previously codified the buggy posture as expected behaviour — the tests passed but the query semantics didn't match Laravel or Drizzle.

  ## What changes

  `buildWhere()` is restructured to emit `{ OR: [andSide, ...orItems] }` whenever a chain has both AND content and OR content:

  ```ts
  // `.where('a').where('b').orWhere('c')` →
  {
    OR: [{ AND: [{ a }, { b }] }, { c }];
  }

  // `.where('a').orWhere('b')` →   (AND collapses to a single flat object when there's one item)
  {
    OR: [{ a }, { b }];
  }

  // `.where('a').where('b')` (no .orWhere) →
  {
    a, b;
  } // unchanged — legacy flat shape, AND-only queries are unaffected

  // `.orWhere('a').orWhere('b')` (no .where) →
  {
    OR: [{ a }, { b }];
  } // unchanged
  ```

  The same fix is applied to the vector-search SQL builder (`searchVector()`), which had an identical bug — the AND chain and parenthesised OR block were joined with `AND` instead of being top-level alternatives.

  Soft-delete scope (`_softDeletes`) stays in the AND chain (matching Drizzle's posture — `softExpr` is pushed into `andExprs`, not wrapped around the result). Apps that need the soft-delete filter to apply across `.orWhere()` alternatives should keep their where chains AND-only or wrap in a `whereGroup`. The plan flags this as a separate follow-up; this PR keeps Prisma's behaviour aligned with Drizzle's, which is the Phase-3 contract.

  ## Migration

  If your app reaches for `.orWhere()` or `.orWhereGroup()` on Prisma and depends on the old "OR constrained by AND" reading, the query semantics change. Two paths:

  1. **Adopt Laravel-parity** — your queries now match what the chain syntactically suggests (`a AND b OR c` reads as `(a AND b) OR c`). This is what the Drizzle adapter has always done; cross-adapter portable apps already needed this shape.

  2. **Wrap with `whereGroup`** to recover the old constrained semantics:

     ```ts
     // Pre-Phase-3 Prisma behaviour:
     Post.where("a").where("b").orWhere("c").get();
     // → status='a' AND b AND c  (constrained)

     // Equivalent under Laravel parity — wrap the OR alternatives in a whereGroup:
     Post.where("a")
       .where("b")
       .whereGroup((g) => g.orWhere("c"))
       .get();
     //   ↑ but this no longer matches what you typically want.
     //
     // What you usually want is the new precedence — `(a AND b) OR c`.
     ```

  There is **no compatibility flag** — the legacy shape was a bug. If you need the old behaviour for a specific query, restructure with explicit grouping.

  ## Tests

  - 4 existing specs in `packages/orm-prisma/src/where-group.test.ts` updated to assert the new shapes (single AND-rooted group, single OR-rooted group, 3-level nesting, plain `where + orWhere`).
  - 6 new specs added under `where + orWhere precedence (Laravel parity)`:
    - Plain `.where().orWhere()` → `OR: [{ a }, { b }]`
    - Multi-`.where()` AND chain + `.orWhere()` (column collisions survive via AND-array form)
    - Multiple `.orWhere()` calls each become top-level alternatives
    - `.orWhere()`-only chain emits a bare OR
    - AND-only chain keeps the legacy flat shape (regression guard)
    - Soft-delete scope joins the AND alternative (matches Drizzle)
  - 1 existing spec in `packages/orm-prisma/src/vector.test.ts` updated to assert the new SQL precedence.
  - 1 new spec added covering multi-`.where()` + `.orWhere()` in the vector-search path.

  104 → 110 specs in the `orm-prisma` test suite. Downstream test suites (`orm`, `orm-drizzle`, `core`, `router`, `auth`, `passport`) pass unchanged. Full-repo typecheck across 93 packages clean.

### Patch Changes

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

## 1.9.1

### Patch Changes

- 6e37c21: fix(doctor): `orm-prisma:client-generated` now finds the real generated client directory

  Previously the check stat'd `node_modules/@prisma/client/package.json` for its mtime. Under Prisma 7 + pnpm, that file is the symlinked package metadata — `prisma generate` never touches it. The check reported "stale" after every regenerate even when the client was current.

  The check now:

  1. Honors `generator <name> { output = "..." }` declared in any schema (Prisma 7's `prisma-client` generator path; resolved relative to the schema's directory per Prisma docs).
  2. Falls back to the resolved `@prisma/client`'s sibling `.prisma/client/` — works for both pnpm (real path is `.pnpm/<id>/node_modules/@prisma/client/`, sibling at `.pnpm/<id>/node_modules/.prisma/client/`) and npm/yarn flat layouts.
  3. Falls back to the legacy hoisted `node_modules/.prisma/client/`.

  Staleness is now decided by the newest file mtime in the resolved directory — matches what `prisma generate` actually writes. `--fix` already worked correctly; this brings the check in line.

## 1.9.0

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

- aecb6a9: Phase 4 of `rudder doctor` — `--deep` runtime mode.

  `rudder doctor --deep` now boots the app (catching boot errors as a check
  result, never crashing doctor itself) and runs 6 new runtime checks
  that interrogate the live DI graph and external services.

  What's new:

  - **`runtime:app-boot`** (cli) — wraps `bootApp()` in try/catch. Boot
    success/failure becomes a check result with the error message + stack
    trace under `--verbose`. The fix line points at the most likely causes
    (missing env vars, unreachable services, missing provider deps).

  - **`runtime:port-free`** (cli) — `net.createServer().listen(PORT)` then
    immediately close. On `EADDRINUSE` it shells out to `lsof -ti :PORT`
    (macOS/Linux) to report the holding PID with a paste-able `kill <pid>`
    fix. Windows skips the PID lookup since `lsof` isn't standard there.

  - **`orm-prisma:db-connect`** — spawns a fresh PrismaClient via the
    user's resolved `@prisma/client`, runs `$connect()` + `$queryRaw\`SELECT
    1\``, disconnects. DSN passwords are redacted in error messages.

  - **`orm-prisma:migration-drift`** — runs `pnpm exec prisma migrate
status`; warns on pending migrations or drift, points at
    `pnpm rudder migrate`.

  - **`queue-bullmq:redis-ping`** — opens an ioredis connection with
    `lazyConnect: true`, `maxRetriesPerRequest: 0`, sends `PING`, closes.
    Fails fast (no retry storm), redacts the URL in the error.

  - **`mail:smtp-connect`** — raw TCP connect (no SMTP handshake, no
    credentials sent) to MAIL_HOST:MAIL_PORT or the host inferred from
    `config/mail.ts`. Times out after 2s.

  Implementation notes:

  - Boot status flows from the doctor command to runtime checks via a
    `globalThis['__rudderjs_doctor_boot_status__']` slot (the same pattern
    cli/router/orm use for cross-module singletons that survive Vite SSR
    re-eval).

  - The doctor command stays in `NO_BOOT_EXACT`. With `--deep`, the
    handler calls `bootApp()` itself inside try/catch, AFTER the
    built-in/package checks have registered. This means a boot crash
    doesn't take out the orchestrator — every runtime check still gets
    to render.

  - `--only <substring>` now matches both check id AND category. `--only
orm` catches `orm-prisma:*` + `orm-drizzle:*`; `--only runtime`
    catches every `category: 'runtime'` check regardless of package
    prefix.

  - Each runtime check that depends on an env var (DATABASE_URL,
    REDIS_URL, MAIL_HOST) skips with a clean "covered by <fast-path
    check>" message when the var is unset, instead of failing loudly.
    The fast-path check has already flagged the issue.

  End-to-end smoke against the playground: 28 checks across 10
  categories with `--deep`, every runtime check loads via the lazy
  loader and surfaces actionable findings or appropriate skips.

  Phase 5 (`--fix` idempotent auto-recovery) and Phases 6-7 (docs +
  ship) follow in subsequent PRs.

### Patch Changes

- 108c7a2: doctor: Phase 5 — `--fix` mode

  `pnpm rudder doctor --fix` now auto-applies safe fixes for failing checks that declare a `fixer()`. Add `--yes` to skip prompts. The flow runs the fast-path checks, prompts (or auto-applies under `--yes`) for each fixable failure, then re-runs the same checks to confirm.

  First three fixers ship in this release:

  - `deps:providers-manifest` → regenerates `bootstrap/cache/providers.json` in-process (same logic as `rudder providers:discover`)
  - `orm-prisma:client-generated` → shells out `pnpm exec prisma generate`
  - `auth:views-vendored` → copies `node_modules/@rudderjs/auth/views/<fw>/` to `app/Views/Auth/` (never overwrites existing files)

  Fixers must be idempotent regenerate-style operations. Doctor never modifies `.env`, `package.json`, or DB schema, and a fixer that throws is reported as a red fix outcome — doctor itself never crashes.

- Updated dependencies [b28e51f]
- Updated dependencies [a3a7368]
  - @rudderjs/console@1.1.0
  - @rudderjs/ai@1.8.0

## 1.8.0

### Minor Changes

- 4342132: Add MySQL / MariaDB support via `@prisma/adapter-mariadb`.

  The `driver` config option already declared `'mysql'` as a valid value, but the adapter factory only handled `'postgresql'`, `'libsql'`, and `'sqlite'` (default) — every other driver value fell through to better-sqlite3 silently. Real apps that wanted MySQL would silently try to open a SQLite file and fail with a confusing "Cannot open database because the directory does not exist" error.

  This adds the missing branch. When `driver === 'mysql'` + a URL is provided, the adapter:

  1. Parses the standard `mysql://user:pass@host:port/db` URL into the component parts (`@prisma/adapter-mariadb`'s constructor takes parsed connection options, not a URL — the underlying `mariadb` npm client doesn't accept connection strings directly).
  2. Constructs a `PrismaMariaDb` adapter and passes it to the new PrismaClient.

  The MariaDB adapter is wire-compatible with both MySQL 5.7+ and MariaDB 10.x, so a single driver covers both engines.

  ## Added to optional dependencies

  - `mariadb@^3.0.0`
  - `@prisma/adapter-mariadb@^7.0.0`

  Both are optional — installed only when the app actually uses `driver: 'mysql'`.

  ## Why this matters

  Forge (the most common Laravel-ecosystem hosting choice, and one RudderJS borrows heavily from in design) provisions MySQL by default on every new server. Without this branch, every Forge deploy of a RudderJS app forces either:

  - Manually installing Postgres alongside MySQL and ignoring the provisioned DB, or
  - Switching to libsql (Turso), or
  - Falling back to SQLite-on-disk

  Now the Forge default just works. Tested end-to-end on `pilotiq-io` against MySQL 8.0 (DBngin local) and MySQL 8.4 (Forge production).

## 1.7.3

### Patch Changes

- fa81f44: `DatabaseProvider.boot()` no longer calls Prisma's `$connect()` eagerly. The client connects lazily on first query — Prisma's documented behavior — saving ~20–40 ms cold boot.

  **Behavior change:** a database-down deploy now surfaces on the first user query instead of at boot. The HTTP server starts and accepts connections regardless of database availability. Apps that want fail-fast at boot can call `await app.make('db').connect()` from an `AppServiceProvider.boot()` hook.

  No API change. No code change required in apps.

- Updated dependencies [765a19d]
- Updated dependencies [16f87a4]
- Updated dependencies [4634586]
- Updated dependencies [bdfe575]
  - @rudderjs/ai@1.7.1
  - @rudderjs/orm@1.9.3

## 1.7.2

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

## 1.7.1

### Patch Changes

- 7eab2d2: Author `boost/guidelines.md` for the 6 packages that previously had no boost content. Adopting apps now get per-package guidelines for these packages too — `@rudderjs/boost` was already capable of consuming them, only the source content was missing.

  Also adds `"boost"` to the `files` array in `package.json` for the 5 packages that didn't include it (`@rudderjs/terminal` already did), so the guidelines actually ship via npm.

  No code changes.

- Updated dependencies [d0db9f0]
  - @rudderjs/ai@1.6.1
  - @rudderjs/orm@1.9.1

## 1.7.0

### Minor Changes

- 3d976cc: **B7 Phase 2 — `similaritySearch({ model, column, embedWith })` agent tool + auto-embed lift in `whereVectorSimilarTo`.** Wires Phase 1's pgvector primitives into the agent loop. Models emit a natural-language `query`; the tool embeds it, runs a `whereVectorSimilarTo` search, and returns top-K rows with similarity scores.

  ```ts
  import { Agent } from "@rudderjs/ai";
  import { similaritySearch } from "@rudderjs/ai";
  import { Document } from "./app/Models/Document.js";

  class KnowledgeAgent extends Agent {
    tools() {
      return [
        similaritySearch({
          model: Document,
          column: "embedding",
          embedWith: "openai/text-embedding-3-small",
          minSimilarity: 0.7,
          limit: 10,
        }),
      ];
    }
  }
  ```

  `@rudderjs/ai`:

  - **`similaritySearch({ model, column, embedWith, metric?, minSimilarity?, limit?, name?, description?, projectResult? })`** — exported from the main entry (`@rudderjs/ai`). Returns a `ServerToolBuilder` whose `inputSchema` is `z.object({ query: z.string().min(1) })`. Default tool name: `similarity_search_<model_lowercase>`. `embedWith` is required — fails loud at factory construction if missing, mirroring A6's `assertKnownModelPricing` pattern (no silent default-route to `AiRegistry.getDefault()`).
  - **Execute flow:** `query` → `AI.embed(query, { model: embedWith })` → `model.query().whereVectorSimilarTo(column, vector, { metric, minSimilarity }).selectVectorDistance(...).limit(limit).get()` → `{ row, similarity }[]`. The internal distance alias is read off each row at result time and converted to `similarity = 1 - distance` (cosine convention; documented for non-cosine metrics).
  - **`toModelOutput`** default formatter: `(0.85) {"id":1,"content":"..."}` per hit, newline-joined, with the internal alias stripped from the JSON. Empty-state returns `"No similar <Model> records found."`. Override via `projectResult: (row, similarity) => string` for custom shapes.

  `@rudderjs/orm-prisma`:

  - **`whereVectorSimilarTo(column, '<string>', { embedWith })`** no longer throws — auto-embed is **deferred** to terminal time so the chain stays sync. The string + model id get stored on the vector clause and resolved when `.get()` / `.first()` runs by lazy-loading `@rudderjs/ai` via `resolveOptionalPeer('@rudderjs/ai')`. `MissingEmbedderError` still fires when `embedWith` is omitted.
  - **`@rudderjs/ai` is a new optional peer** of `@rudderjs/orm-prisma`. Apps that don't do RAG never load AI. `@rudderjs/support` is a new regular dep (for `resolveOptionalPeer`).

  **Phase 2 limitations** (lifted in Phase 2.5):

  - **Standalone vector queries only.** `similaritySearch` doesn't support a `scope` callback yet — agents see every row in the corpus that matches the vector. Apps needing tenant/user filtering today can pre-fetch IDs in user code and post-filter the result set.
  - The chained `.where()` lift on `whereVectorSimilarTo` ships in Phase 2.5 alongside `scope`.

  Plan: `docs/plans/2026-05-10-b7-vector-storage.md` (updated to reflect the Phase 2 / 2.5 split).

- f133d08: **B7 Phase 2.5 — `scope` callback on `similaritySearch` + chained `.where()` lift in `whereVectorSimilarTo`.** Tenant / publication / soft-delete filtering for RAG agents, no over-fetching, no user-side post-filtering. The chain pre-filters in SQL.

  ```ts
  import { similaritySearch } from "@rudderjs/ai";
  import { Document } from "./app/Models/Document.js";

  class KnowledgeAgent extends Agent {
    tools() {
      return [
        similaritySearch({
          model: Document,
          column: "embedding",
          embedWith: "openai/text-embedding-3-small",
          limit: 10,
          scope: (q) =>
            q.where("tenantId", currentTenant).where("published", true),
        }),
      ];
    }
  }
  ```

  `@rudderjs/orm-prisma`:

  - `_getViaVector` composes flat `.where()` / `.orWhere()` chains into the vector SQL via a new `clauseToSql(clause, params[])` helper. Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`. `null` values on `=` / `!=` map to `IS NULL` / `IS NOT NULL`. Empty `IN` short-circuits to `FALSE`; empty `NOT IN` to `TRUE` (Postgres rejects empty IN-lists).
  - User-supplied values bind through positional `$N` placeholders to `$queryRawUnsafe(sql, ...params)` — defense-in-depth against SQL injection. Vector min-similarity stays inlined (numeric, safe).
  - Polymorphic / pivot relation predicates (resolved via `_resolveDeferred`) flow through as flat `IN` / `NOT IN` clauses transparently.
  - Soft-delete scoping (`withTrashed` / `onlyTrashed`) flows into the SQL alongside user wheres.
  - **Still throws (out of scope for 2.5):** `.with()` (eager load), `whereGroup` / `orWhereGroup` (sub-builders pre-flatten to Prisma filter objects so the original `WhereClause[]` is lost), direct `whereHas` / `whereDoesntHave`, aggregates, redundant `.orderBy()`. Documented in the throw messages.

  `@rudderjs/ai`:

  - `similaritySearch({ scope })` accepts an optional `(q: SimilaritySearchQueryBuilder<T>) => SimilaritySearchQueryBuilder<T>` callback that runs before `whereVectorSimilarTo` attaches.
  - `SimilaritySearchQueryBuilder<T>` widened with `where(col, op?, val)` / `orWhere(...)` / `withTrashed?()` / `onlyTrashed?()` overloads so the scope callback gets autocomplete. Main entry still has zero `@rudderjs/contracts` runtime dep — types only.
  - New exported `SimilaritySearchWhereOperator` alias mirrors contracts' `WhereOperator` so apps writing scope callbacks don't have to import `@rudderjs/contracts`.

  `@rudderjs/contracts`:

  - JSDoc on `QueryBuilder.whereVectorSimilarTo` updated to reflect the lifted restriction. No surface change.

  Plan: `docs/plans/2026-05-10-b7-vector-storage.md` (Phase 2.5 marked in flight).

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

## 1.6.0

### Minor Changes

- 8e682a6: Add `NOT LIKE` where operator

### Patch Changes

- Updated dependencies [8e682a6]
  - @rudderjs/contracts@1.5.0

## 1.5.0

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

## 1.4.0

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

## 1.3.0

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

## 1.2.0

### Minor Changes

- ca14ecf: Support Prisma 7's new `prisma-client` generator alongside the legacy `prisma-client-js` generator.

  The new generator (`provider = "prisma-client"`) emits a self-contained ESM client at a custom `output` path — no engine binaries are downloaded from `binaries.prisma.sh` at install time, which makes it the only Prisma path that works inside browser-sandboxed runtimes like WebContainer / StackBlitz / Bolt.new.

  **Usage** — point the adapter at the generated `PrismaClient` class via the `PrismaClient` config field, since the adapter can't `import('@prisma/client')` to find it:

  ```ts
  // prisma/schema/base.prisma
  generator client {
    provider     = "prisma-client"
    output       = "../generated/prisma"
    runtime      = "nodejs"
    moduleFormat = "esm"
  }

  // config/database.ts
  import { PrismaClient } from '../prisma/generated/prisma/client.js'

  export default {
    default: 'sqlite',
    PrismaClient,
    connections: { sqlite: { driver: 'sqlite', url: '...' } },
  }
  ```

  **Other changes:**

  - `@prisma/client` peer dependency is now optional (`peerDependenciesMeta.optional: true`). Apps using only the new generator can drop the static `@prisma/client` import and the framework will skip the fallback resolution path.
  - Improved error message when neither `client` nor `PrismaClient` config is supplied AND `@prisma/client` isn't installed — now points to the new-generator setup.
  - `@libsql/client` optional peer bumped to `^0.17.0` to match `@prisma/adapter-libsql@^7.0.0`'s stricter peer range.

  The legacy `prisma-client-js` path continues to work unchanged — `playground/` (the canonical demo) still uses it. The new path is what `playground-web/` and the `create-rudder-app --preset web` (planned) scaffold use to boot in StackBlitz.

  Closes #127.

## 1.1.0

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
  - @rudderjs/orm@1.3.0

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
  - @rudderjs/core@1.0.0
  - @rudderjs/orm@1.0.0

## 0.0.19

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/orm@0.1.2

## 0.0.18

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.17

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/core@0.1.0
  - @rudderjs/orm@0.1.1

## 0.0.16

### Patch Changes

- Updated dependencies [8b0400f]
  - @rudderjs/orm@0.1.0

## 0.0.15

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.14

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.13

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.12

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
  - @rudderjs/core@0.0.9
  - @rudderjs/orm@0.0.7

## 0.0.8

### Patch Changes

- Bind the raw PrismaClient to the DI container as `'prisma'` after boot, enabling other providers (e.g. `auth()`) to auto-discover it without requiring explicit config passing.

## 0.0.7

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6
  - @rudderjs/orm@0.0.5

## 0.0.6

### Patch Changes

- @rudderjs/core@0.0.5
- @rudderjs/orm@0.0.4

## 0.0.5

### Patch Changes

- @rudderjs/core@0.0.4
- @rudderjs/orm@0.0.3
