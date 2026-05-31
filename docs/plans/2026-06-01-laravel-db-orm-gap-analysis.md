# Laravel 13.x ↔ RudderJS — Database/ORM Feature-Gap Analysis

> Date: 2026-06-01. Method: a multi-agent audit — one agent per Laravel 13.x doc
> page fetched the page, enumerated its feature surface, mapped each feature
> against the RudderJS codebase (`@rudderjs/orm` + `/native` engine, `orm-prisma`,
> `orm-drizzle`, `cache`, `queue`, `broadcast-redis`, `contracts`), and produced a
> structured gap list; a synthesis pass consolidated + prioritized.
>
> Pages audited (13): database, queries, pagination, migrations, seeding, redis,
> eloquent, eloquent-relationships, eloquent-collections, eloquent-mutators,
> eloquent-resources, eloquent-serialization, eloquent-factories.
>
> **Purpose:** drive the next ORM/DB feature arc, and settle the
> "split the data layer vs rename" architecture question (see §7).

---

## 1. Executive summary

RudderJS has reached genuinely high Eloquent-**model** parity: core read/write,
soft deletes, observers/events, mutators & casts, dirty tracking, scopes, route
binding, polymorphic relations, eager-aggregates, mass-assignment enforcement,
pruning, and serialization (hidden/visible/appends) are present and mostly 1:1.

Parity breaks at two seams:

1. **DB / query-builder layer.** No public `DB` facade, no raw-expression escape
   hatch, no `chunk`/`lazy`/`cursor` streaming, no `upsert`, no joins/unions/
   `groupBy`/locking, no `whereIn`/`whereBetween`/`whereNull`/date-helper sugar —
   the ORM is model-centric with no standalone fluent query API.
2. **Uneven adapter coverage.** `transaction()`, `onQuery`, and eager `with()`
   work on the native (SQLite) engine but are missing or stubbed on Prisma/Drizzle
   — which is where most production apps actually run.

Headline gaps worth closing: cross-adapter `transaction()`, `chunk`/`lazy`
iteration, `upsert`, cursor pagination, and a raw-SQL escape hatch. Migrations and
seeding are solid on the native engine but thin on flags (`--step`, `--seed`
combos, `--class`) and on the `morphs()` schema helper. Factories are the weakest
sub-area — no relationship building (`has`/`for`/`hasAttached`), no
`Model.factory()` entry point, and mass-assignment is *not* disabled during
seeding (the opposite of Laravel).

---

## 2. High-priority gaps

Deduped, ordered by leverage for a Laravel dev landing in RudderJS.

| Feature | Area | Status | What Laravel has | RudderJS today | Recommendation |
|---|---|---|---|---|---|
| Cross-adapter `transaction()` | db-connection | partial | `DB::transaction(fn)` everywhere | Native-only (ALS-scoped + SAVEPOINTs in `native/adapter.ts`); Prisma/Drizzle throw "adapter does not support transactions" | **Top priority.** Implement on orm-prisma + orm-drizzle. Most prod apps run these; correctness gap, not sugar. (Known carry-over.) |
| `chunk()` / `chunkById()` | db-query-builder | missing | Memory-bounded batch iteration | None public; `model:prune` re-implements its own loop | Wrap the existing prune chunk loop into a public QB method. |
| `lazy()` / `lazyById()` | db-query-builder | missing | Streamed `LazyCollection` | None | Async-generator fits TS; pairs with `chunk` as the large-dataset pattern. |
| `upsert()` (bulk, ON CONFLICT) | db-query-builder / orm | missing | Atomic bulk upsert w/ `uniqueBy` | `updateOrCreate`/`firstOrCreate` (single-row, select-then-write); `insertMany` has no conflict clause | High value for sync/import; native SQLite/PG + Prisma/Drizzle all support ON CONFLICT. |
| `cursorPaginate()` + CursorPaginator | pagination | missing | Keyset pagination, base64 cursor | Only offset `paginate()` | Highest-value pagination gap for API/infinite-scroll; order-by infra exists to build on. |
| Raw expressions (`DB::raw`/`selectRaw`/`whereRaw`/`orderByRaw`/…) | db-query-builder | missing | Raw SQL fragments in any clause | No escape hatch on the ORM QB | Add a `raw()` wrapper threaded through the compiler. |
| Public `DB` facade (raw select/insert/update/delete/statement) | db-query-builder / db-connection | partial | `DB::select/insert/update/delete/statement` | Internal `Executor.execute(sql, bindings)` seam exists (`native/driver.ts`); Prisma uses `$queryRawUnsafe`; no public ergonomic facade | Surface the existing seam as a public `DB`-style API. Cheap given the plumbing exists. |
| Eager `with()` on Drizzle | orm | partial | `with('rel')` everywhere | Prisma `include` works; **Drizzle `with()` is a no-op stub** (`orm-drizzle/src/index.ts:303`) | Real footgun — silent no-op = missing relations, not an error. Wire it or throw. |
| Factory relationship building (`has`/`hasMany`/`for`/`hasAttached`) | seeding | missing | Fluent related-graph creation | None on `ModelFactory`; FKs wired by hand | Biggest factory gap; likely needs a `Model.factory()` entry point first. |
| Mass-assignment auto-disabled during seeding/factories | seeding | missing | Guard off while seeding | Factory `create()` → `Model.create()` **enforces** fillable/guarded → silently drops guarded keys | Surprising inversion of Laravel. Route factory create through a `forceFill`/unguarded path. |
| `morphs()` / `nullableMorphs()` migration helper | db-schema-migrations | missing | Scaffolds `{name}_type` + `{name}_id` | Morph relations are first-class, but no migration-side helper | Cheap to add to `blueprint.ts`; high value given morphs are first-class. |
| `whereHas` OR / count operators (`orWhereHas`, `has('rel','>=',3)`) | orm / db-query-builder | partial | Full existence-query family | `whereHas`/`whereDoesntHave` w/ constraint present; nested throws; no OR/count forms | Extend the existing `compileExistsSubquery` path. |

---

## 3. Medium / low gaps

**db-query-builder (sugar & ergonomics — mostly cheap)**
- `value()`, `pluck()`, `Model.sum()/max()/min()/avg()`, `exists()/doesntExist()` terminals (`_aggregate` plumbing exists — only convenience methods missing).
- `select()`/`addSelect()`/`distinct()` projection; ORM is row-oriented.
- Named `whereIn`/`whereNotIn`, `whereBetween`/`whereNotBetween`, `whereNull`/`whereNotNull`, `whereColumn`, `whereNot`, date helpers (`whereDate`/`whereMonth`/`wherePast`/…), `whereLike` w/ caseSensitive (most expressible via `where(col,'IN'|'LIKE',…)` today but unnamed).
- `when()`/`unless()` conditional clauses.
- Joins (`join`/`leftJoin`/`joinSub`/lateral), unions, `groupBy`/`having`, pessimistic locking (`sharedLock`/`lockForUpdate`), `truncate`, `insertOrIgnore`, `incrementEach`/`decrementEach`, `latest`/`oldest`/`inRandomOrder`/`reorder`, `tap`/`pipe`, `dd`/`dump`/`toSql`.
- JSON-path where (`whereJsonContains`, `->` path) — only whole-column `json` cast today.
- Vector trio (`selectVectorDistance`/`whereVectorDistanceLessThan`/`orderByVectorDistance`) — a `whereVectorSimilarTo` analogue exists (Postgres+Prisma only).
- `withCasts` query-time casting; `simplePaginate` (no-COUNT).

**db-connection**
- Multi-connection: runtime `DB::connection('name')`, per-model `$connection`, `Schema::connection()` — only the default is wired into `ModelRegistry`.
- Read/write split + sticky reads; deadlock-retry `attempts`; manual `beginTransaction`/`commit`/`rollBack`.
- `onQuery` / `DB::listen`: adapter hook exists but **only Prisma implements it** (native + Drizzle don't); no app-facing registration.
- `whenQueryingForLongerThan` (cumulative threshold — Telescope does per-query only).

**db-schema-migrations**
- Flags: `migrate --step`/`--pretend`/`--isolated`/`--force`; `migrate:rollback --step`/`--batch`/`--pretend`; standalone `migrate:reset`; `migrate:refresh --seed`/`--step`; `migrate:fresh --seed`/`--database`; `schema:dump` squashing.
- Column types: `mediumInt`/`smallInt`/`tinyInt`, `char`, `longText`/etc., `double`, `date`/`time`/Tz/precision, `jsonb`, `ulid`/`foreignUuid`/`foreignUlid`/`foreignIdFor`, `enum`/`set`; `t.vector()` Blueprint (raw-SQL path exists).
- Modifiers: Expression defaults, `useCurrentOnUpdate`, `comment`, `after`/`first`, generated columns. `change()` is SQLite-only (rebuild dance; pg/mysql NotImplemented).
- FK shorthands `cascadeOnDelete`/`nullOnDelete` (verbose `onDelete('cascade')` works); `dropForeign` records intent but SQLite compiler rejects it; `enable/disable/withoutForeignKeyConstraints`.
- Indexes: `hasIndex`, `fullText`, `spatialIndex`, `renameIndex`, `dropUnique`/`dropPrimary` aliases; cluster-drop aliases (`dropMorphs`/`dropTimestamps`/`dropSoftDeletes`); richer migration lifecycle events.

**seeding**
- `db:seed --class`, `migrate:fresh --seed`/`--seeder`, `db:seed --force` (no prod guard today).
- Seeder-level `WithoutModelEvents` (only per-class `Model.withoutEvents`); DI into `run()`.
- Factory: `Model.factory()` static + discovery conventions; `afterMaking`/`afterCreating`; `make()` returning hydrated *unsaved* models (returns plain attrs today); `Sequence` distributed across batch (only per-attribute `sequence()`); chainable `count()`; FK-as-factory & closure-attribute-receiving-sibling-attrs in `definition()` (closures called with no args today — real gap); `recycle()`; `trashed()` state; `makeOne`/`createOne`.

**orm-eloquent (models)**
- Keys: UUID/ULID auto-gen (`HasUuids`/`HasUlids`), `keyType`/`incrementing` config.
- Retrieval: `cursor()`, subquery select/orderBy + `whereColumn`, `findMany`, `firstWhere`, `findOr`/`firstOr`, `firstOrNew`, `createOrFirst`, `wasRecentlyCreated`.
- Writes: static `destroy(...keys)`/`forceDestroy`; `*OrFail` transactional variants; `restoreOrCreate`.
- Relations: `hasOneThrough`/`hasManyThrough`, one-of-many (`latestOfMany`), `belongsTo withDefault`, `whereRelation`/`orWhereRelation`, `associate`/`dissociate`, m2m `syncWithoutDetaching`/`toggle`/`updateExistingPivot`, **pivot columns on reads** (`withPivot`/`withTimestamps`/`as`/`using` — v1 omits), `wherePivot`/`orderByPivot`, `touches`, default-eager `$with`, dynamic relations, relation-scoped `firstOrCreate`/`save(model)`/`push`.
- Strictness: `preventSilentlyDiscardingAttributes`.
- Mutators/casts: multi-column `set` (single-key only today), `decimal:N`, `enum`, `hashed`, `withCasts`/`mergeCasts`, cast params (`Class:arg`), per-attribute date format / `serializeDate`.
- Collections: queries return **plain arrays**, not auto-wrapped `ModelCollection` (rich methods opt-in via `.wrap()`); `find` array/instance overloads, `findOrFail`, `intersect`, `partition`, collection-level `mergeVisible`/`setVisible`/`toResource`, `load` constraint closures.
- Resources: `make:resource` generator, `toResource()`/`toResourceCollection()` + `UseResource`, `whenHas`/`whenCounted`/`whenAggregated`/`whenPivotLoaded`, paginator→`{data,links,meta}` envelope w/ URLs, `additional()`/`with()`/`response()`/`withResponse()`, JSON:API subsystem.
- Serialization: runtime `append()`/`mergeAppends`/`setAppends`/`withoutAppends` (static `appends` only); `attributesToArray`.
- Redis: no first-party `Redis` facade (dynamic command passthrough / `command()`), no named-connection registry, no `transaction`/`pipeline`/`eval` user API, no `psubscribe`; `publish`/`subscribe` exist only inside the broadcast driver (single fixed channel).

---

## 4. Already at parity (don't re-pitch)

- **Core CRUD**: `all`/`find`/`first`/`firstOrFail`/`firstOrCreate`/`updateOrCreate`, `save`/`create`/`fill`/`forceFill`, mass updates, `increment`/`decrement`, `delete`/`forceDelete`/`deleteAll`, `replicate`.
- **Dirty tracking**: `isDirty`/`isClean`/`wasChanged`/`getOriginal`/`getChanges`/`getDirty`.
- **Soft deletes** full suite + **pruning** (`Prunable`/`MassPrunable`/`model:prune`).
- **Scopes** (global + local); **route model binding** (`routeKey`/`findForRoute`).
- **Events/observers** + muting (`withoutEvents`, `saveQuietly`/`deleteQuietly`/`restoreQuietly`).
- **Relations** (non-through): `hasOne`/`hasMany`/`belongsTo`/`belongsToMany`, all morph variants, `attach`/`detach`/`sync`, `withCount`/`withSum`/`withMin`/`withMax`/`withAvg`/`withExists` + `load*`, `withWhereHas` (Prisma).
- **Mutators & casts**: accessors/mutators, declarative `casts`, string/int/float/bool/array/json/date/datetime/encrypted, custom `CastUsing`.
- **Serialization**: `toJSON`, hidden/visible/appends + instance-level `make*`/`merge*`/`set*`, auto-serialize from controllers via server-hono.
- **Migrations (native engine)**: `make:migration` + inference, up/down, `migrate`/`migrate:status`, `Schema.create`/`table`/`rename`/`drop`/`hasTable`/`hasColumn`, column-type basics, `id`/`foreignId`/`constrained`/`foreign().references().on()`, `onDelete`/`onUpdate`, `nullable`/`unsigned`/`primary`/`unique`/`index` + Laravel-style auto-naming. (Postgres dialect + driver + types now shipped, #819/#820/#821.)
- **Seeding core**: `make:seeder`, `Seeder`+`run()`, `DatabaseSeeder`, `call()`, factories usable in seeders, `db:seed`.
- **Offset pagination** (`paginate` length-aware across all 3 adapters).
- **Parameterized binding / SQL-injection safety** throughout the native compiler.

---

## 5. Intentionally out of scope (n/a)

- `getPdo()` — PHP-specific raw driver handle.
- `preventLazyLoading` / `chaperone()` — no implicit lazy-property N+1 footgun exists (relations are explicit via `related()`/`with()`).
- Blade pagination link rendering / view publishing / `useBootstrapFour` — RudderJS views are React/Vue/Solid/vanilla.
- PhpRedis vs Predis selection, serializer/compression, retry/backoff — PHP-extension specifics (RudderJS standardizes on ioredis).
- `AsArrayObject`/`AsStringable`/`AsFluent`/`AsUri`, immutable Carbon casts, `json:unicode`, accessor object-caching — solve PHP limitations that don't exist in JS.
- Two-tier collection downgrade (`Support` vs `Eloquent`), `PreserveKeys`, `Collects` — PHP array-key semantics; everything is a JS array.
- Encryption key rotation, stub publishing, MySQL-only table/column options (`engine`/`charset`/`collation`/`invisible`/`instant`/`lock`/`online`) — driver/ecosystem specifics (some relevant only once a MySQL native dialect ships).

---

## 6. ORM vs DB categorization (architecture evidence)

### DB layer — `Illuminate\Database` / `DB` facade territory
Tags: `db-query-builder`, `db-schema-migrations`, `db-connection`, `redis`, `pagination`, `seeding`.

**Net-new surface: LARGE.** Most unbuilt features live here:
- A whole **public `DB` facade** that doesn't exist (raw select/insert/update/delete/statement/unprepared, `listen`, named-connection switching) — the internal `Executor.execute` seam is the only plumbing.
- **Query-builder breadth**: raw expressions, joins, unions, `groupBy`/`having`, locking, `chunk`/`lazy`/`cursor`, `upsert`, the full `whereX` family, `when`/`unless`, `pluck`/`value`, debugging — dozens of methods.
- **Multi-connection / read-write split** — a connection-manager abstraction that doesn't exist (`ModelRegistry` is single-adapter).
- **Cursor + simple pagination**, paginator objects with behavior/URLs.
- **Migration flags + schema-introspection facade** (`getTables`/`getColumns` exist internally in `native/schema/introspect.ts` but aren't a cohesive facade) + `db:show`/`db:table`/`db:monitor` CLI.
- **Redis facade** — entirely absent as a user surface (Redis is consumed only internally by cache/broadcast/lock).

Conceptually, **most of this stands alone** — a fluent query builder, raw-SQL escape hatch, connection manager, schema introspection, migrations, Redis client, and pagination are all usable *without* models. Laravel draws this line: `Illuminate\Database` is the foundation; Eloquent sits on top.

### ORM layer — Eloquent models
Tag: `orm-eloquent`.

**Net-new surface: MEDIUM.** The model core is largely done; gaps are sugar + a few structural items:
- Mostly **convenience/sugar**: `findMany`/`firstWhere`/`findOr`, `destroy`/`forceDestroy`, runtime `append*`, collection completeness, resource helpers, `*OrFail`.
- A few **structural** items genuinely tied to models: through-relations, one-of-many, pivot-column reads, UUID/ULID keys, factory relationship building, custom collections.
- Several "ORM" gaps are **DB-layer dependencies wearing an Eloquent label**: `*OrFail` and Prisma/Drizzle `transaction` (transactions), `upsert`/`chunk`/`lazy`/`cursor` (query builder), per-model `$connection` (connection manager) — can't be closed in an ORM package alone.

---

## 7. Architecture decision — split vs rename

### Rename `@rudderjs/orm` → `@rudderjs/database`? **No.**
High blast radius (every import, 5+ adapter/peer packages, both playgrounds,
scaffolder, docs, the published exports map — and we're 1.0, so it's a major
bump) for marginal clarity. "ORM" is the marketable, recognized framing
(Prisma/Drizzle/TypeORM all brand as ORM while bundling a query builder +
migrations). **Adding a `DB` *facade* (the API) is worth doing — that is not the
same as renaming the package.**

### Split the data layer? **Lean yes — but sequenced, not big-bang.**
§6's evidence (the DB-layer surface is **LARGE and conceptually model-independent**,
mirroring Laravel's `Illuminate\Database` → Eloquent boundary; several ORM gaps are
*blocked* on DB primitives) is the strongest structural argument that a
DB/query-builder layer wants to be a distinct module with a clean `ORM → DB`
dependency direction.

**But don't carve it cold.** The native engine interleaves query-builder /
compiler / schema / model-hydration tightly (`native/query-builder.ts`,
`native/compiler.ts`, `native/driver.ts`; `Model` Proxy-wraps the QueryBuilder).
Carving a public contract through that is the real cost — and most feature *value*
ships without the split. The adapter abstraction (`OrmAdapter`) also already sits
between models and the raw driver; a separate DB package needs its own adapter
story or reuses that.

### Recommended sequence

1. **Phase 1 — close correctness/high-leverage gaps in place** (no split needed):
   cross-adapter `transaction()` (top priority), the Drizzle `with()` footgun,
   factory fixes (unguard-on-seed + relationship building + `Model.factory()`),
   `upsert`, `chunk`/`lazy`, `cursorPaginate`, raw expressions + the `whereX`
   sugar — exposed via a **`DB` facade subpath** inside `@rudderjs/orm`.
2. **Phase 2 — deliberate extraction** of `@rudderjs/database` as the foundation
   (public `DB` facade + query-builder breadth + connection manager + the native
   engine/migrations), with `@rudderjs/orm` depending on it. Plan as its own arc
   once the standalone surface has proven out; the extraction is mechanical once
   the surface is contract-bounded.
3. **Redis is a separate concern** — a `@rudderjs/redis` facade (or fold into
   `@rudderjs/cache`), **not** bundled into the SQL database package.

**Net:** don't rename; add a `DB` facade; lean toward eventually extracting
`@rudderjs/database`, but ship the correctness gaps first and make the split a
planned step, not a prerequisite.

---

## 8. Suggested first PRs (Phase 1)

Independent, shippable, high-leverage — roughly in order:

1. **Cross-adapter `transaction()`** on `orm-prisma` + `orm-drizzle` (Prisma `$transaction`, Drizzle `db.transaction`) — closes the top correctness gap.
2. **Drizzle eager `with()`** — implement or throw (kill the silent no-op).
3. **Factory correctness** — disable mass-assignment during factory `create()`; closure attributes receive sibling attrs; `Model.factory()` entry point; then relationship building (`has`/`for`).
4. **`upsert()`** across native + Prisma + Drizzle (ON CONFLICT / `$transaction`-free bulk).
5. **`chunk()` / `lazy()`** — promote the `model:prune` loop to a public QB method + an async-generator `lazy()`.
6. **`cursorPaginate()`** — keyset paginator on top of the existing order-by infra.
7. **Raw expressions + `DB` facade subpath** — surface `Executor.execute` as `DB.select/insert/update/delete/statement` + a `raw()` wrapper threaded through the compiler. (This is the seed of the eventual `@rudderjs/database` extraction.)
