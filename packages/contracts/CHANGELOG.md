# @rudderjs/contracts

## 1.19.0

### Minor Changes

- ba9e629: feat(server-hono): expose non-forgeable `req.spaNavUrl` / `req.isPageContextRequest`

  Adds two read-only `AppRequest` accessors that surface the adapter's SPA-nav signal to route middleware and handlers:

  - `req.spaNavUrl` — the original `/<path>/index.pageContext.json` URL when this request is a Vike client-router navigation that the adapter rewrote into a controller-view call; `undefined` for direct requests.
  - `req.isPageContextRequest` — boolean convenience for the same condition.

  Both are getters over the existing per-request `spaNavUrlStore` `AsyncLocalStorage`, not a client header, so they're unforgeable: a direct request (even one sending the old `x-rudder-original-url` header) reads `undefined`/`false`. This is the supported replacement for the `x-rudder-original-url` request header removed in 1.9 — guard/policy middleware uses it to return a Vike-parseable JSON envelope for SPA fetches but a real `302`/HTML for top-level navigations, instead of heuristics like sniffing `Sec-Fetch-Mode`.

## 1.18.0

### Minor Changes

- 817aa1c: feat(server-hono): open-redirect-safe redirect helper

  Add `res.intended(target, fallback?, code?)` plus the standalone `isSafeRedirect(target)` predicate and `safeRedirectTarget(target, fallback?)` resolver. These guard the common "redirect back to the intended URL after login" flow against open-redirect attacks: only same-origin absolute paths are honored, while absolute URLs (`https://evil.com`), protocol-relative targets (`//evil.com`), backslash-smuggled variants (`/\evil.com`), and whitespace/control-char smuggling fall back to a safe default. `intended` is also added to the `AppResponse` contract.

## 1.17.2

### Patch Changes

- 4fa94c3: Harden the request pipeline against forged proxy headers, oversized bodies, header forgery, and error-page disclosure.

  - **`X-Forwarded-For` no longer trusts the client-supplied entry.** With `trustProxy` enabled, `req.ip` was taken from the _leftmost_ `X-Forwarded-For` entry. Behind a proxy that appends rather than replaces the header (the nginx `proxy_add_x_forwarded_for` default), the leftmost is whatever the client sent, so a client could forge `req.ip` and defeat ip-keyed rate limits and allowlists. `req.ip` now reads the **rightmost** entry (the address the immediately-trusted proxy appended, which a client can't forge). `trustProxy` accepts a **number** to trust N chained proxy hops (`parts[len - N]`). Secure-by-default vs Laravel's `TrustProxies = '*'`, which trusts the whole client-supplied chain.
  - **Request bodies are size-capped.** The adapter buffered JSON / form-urlencoded bodies via an unbounded `.text()`, so a multi-GB body could exhaust memory. A new `HonoConfig.bodyLimit` (default 1 MB) rejects a request whose declared `Content-Length` exceeds the limit BEFORE anything is buffered, and caps a body with no (or a lying) `Content-Length` after a single buffered read — either way with the new `PayloadTooLargeError` (HTTP 413). Multipart uploads are unaffected (handlers stream them).
  - **The internal SPA-nav URL is no longer client-forgeable.** The original URL handed to Vike's `renderPage()` for a controller `view()` travelled via an `x-rudder-original-url` request header that was never stripped from inbound requests — a direct request could forge it to inject an arbitrary URL into Vike's routing. It now travels via a per-request `AsyncLocalStorage` set only by the framework's own rewrite; a client-sent header is ignored.
  - **The dev error page is secure-by-default.** Its gate previously rendered the rich page (full stack, on-disk source, and every request header including `Authorization`/`Cookie`) whenever neither `APP_ENV` nor `NODE_ENV` was `production` — so a deploy that forgot `NODE_ENV=production` leaked source and secrets. It now renders only when the env is _explicitly_ `local`/`development`/`dev`; an unset or unknown env is treated as production.

## 1.17.1

### Patch Changes

- 273eaaa: Make `AppRequest.input()` type-honest. The no-fallback form is now typed `T | undefined` instead of `T`, since a missing key returns `undefined` at runtime. Implemented as an overload, so the with-fallback form still returns a guaranteed `T`, and untyped calls keep returning `unknown` (the default `T = unknown` makes `T | undefined` collapse to `unknown`). Runtime behavior is unchanged; this only corrects a previously unsound return type that hid possible-undefined access behind an explicit type argument.

## 1.17.0

### Minor Changes

- b1205e4: feat(session): duplicate `sessionMiddleware` installs are now neutralized and warned about

  `SessionProvider` auto-installs `sessionMiddleware` on the `web` group; an app that _also_ registers it globally (`m.use(sessionMiddleware(cfg))` in bootstrap/app.ts) used to get two `SessionInstance`s per request — both appended `Set-Cookie`, and the trailing anonymous cookie clobbered the authenticated one on cookie-less requests (silent login loss, deny-all WS auth, two layers from the misconfigured line).

  Now: the inner instance detects the outer session on the request bag, passes through (one session, one `Set-Cookie` — the authenticated cookie survives), and warns once with a pointed message. Detection is request-bag-based, so it also works when the two installs come from two module copies (workspace/linked dev). Additionally, `@rudderjs/core`'s pipeline assembly counts the new `SESSION_MIDDLEWARE` marker (exported from `@rudderjs/contracts`) across the global + web-group chains and warns at boot, before the first request. Single-install apps are byte-identical, no warnings.

## 1.16.0

### Minor Changes

- 26e134b: feat(core): WebSocket-upgrade context runner so `Auth.user()` / `Session.*` resolve inside out-of-band callbacks

  A WebSocket upgrade never flows through the HTTP request pipeline, so the session and auth `AsyncLocalStorage` scopes an HTTP handler relies on were never established. `@rudderjs/sync`'s `onAuth(req, docName)` (added in #1011) therefore ran with no ALS — `Auth.user()` returned `null` and apps had to hand-roll cookie → session → user parsing to authorize a collab room by identity.

  `@rudderjs/core` now registers a context runner on `globalThis['__rudderjs_ws_context_runner__']` at `.create()` (dev and prod). Given a raw Node `IncomingMessage` it synthesizes a minimal `AppRequest`, builds a throwaway `AppResponse` (its `Set-Cookie` sink is discarded — there is no HTTP response on an upgrade), and runs **only** the request-scoped-context middleware from the `web` group — session + auth today — onion-style with the caller's callback as the terminal `next`. CSRF, rate-limit, and arbitrary app middleware are deliberately skipped (they assume a full HTTP request and would, e.g., consume a rate-limit token per upgrade).

  Selection is by a new marker: `REQUEST_CONTEXT` (`Symbol.for('rudderjs.requestContext')`, exported from `@rudderjs/contracts` and re-exported from `@rudderjs/core`). `@rudderjs/session`'s `sessionMiddleware` and `@rudderjs/auth`'s `AuthMiddleware` tag the function they return; apps that write their own ALS-establishing middleware can opt in the same way.

  No behavior change on the HTTP path. The runner is consumed by `@rudderjs/sync` in a follow-up; standalone sync (no server adapter, no runner registered) is unaffected.

## 1.15.0

### Minor Changes

- 7c79edc: Converge the router's schema surface onto Standard Schema (validator-agnostic validation).

  `.body()` / `.query()` (and `RouteOptions` + the verb overloads) now type against `StandardSchemaV1` instead of `ZodType`, matching `.responds()` — so the whole router schema surface accepts any Standard Schema validator (Zod 4, Valibot, ArkType). Zod stays the default and existing code is unaffected (a Zod schema satisfies `StandardSchemaV1` structurally, and `req.query`/`req.body` inference is now `StandardSchemaOutput<S>`, which resolves identically for Zod).

  `@rudderjs/contracts` gains the shared validation funnel both validators route through: `standardValidate(schema, value)` (awaits `~standard.validate()`, which may be async, and normalizes it to a value or the framework's `{ [path]: string[] }` error map) + `standardIssuesToErrors()` + the `StandardSchemaIssue` type (the inlined `StandardSchemaResult` now carries `path`, matching the spec, so per-field errors survive). The error shape and HTTP-422 behavior are byte-for-byte unchanged — the existing body/query validator tests pin parity. The router no longer depends on `zod`.

  This is Phase 1 of the Standard Schema convergence (`docs/plans/2026-06-08-standard-schema-convergence.md`); `@rudderjs/ai` tool schemas are the remaining user boundary, and `FormRequest` intentionally stays Zod-coupled (its `messages()` uses Zod's error map).

- 5c80378: Add `.responds()` and retain route schemas on the definition (typed-responses / OpenAPI groundwork).

  `RouteBuilder.responds(status?, schema, opts?)` declares the shape a route returns, per HTTP status — completing the typed-route story (path/query/body, now response). It's a contract declaration consumed by introspection (the planned `@rudderjs/openapi` emitter); it does not validate the response at runtime. Call it once per status; a `z.union([...])` documents same-status variant shapes.

  The schema params type against **Standard Schema** (the `~standard` interface Zod 4 / Valibot / ArkType all implement), exported from `@rudderjs/contracts` as `StandardSchemaV1` — so the typed surface isn't locked to Zod (Zod remains the default; a Zod schema satisfies it structurally).

  To make routes introspectable, `RouteDefinition` now retains `name`, `bodySchema`, `querySchema`, and `responses`: `.body(schema)` / `.query(schema)` stash the raw schema alongside the validator they install (validation is unchanged), and `.name()` mirrors the name onto the definition. All fields are additive and optional — no behavior change for existing routes.

## 1.14.0

### Minor Changes

- 361b298: Nested `whereHas` / `whereDoesntHave` inside constrain callbacks now works on the native engine: `User.whereHas('posts', q => q.where('published', true).whereHas('comments', c => c.where('approved', true)))`. Strictly more expressive than the dot-path form — constraints at EVERY level (not just the deepest), inner `whereDoesntHave` ("posts with NO flagged comments"), sibling branches that AND together, unbounded recursion, and dot-paths composing inside callbacks. The predicate contract's `nested` field widens to `RelationExistencePredicate | RelationExistencePredicate[]` (dot-paths keep the singular form; existing emitters unaffected) and the native compiler normalizes each level to a child list, compiling one correlated EXISTS per child with its own polarity and constraints. Drizzle and Prisma keep rejecting nested predicates via the `supportsNestedRelationPredicates` marker guard with a clear error (adapter implementations planned separately). `withWhereHas` with a nesting callback falls back to plain `with()` — the flat `withConstrained` shape can't carry children.
- c1c8b58: `whereHas` / `whereDoesntHave` / `has(relation, op, n)` / `withCount` and the other aggregates now work on through relations (`hasOneThrough` / `hasManyThrough`) on all three adapters — Laravel parity for the previously documented v1 gap. The predicate reuses the pivot two-hop `through` shape with the intermediate table in the pivot slot, plus a new `through.fanOut` marker (`@rudderjs/contracts`) for the 1:N intermediate→related cardinality: plain existence keeps the fan-out-safe nested-EXISTS shape, while count comparisons and aggregates run over the JOINED far rows — counts count far rows (a country reaching 3 posts via 2 users has `postsCount === 3`), and a bare intermediate row never satisfies existence. Constrain callbacks apply to the far table (Laravel semantics); nested dot-paths may include through levels; `withWhereHas` on a through relation falls back to plain `with()` (the two-hop eager load is Model-layer). Drizzle requires the intermediate table registered in `tables: { ... }` (same as pivots); Prisma routes whereHas through the existing deferred 2-step lookup and aggregates through a new fan-out-aware batch path. Also fixes a latent Drizzle bug: the pivot-aggregate JOIN's ON clause rendered unqualified column names — ambiguous whenever pivot and related share a column name (always true for through relations, both having `id`).

## 1.13.0

### Minor Changes

- da07742: Automatic `createdAt`/`updatedAt` stamping (Laravel's `$timestamps`, `static timestamps = true` by default). On the native engine, `Model.create()` now stamps both columns and `update()`/`save()` bumps `updatedAt` — previously they were written NULL unless the migration added DB defaults. Stamping is schema-gated via the new optional `OrmAdapter.tableColumns()` capability (implemented by `NativeAdapter` with cached introspection): tables without the columns are silently skipped, and Prisma/Drizzle are untouched (their schemas own timestamp defaults). Opt out per model with `static timestamps = false`.

## 1.12.0

### Minor Changes

- 345d805: Phase-2 engine relocation, step 1 (decouple): the sticky-read scope moves to `@rudderjs/database/sticky`, and `BuiltInCast` moves to `@rudderjs/contracts`.

  - **`@rudderjs/database`** gains the node-only `./sticky` subpath — `runWithDatabaseContext()`, `hasDatabaseContext()`, `markWrote()`, `stickyWrote()`, and `databaseContextMiddleware()` relocate verbatim from `@rudderjs/orm/sticky`. The AsyncLocalStorage stays on `globalThis['__rudderjs_orm_sticky__']` (key unchanged), so the old and new import paths — and any mix of package versions across a dev re-boot — share one scope.
  - **`@rudderjs/orm/sticky`** becomes a re-export shim of `@rudderjs/database/sticky`. Every existing import (including `@rudderjs/orm-drizzle` and app queue-job wrappers) keeps working unchanged; `@rudderjs/database/sticky` is the canonical path going forward.
  - **`@rudderjs/contracts`** now owns the `BuiltInCast` cast-name union; `@rudderjs/orm` re-exports it from the same places as before (`@rudderjs/orm` main entry / `cast.ts`). Moved because the native engine's schema→TS type generator also consumes it, and the engine's new home (`@rudderjs/database`) must never import `@rudderjs/orm`.

  No behavior change; no `native/**` files touched. Part of `docs/plans/2026-06-04-database-extraction-phase-2.md` (PR-A1).

- d89d2cd: feat: lock wait-behavior options — `lockForUpdate(opts?)` / `sharedLock(opts?)` accept `{ skipLocked?: boolean }` (skip rows another transaction holds — `FOR UPDATE SKIP LOCKED`, the concurrent job-reservation pattern) or `{ noWait?: boolean }` (fail immediately instead of blocking — `NOWAIT`). Mutually exclusive — both set throws at the call site. The native engine emits the clauses via `Dialect.lockSql(mode, opts)` on Postgres/MySQL 8 (SQLite stays a no-op, options included); the Drizzle adapter maps to `.for(strength, { skipLocked | noWait })` on pg/mysql. Prisma keeps throwing on the lock methods (no `FOR UPDATE` in its query API).
- eb3bdfe: feat: transaction isolation levels — `transaction(fn, { isolationLevel })` / `DB.transaction(fn, { isolationLevel })` / `Model.transaction(fn, { isolationLevel })` with `'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'`. The native engine emits `SET TRANSACTION ISOLATION LEVEL …` at transaction start on Postgres/MySQL; the Drizzle adapter passes the level through to Drizzle's transaction config; the Prisma adapter maps it to `$transaction`'s `isolationLevel` option. SQLite throws a clear unsupported error (no isolation levels — single-writer is already serializable), and a nested `transaction()` call (savepoint) rejects the option on every adapter.

## 1.11.0

### Minor Changes

- 5bfe9b1: Nested whereHas on the native engine — dot-path relation chains (`User.whereHas('posts.comments', q => q.where('approved', true))`) compile as nested correlated EXISTS, with Laravel `hasNested` semantics: the constrain callback and any `has()` count comparison apply to the DEEPEST relation, outer levels are plain existence, `whereDoesntHave('a.b')` flips only the outermost EXISTS (a parent row with childless intermediates doesn't defeat it), and `has('a.b', '<', 1)` flips to doesn't-have. Works across `whereHas` / `whereDoesntHave` / `orWhereHas` / `orWhereDoesntHave` / `has` / `orHas` / `whereRelation`, any chain depth, and every relation type the single-level form supports (including belongsToMany pivot hops and arrow-path JSON constraints on the deepest level). `RelationExistencePredicate` (contracts) gains an optional `nested` child predicate. Adapters without support (Drizzle/Prisma for now) throw a clear Model-layer error instead of silently ignoring the field; the nested-whereHas-inside-a-constrain-callback error now points at the dot-path form.

## 1.10.0

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

- ad17e79: feat(orm): `onQuery` query listening on the native engine + app-facing `DB.listen()`

  Laravel's `DB::listen` arrives in RudderJS:

  - **`@rudderjs/contracts`**: `onQuery?(listener)` is now an optional capability on the `OrmAdapter` contract, with new `QueryEvent` (`{ sql, bindings, duration, connection?, model? }`) and `QueryListener` types — the shape Telescope's QueryCollector and Pulse's slow-query recorder already consume.
  - **`@rudderjs/orm` (native engine)**: the `NativeAdapter` implements `onQuery` by instrumenting its executor — every executed query (Model reads/writes, `DB.*` raw calls, and queries inside `transaction()`, which share the top-level listener list) is timed with `performance.now()` and reported with its SQL + bindings. Listener errors are swallowed and never break the query; only successful executions report (Laravel `QueryExecuted` parity). Transaction control statements (BEGIN/COMMIT/SAVEPOINT) are not reported.
  - **`@rudderjs/database`**: new `DB.listen(listener)`, mirroring Laravel's `DB::listen` — delegates to the active adapter's `onQuery` hook and throws a clear adapter-named error when the adapter doesn't support query listening. `QueryEvent` / `QueryListener` are re-exported.
  - **`@rudderjs/orm-prisma`**: the existing ad-hoc `onQuery` method is now typed to the shared contract (no behavior change).

  The Drizzle adapter does not implement the hook yet — `DB.listen()` throws its clear unsupported error there; a follow-up adds it.

- 0b085a6: feat(orm): query-builder breadth — joins, structured `select()`, `groupBy` / `having`

  Adds Laravel-style joins, column projection, and grouping to the query builder. The native engine fully supports them:

  - **Joins** — `join` / `leftJoin` / `rightJoin` / `crossJoin`, with column-vs-column `on()` and bound `where()` conditions. Simple form `join('posts', 'posts.userId', '=', 'users.id')` and callback form `join('posts', j => j.on(...).where(...))`.
  - **Projection** — `select('users.id', 'posts.title')` (quoted, qualified columns; combines with `selectRaw`).
  - **Grouping** — `groupBy(...columns)` + `having(col, op, value)` / `orHaving` / `havingRaw('COUNT(*) > ?', [3])` / `orHavingRaw`. With a `GROUP BY` present, `count()` / `paginate()` count the number of groups (wrapped subquery), matching Laravel.

  Each is also a `Model` static (`User.join(...)`, `User.select(...)`, `User.groupBy(...)`, `User.having(...)`).

  On the Drizzle and Prisma adapters these throw with a pointer to the native engine or the `DB` facade — their typed clients can't map a join/projection/grouping result back to a single hydrated model (the same reason `selectRaw` throws there). Use `@rudderjs/orm/native`, or `DB.select(sql, bindings)`.

  `JoinClause` (the join-callback sub-builder type) is exported from `@rudderjs/contracts` and re-exported from `@rudderjs/orm`.

- 26b7acf: Read/write split + sticky reads on the native engine (multi-connection PR3).

  A native connection can declare read replicas in `config/database.ts` — `read: { url: string | string[] }` (round-robin per query), optional `write: { url }` (defaults to `url`), and `sticky: true` for read-your-writes: after a write within the current request scope, reads on that connection route to the writer. Routing rules (Laravel parity): un-locked SELECT terminals + `selectRaw`/`DB.select` → read pool; writes, DDL, locked selects (`lockForUpdate`/`sharedLock`), and **everything inside a transaction** → write connection. The sticky request scope is entered by a middleware the native provider auto-installs on the `web` + `api` groups when a sticky split connection is configured; outside a request scope (jobs, commands) sticky is a no-op and reads go to replicas — wrap with `runWithDatabaseContext()` from the new node-only `@rudderjs/orm/sticky` subpath for read-your-writes there. Query events (`DB.listen`/`onQuery`) now carry the **connection name** (config name when known, driver name otherwise) and — on split connections only — a `target: 'read' | 'write'` field (`QueryEvent.target`, new optional contract field). The dev-HMR driver cache includes the replica list in its signature and `disconnect()` closes replica drivers too.

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
