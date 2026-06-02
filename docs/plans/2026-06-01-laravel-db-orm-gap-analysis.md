# Laravel 13.x ↔ RudderJS — Database/ORM Feature-Gap Analysis

> **Re-baselined 2026-06-02 (after Phase 1).** The §8 query-builder list is now
> essentially closed. Phase-1 PR → status map:
>
> | # | PR | Status |
> |---|---|---|
> | 1 | `@rudderjs/database` scaffold + `DB` facade + raw-exec seam | ✅ #823 |
> | 2 | Cross-adapter `transaction()` (prisma + drizzle) | ✅ #824 |
> | 3 | Drizzle eager `with()` — throw (#826) then real model-layer load | ✅ #826 → #829 |
> | 4 | `upsert()` (native + drizzle + prisma) | ✅ #832 |
> | 5 | `chunk()` / `lazy()` | ✅ #833 |
> | 6 | `cursorPaginate()` + base64 cursor | 🔄 #834 (open, conflict-resolve) |
> | 7 | Raw expressions — `selectRaw`/`whereRaw`/`orWhereRaw`/`orderByRaw` + `DB.raw(...)` | 🔄 #835 (open, this PR) |
> | — | Factory relationship building + `Model.factory()` + unguard-on-seed | ✅ #831 |
> | — | Native engine pg/mysql + migrations + scaffolder default | ✅ #794–#830 (separate arc) |
>
> **Remaining DB/QB gaps** (none "high-priority correctness" anymore — all ergonomic or net-new surface):
> the named `whereX` sugar family (PR8 — `whereIn`/`whereNull`/`whereBetween`/`whereColumn`/`when`/`unless`/`pluck`/`value`/aggregate terminals);
> joins/unions/`groupBy`/locking; multi-connection + read/write split; `morphs()` migration helper;
> `whereHas` OR/count operators; the Redis facade. See §3 (unchanged) for the full medium/low list.
>
> ---
>
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

Parity broke at two seams, **both largely closed in Phase 1 (2026-06-02)**:

1. **DB / query-builder layer.** ~~No public `DB` facade, no raw-expression escape
   hatch, no `chunk`/`lazy`/`cursor` streaming, no `upsert`~~ — all now shipped: a
   `DB` facade (`@rudderjs/database`, #823), raw expressions (#835), `chunk`/`lazy`
   (#833), `upsert` (#832), cursor pagination (#834, in review). Still missing:
   joins/unions/`groupBy`/locking and the named `whereX`/date-helper **sugar**
   (PR8 — ergonomic, mostly expressible via `where(col, op, val)` today).
2. **Uneven adapter coverage.** ~~`transaction()` and eager `with()` work on the
   native engine but are stubbed on Prisma/Drizzle~~ — cross-adapter `transaction()`
   shipped on both (#824) and Drizzle eager `with()` is real (#829). `onQuery`/`DB::listen`
   remains Prisma-only with no app-facing registration.

Headline correctness gaps are closed. **What remains is net-new surface, not
correctness:** the `whereX` sugar (PR8), joins/unions/locking, multi-connection +
read/write split, the Redis facade, and the deliberate `@rudderjs/database`
extraction (Phase 2). Migrations and seeding are solid on the native engine but
thin on flags (`--step`, `--seed` combos, `--class`) and on the `morphs()` schema
helper. **Factories were the weakest sub-area; #831 closed the headline factory
gaps** — relationship building (`has`/`for`), `Model.factory()` entry point, and
unguard-during-seed are all now in.

---

## 2. High-priority gaps

Deduped, ordered by leverage for a Laravel dev landing in RudderJS. **Status column re-baselined 2026-06-02** — most rows shipped in Phase 1.

| Feature | Area | Status | What Laravel has | RudderJS today | Recommendation |
|---|---|---|---|---|---|
| Cross-adapter `transaction()` | db-connection | ✅ #824 | `DB::transaction(fn)` everywhere | Now on all three: native (ALS + SAVEPOINTs), Prisma (`$transaction`), Drizzle (`db.transaction`) + `DB.transaction()` | **Done.** Top correctness gap closed. |
| `chunk()` / `chunkById()` | db-query-builder | ✅ #833 | Memory-bounded batch iteration | `chunk(size, cb)` on the Model-layer QB + static; offset-pages via existing primitives | **Done** (`chunkById` not separately needed — offset paging covers it). |
| `lazy()` / `lazyById()` | db-query-builder | ✅ #833 | Streamed `LazyCollection` | `lazy(size?)` async generator (default 1000) | **Done.** |
| `upsert()` (bulk, ON CONFLICT) | db-query-builder / orm | ✅ #832 | Atomic bulk upsert w/ `uniqueBy` | `Model.upsert(rows, uniqueBy, update?)` — native+drizzle one statement, prisma per-row `$transaction` | **Done.** |
| `cursorPaginate()` + CursorPaginator | pagination | 🔄 #834 | Keyset pagination, base64 cursor | Model-layer keyset paginator (open PR, conflict-resolve) | **In review.** |
| Raw expressions (`DB::raw`/`selectRaw`/`whereRaw`/`orderByRaw`/…) | db-query-builder | 🔄 #835 | Raw SQL fragments in any clause | `selectRaw`/`whereRaw`/`orWhereRaw`/`orderByRaw` + `raw(...)`; native full, drizzle where/order, prisma throws→DB facade | **In review** (this PR). |
| Public `DB` facade (raw select/insert/update/delete/statement) | db-query-builder / db-connection | ✅ #823 | `DB::select/insert/update/delete/statement` | `@rudderjs/database` `DB` facade over the `OrmAdapter` raw-exec seam; `DB.raw()` + `DB.transaction()` | **Done** (named-connection switching still future — see §3). |
| Eager `with()` on Drizzle | orm | ✅ #829 | `with('rel')` everywhere | Real model-layer batched load (was throw #826, now real); Prisma `include` unchanged | **Done.** |
| Factory relationship building (`has`/`hasMany`/`for`/`hasAttached`) | seeding | ✅ #831 | Fluent related-graph creation | `Model.factory()` + `has`/`for` relationship building | **Done.** |
| Mass-assignment auto-disabled during seeding/factories | seeding | ✅ #831 | Guard off while seeding | Factory create routes through the unguarded path | **Done.** |
| `morphs()` / `nullableMorphs()` migration helper | db-schema-migrations | ⬜ open | Scaffolds `{name}_type` + `{name}_id` | Morph relations are first-class, but no migration-side helper | Cheap to add to `blueprint.ts`; native-engine track. Still open. |
| `whereHas` OR / count operators (`orWhereHas`, `has('rel','>=',3)`) | orm / db-query-builder | ⬜ open | Full existence-query family | `whereHas`/`whereDoesntHave` w/ constraint present; nested throws; no OR/count forms | Extend the existing `compileExistsSubquery` path. Still open. |

---

## 3. Medium / low gaps

**db-query-builder (sugar & ergonomics — mostly cheap)**
> _Re-baseline note (2026-06-02): `chunk`/`lazy` (#833), `upsert` (#832), raw expressions + `selectRaw` (#835), and cursor pagination (#834, in review) are now DONE and removed from this list. The **named `whereX` sugar + conditional/`pluck`/`value`/aggregate-terminal cluster below is the next batch (PR8)** — it's the remaining cheap, high-touch ergonomics for Laravel devs._
- `value()`, `pluck()`, `Model.sum()/max()/min()/avg()`, `exists()/doesntExist()` terminals (`_aggregate` plumbing exists — only convenience methods missing).
- `select()`/`addSelect()`/`distinct()` projection; ORM is row-oriented. (`selectRaw` shipped #835; structured `select()` still missing.)
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

## 8. Suggested first PRs (Phase 1) — **COMPLETE (2026-06-02)**

Independent, shippable, high-leverage — all shipped except cursor pagination (in review):

1. ✅ **Cross-adapter `transaction()`** on `orm-prisma` + `orm-drizzle` — #824.
2. ✅ **Drizzle eager `with()`** — throw first (#826), then real model-layer load (#829).
3. ✅ **Factory correctness** — unguard-during-seed + `Model.factory()` + `has`/`for` relationship building — #831.
4. ✅ **`upsert()`** across native + Prisma + Drizzle — #832.
5. ✅ **`chunk()` / `lazy()`** — Model-layer QB methods + statics — #833.
6. 🔄 **`cursorPaginate()`** — keyset paginator — #834 (open, conflict-resolve).
7. 🔄 **Raw expressions + `DB` facade subpath** — `DB` facade shipped #823; raw expressions (`selectRaw`/`whereRaw`/`orWhereRaw`/`orderByRaw` + `raw(...)`) #835 (this PR, open).

### Next (Phase 1.5 / Phase 2)

- **PR8 — `whereX` sugar family** (next, cheap): named `whereIn`/`whereNotIn`/`whereBetween`/`whereNull`/`whereColumn`/`whereNot`/`whereLike` + `when()`/`unless()` + `pluck()`/`value()` + `sum/max/min/avg`/`exists` terminals + structured `select()`/`distinct()`. Pure ergonomics — most expressible via `where(col, op, val)` today, so this is high-touch DX, not new capability.
- **Bigger QB surface** (net-new, larger): joins/unions/`groupBy`/`having`/locking; JSON-path where; multi-connection + read/write split; `onQuery`/`DB::listen` on native+drizzle.
- **`morphs()` migration helper** + **`whereHas` OR/count operators** — the two ⬜ rows left in §2.
- **Phase 2 — deliberate `@rudderjs/database` extraction**: the boundary + `DB` facade + `ORM → DB` dep direction are already established (#823); the native engine internals (`orm/src/native/{compiler,dialect,driver,query-builder,schema}`) still physically live in `@rudderjs/orm` and get relocated in a dedicated engine-migration step once the surface has proven out.
