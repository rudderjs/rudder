# @rudderjs/contracts

## 1.9.0

### Minor Changes

- 7a258fb: Native engine Phase 4 — transactions.

  Adds first-class database transactions to the ORM, implemented on the native engine (`@rudderjs/orm/native`):

  - **`transaction(fn)`** (exported from `@rudderjs/orm`) and the **`Model.transaction(fn)`** alias run `fn` inside a database transaction. Every `Model` query issued anywhere inside the callback — across any model — executes on the transaction's connection, threaded transparently via `AsyncLocalStorage` (no call-site changes, no explicit handle passing). The unit commits when `fn` resolves and rolls back (re-throwing) when it rejects.
  - **Nesting maps to SAVEPOINTs.** A nested `transaction()` opens a savepoint; an inner failure rolls back only its own work and leaves the outer transaction intact, while an uncaught inner error propagates and rolls back the whole outer transaction.
  - **Contract addition:** `OrmAdapter` gains an **optional** `transaction?<T>(fn: (tx: OrmAdapter) => Promise<T>)`. It passes a transaction-scoped adapter; the Model layer threads it through `AsyncLocalStorage`. Optional = a capability flag — adapters without transaction support omit it, and `transaction()` surfaces a clear error against one. The native engine implements it; the Prisma/Drizzle adapters do not expose it yet (follow-up).
  - The native `Driver` seam gains a `Transaction` type (an `Executor` that can open a nested savepoint); the `better-sqlite3` driver implements BEGIN/COMMIT/ROLLBACK with depth-tracked SAVEPOINT nesting over an async callback.

  Client-bundle-safe by construction: `node:async_hooks` is lazy-imported only from `transaction()`, never at module-eval time, so `@rudderjs/orm`'s main entry stays out of any browser graph (`Client Bundle Smoke` green).

  **Single-connection caveat (SQLite):** transactions assume they aren't run concurrently against one SQLite handle (SQLite serializes writers anyway). Pooled drivers (pg/mysql, later phases) will pin a dedicated client per transaction.

## 1.8.0

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

- 3e60f95: fix(server-hono): malformed request body → 400 (was a silent `{}`)

  A `POST` / `PUT` / `PATCH` with `Content-Type: application/json` (or `application/x-www-form-urlencoded`) and a truncated or otherwise unparseable body used to silently become `req.body = {}`. Handlers and validators then saw a request that "looked fine" and emitted cryptic "field required" errors — masking a malformed-request as a missing-field problem.

  The body-parse block in `server-hono` now throws a `MalformedBodyError` on parse failure. The central exception pipeline in `@rudderjs/core` recognizes its `httpStatus = 400` and renders a clean 400 response with the parse-error context.

  **Behavior change**

  | Scenario                                             | Before               | After                                                                                           |
  | ---------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
  | `application/json` + parseable body                  | parsed object        | parsed object                                                                                   |
  | `application/json` + truncated / invalid body        | `req.body = {}`, 200 | `400 — Malformed request body (Content-Type: application/json)`                                 |
  | `application/json` + empty body                      | `req.body = {}`, 200 | `req.body` stays `null`, request proceeds; validators emit their normal "field required" errors |
  | `application/x-www-form-urlencoded` + parseable body | parsed object        | parsed object                                                                                   |
  | `application/x-www-form-urlencoded` + empty body     | `req.body = {}`, 200 | `req.body` stays `null`                                                                         |

  The empty-body case used to look like an empty object; it now leaves `req.body` at the normalizer default so validators handle "no body" the same way they handle "GET with no body" — emitting standard missing-field errors instead of cryptic JSON parse messages.

  **API**

  `@rudderjs/contracts` now exports `MalformedBodyError extends Error`:

  ```ts
  import { MalformedBodyError } from "@rudderjs/contracts";

  err.httpStatus; // 400 (duck-typed; recognized by core's exception pipeline)
  err.contentType; // 'application/json' | 'application/x-www-form-urlencoded'
  err.cause; // the underlying SyntaxError, when applicable
  ```

  Plan: `docs/plans/2026-05-21-framework-pipeline-hardening.md`, Phase 2.

## 1.7.0

### Minor Changes

- 7d7a4ab: Typed routes: `Route.get('/users/:id', handler)` now types the handler's `req.params` from the `:param` segments in the literal path — pure TypeScript template-literal types, no codegen, no scanner. Reading `req.params.userId` on a route with `:id` is now a compile error. Optional segments (`:name?`) produce optional keys; regex constraints (`:id{[0-9]+}`) are stripped from the captured name; paths with no params type as `{}`. Plus a new opts form on every shorthand verb — `Route.get('/users/:id', { query: zodSchema }, handler)` — installs a Zod validator middleware AND types the handler's `req.query` as `z.infer<typeof schema>`. The parsed result replaces `req.query` in place at request time so `z.coerce.number()` works end-to-end. The `.query(schema)` chain method is available too for runtime-only validation when type narrowing isn't needed. `ValidationError` moved from `@rudderjs/core` to `@rudderjs/contracts` so `@rudderjs/router` can throw it without a circular dependency; `@rudderjs/core` re-exports the class so existing imports keep working. Existing routes compile unchanged — all generics default to today's shapes.

## 1.6.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.6.0

### Minor Changes

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

## 1.5.0

### Minor Changes

- 8e682a6: Add `NOT LIKE` where operator

## 1.4.0

### Minor Changes

- f867181: Add `ip?`, `user?`, `session?`, `token?` fields to `AppRequest` (all were set by server adapters and middleware but absent from the contract). Fix README "type-only" claim (`InputTypeError` and `attachInputAccessors` are runtime exports). Create `boost/guidelines.md`. Add `boost` to npm `files`.

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

- a0b96f9: Add Laravel-style `router.group()`, subdomain routing, and `.missing()` 404 customisation (Laravel parity #5, PR2 of 3).

  **`router.group(opts, fn)`** — apply a `prefix`, `domain`, or `middleware` stack to every route registered in the callback. Nested groups concatenate prefixes and middleware; the innermost defined `domain` wins.

  ```ts
  router.group({ prefix: "/admin", middleware: [adminAuth] }, () => {
    router.get("/users", listUsers); // GET /admin/users (with adminAuth)
  });

  router.group({ domain: ":tenant.example.com", prefix: "/api" }, () => {
    router.get("/me", me); // GET :tenant.example.com/api/me
  });
  ```

  Distinct from `runWithGroup('web' | 'api', …)` — that tags routes with their middleware-group label, this is the user-facing scoping primitive. Both can be active at the same time.

  **`RouteBuilder.domain(template)`** — restrict a route to a host. Templates accept `:param` segments that capture into `req.params` alongside path params. Mismatched hosts return 404. Per-route `.domain()` overrides any `domain` set by an active group.

  ```ts
  router.get("/users", listUsers).domain("api.example.com");
  router.get("/me", me).domain(":tenant.example.com"); // req.params.tenant
  ```

  **`RouteBuilder.missing(fn)`** — custom response when an explicit `router.bind('user', User)` resolves to `null`. Receives `(req, err)` and returns any value a route handler may return: `Response`, plain object → JSON, string → body, or `undefined` (callback wrote to `res` directly). Optional bindings do NOT trigger `.missing()`.

  ```ts
  router
    .get("/users/:user", show)
    .missing((_req, err) =>
      Response.json({ error: err.message }, { status: 404 })
    );
  ```

  **Contract additions (`@rudderjs/contracts`)** — `RouteDefinition` gains two optional fields: `host?: string` and `missing?: (req, err) => unknown | Promise<unknown>`. The `err` is duck-typed (`httpStatus`, `param`, `value`, `model`) so contracts stays free of `@rudderjs/router`.

  **`@rudderjs/server-hono`** — pre-handler host gate (`matchHost()`) returns 404 on host mismatch and stashes captured subdomain `:param` segments on the Hono context. `normalizeRequest()` merges them into `req.params`; path params win on collision.

  This is PR2 of the router parity sweep. `Route::resource` / `apiResource` / `singleton` and `make:controller --resource` follow in PR3.

## 1.1.1

### Patch Changes

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

## 0.2.0

### Minor Changes

- be10c83: Add `ModelLike` + `ModelQuery` interfaces to `@rudderjs/contracts` so downstream
  tools (e.g. `@pilotiq/pilotiq` for auto-wired CRUD) can target the Eloquent-style
  Model surface without depending on `@rudderjs/orm` directly. `Model` from
  `@rudderjs/orm` already structurally satisfies `ModelLike`, asserted at compile
  time via a `const _: ModelLike = Model` guard in `@rudderjs/orm`'s entry — any
  future change to `Model` that breaks the contract fails the build.

## 0.1.0

### Minor Changes

- ba543c9: Middleware groups — `web` vs `api`, Laravel-style.

  Routes loaded via `withRouting({ web })` are tagged `'web'`; via `withRouting({ api })` tagged `'api'`. The server adapter composes the matching group's middleware stack before per-route middleware. Framework packages install into a group during `boot()` via the new `appendToGroup('web' | 'api', handler)` export on `@rudderjs/core`, instead of calling `router.use(...)` globally.

  - **`MiddlewareConfigurator`** — adds `.web(...handlers)` and `.api(...handlers)` alongside the existing `.use(...)`. Use `m.use(...)` for truly global middleware (logging, request-id), `m.web(...)` / `m.api(...)` for group-scoped middleware.
  - **`@rudderjs/session`** — `sessionMiddleware` now auto-installs on the `web` group. Apps no longer need `m.use(sessionMiddleware(cfg))` in `bootstrap/app.ts`.
  - **`@rudderjs/auth`** — `AuthMiddleware` now auto-installs on the `web` group (was a global `router.use()`). `req.user` is populated on web routes only; api routes are stateless by default and must opt into bearer auth (e.g. `RequireBearer()` from `@rudderjs/passport`).
  - **`SessionGuard.user()`** — soft-fails when no session ALS is in context (returns `null` instead of throwing). Matches Laravel's `Auth::user()` semantics — removes the trap where api routes would 500 with "No session in context" when auth was installed but session was not.
  - **`RouteDefinition.group?: 'web' | 'api'`** — new optional field exposed via `@rudderjs/contracts`. Server adapters may implement `applyGroupMiddleware(group, handler)` to support the feature; adapters without it ignore group tags and behave as before.

  **Breaking:** `req.user` is now `undefined` on api routes unless a bearer/token guard middleware runs. This is intentional — the previous behavior (AuthMiddleware running globally) forced session to be load-bearing on every request, including stateless APIs.

## 0.0.4

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

## 0.0.2

### Patch Changes

- Quality pass: bug fixes, expanded tests, and docs improvements across core packages.

  - `@rudderjs/support`: fix `ConfigRepository.get()` returning fallback for falsy values (`0`, `false`, `''`); add prototype pollution protection to `set()`; fix `Collection.toJSON()` returning `T[]` not a string; fix `Env.getBool()` to be case-insensitive; fix `isObject()` to correctly return `false` for `Date`, `Map`, `RegExp`, etc.
  - `@rudderjs/contracts`: fix `MiddlewareHandler` return type (`void` → `unknown | Promise<unknown>`)
  - `@rudderjs/middleware`: add array constructor to `Pipeline` — `new Pipeline([...handlers])` now works
  - `create-rudder-app`: remove deprecated `.toHandler()` from `RateLimit` in scaffolded templates; remove nonexistent `.withExceptions()` call
