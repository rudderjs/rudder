# DB/ORM Comparison — Rudder vs Prisma vs Drizzle vs TypeORM vs Kysely vs MikroORM

> Last updated: 2026-06-04 (orm 1.15.0 / database 1.1.0 / orm-prisma 2.1.0 / orm-drizzle 1.9.0).
> Competitor data from each project's CURRENT official docs (researched 2026-06-04, citations in
> the per-axis notes). Companion to `ai-sdk-comparison.md`. Feeds the post-Phase-2
> data-layer quality arc: §13 = where we win (positioning), §14 = gap list (work queue).

## Philosophy / Identity

| | Rudder | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|---|---|---|---|---|---|
| **Version** | orm 1.15.0 | 7.8.0 (7.0 = Rust removed, 2025-11) | 0.45.x stable; **1.0 still RC** | **1.0.0 (2026-05-19**, after 5y on 0.3) | **0.29.2 (pre-1.0)** | 7.0.7 |
| **Weekly downloads** | — (new) | ~12M CLI / ~7.4M client | ~7.25M | ~4.7M | ~2.5M | ~640k |
| **License** | MIT | Apache-2.0 | Apache-2.0 (Studio proprietary) | MIT | MIT | MIT |
| **Pattern** | **Active Record (Laravel parity), 3 engines / 1 Model API** | Data mapper, schema DSL + codegen | Typed SQL query builder | Active Record AND Data Mapper | Pure typed SQL builder ("not an ORM") | Data Mapper + Unit of Work + Identity Map |
| **Schema source of truth** | Migrations (types GENERATED from live DB) | `schema.prisma` (codegen) | TS schema files (inference) | Decorator entities | Hand-written or generated `Database` interface | defineEntity / decorators / EntitySchema |
| **Standalone** | ✅ (CI-certified pack→plain-Node smoke) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Unique angle** | One Model API over native/Prisma/Drizzle engines; full Laravel ergonomics | Largest ecosystem; Studio; Accelerate | Edge-first; zero-dep; SQL-shaped | NestJS default; tree entities | Zero-dep typed SQL; edge | Identity map correctness; Mongo + SQL |

## Architecture notes (2026 state)

- **Prisma 7**: Rust engine REMOVED (TS query compiler), ESM-only, driver adapters required. Own benchmarks: 2–11× faster than Rust era, bundle 14MB→1.6MB. Prisma Next (→v8) = full TS rewrite in progress.
- **Drizzle**: v1.0 (relational API v2 — `defineRelations`, nested relation filters, `through()` m2m) is **RC behind a tag**; default install = 0.45 with the callback-based v1 relations.
- **TypeORM 1.0**: new maintainer team since end-2024 (575 PRs merged in 2025); Node 20+, `mysql2`/`better-sqlite3` only, IoC container removed.
- **Kysely**: still 0.x at 2.5M downloads/week; MikroORM v7 now **executes through Kysely** (knex dropped).

## Schema + Migrations

| Capability | Rudder (native) | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Migration generation | `make:migration` (hand-written, Laravel-style) | ✅ diff vs shadow DB | ✅ diff TS schema | ✅ diff entities | hand-written | ✅ diff + snapshots |
| **Rollback / down** | ✅ rollback/refresh/fresh/--step | ⚠️ manual (`migrate diff` + `db execute`) | **❌ none** | ✅ `migration:revert` | ✅ `migrateDown` | ✅ down + `migration:fresh` |
| Transactional batches | ✅ | per-migration | — | ✅ | — | ✅ (+ master txn) |
| Push/prototype mode | via Prisma/Drizzle engines | ✅ `db push` | ✅ `push` | ⚠️ `synchronize` (prod-dangerous) | — | SchemaGenerator |
| Introspect existing DB | ✅ (`schema:types` reads live DB) | ✅ `db pull` | ✅ `pull` | — | ✅ kysely-codegen | ✅ |
| **Types from schema** | ✅ generated FROM live DB → `Model.for<'table'>()`, post-migrate auto-gen | ✅ `prisma generate` (required step) | ✅ inference (no codegen) | decorators (manual) | manual or codegen | inference (defineEntity) / ts-morph |
| Migration lock (multi-instance) | — | ✅ (advisory) | — | — | ✅ DB-level lock | — |

**Take:** we are the only one with Laravel's full migrate command family AND generated types as a *side effect* of migrating (no codegen step to babysit — Prisma's `generate` gate is its top DX complaint; Drizzle gets inference but pays with TS-schema-as-source-of-truth).

## Query Builder Breadth

| Capability | Rudder | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Joins | ✅ inner/left/right/cross + JoinClause | ❌ (include only; `relationLoadStrategy: join`) | ✅ + **lateral** | ✅ | ✅ | ✅ + subquery joins |
| Unions | ✅ union/unionAll | ❌ raw | ✅ + **intersect/except** | ❌ | ✅ | ✅ |
| groupBy/having | ✅ + grouped-count wrap | ✅ `groupBy()` | ✅ | ✅ | ✅ | ✅ typed having |
| distinct | ✅ SQL `SELECT DISTINCT` | ⚠️ **in-memory post-processing** | ✅ + PG `DISTINCT ON` | PG-only `distinctOn` | ✅ | ✅ |
| Raw escape hatch | ✅ selectRaw/whereRaw/orderByRaw + `DB.raw` | ✅ $queryRaw + **TypedSQL** | ✅ sql`` | ✅ getRawMany | ✅ sql`` | ✅ raw()/sql`` |
| **JSON path predicates** | ✅ arrow paths everywhere + contains/length + **arrow-path UPDATE** | ⚠️ PG/MySQL only, operator set limited | ⚠️ via sql`` (no DSL) | ⚠️ `JsonContains` PG-only | jsonb helpers | ✅ `$elemMatch`/`$size` (v7) |
| Pessimistic locking | ✅ lockForUpdate/sharedLock | **❌ raw only** | ✅ `.for()` + **noWait/skipLocked** | ✅ setLock + skip_locked | ✅ forUpdate/forShare | ✅ 6 LockMode |
| Optimistic locking | ✅ `static version` + OptimisticLockError (all 3 adapters) | ❌ | ❌ | ✅ @VersionColumn | ❌ | ✅ version prop |
| upsert | ✅ single-statement bulk | ✅ (per-row) | ✅ onConflict | ✅ (1.0: orUpdate) | ✅ onConflict | ✅ upsertMany |
| chunk / streaming | ✅ chunk + lazy() generator | **❌ (Prisma Next promise)** | ✅ iterator | ✅ .stream() | ✅ .stream() | ✅ em.stream() (v7) |
| Cursor pagination | ✅ cursorPaginate | ✅ cursor+take | ✅ (guide) | ❌ | ❌ (community libs) | ✅ findByCursor (richest) |
| **CTEs** | ✅ withExpression + recursive (native; shipped post-audit) | ❌ | ✅ | ❌ | ✅ + recursive | ✅ + recursive (v7) |
| **Window functions** | ✅ typed ranking set (`selectWindow`; aggregates-OVER via selectRaw) | ❌ | via sql`` | ❌ | ✅ typed | via sql`` |
| INSERT…SELECT | ✅ insertUsing (native; shipped post-audit) | ❌ | ✅ | ✅ 1.0 | ✅ | ✅ insertFrom |
| Date-part helpers | ✅ whereDate/Time/Day/Month/Year | ❌ | ❌ | ❌ | ❌ | ❌ |
| whereColumn / column-vs-column | ✅ | ❌ | manual sql | manual | ✅ (ref) | manual |

**Take:** post the 2026 query-builder arc (+ the post-audit rounds: CTEs, whereExists, insertUsing, isolation levels, skipLocked/noWait, typed window ranking) we beat Prisma and TypeORM on builder breadth and match Drizzle/Kysely on the core — optimistic locking closed the last delta (shipped post-audit).

## Relations

| Capability | Rudder | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Core 4 (1:1/1:N/N:1/M:N) | ✅ | ✅ | ✅ | ✅ | ❌ (jsonFrom helpers) | ✅ |
| Through (1:1/1:N via intermediate) | ✅ hasOneThrough/hasManyThrough | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Polymorphic** | ✅ morphOne/Many/To/ToMany/edByMany + aliases | ❌ | ⚠️ filtered-relation pattern (v2) | ❌ | ❌ | ✅ discriminator (NEW v7) |
| Eager loading | ✅ `with()` all adapters (batched WHERE-IN) | ✅ include (join or query strategy) | ✅ 1-query RQB | ✅ eager:true (N+1-prone) | jsonArrayFrom | ✅ balanced strategy (v7) |
| Filter by relation | ✅ whereHas + OR/count forms + **nested 'a.b'** | ✅ some/none/every | ✅ nested filters (v2 RC) | ⚠️ via QB joins | manual EXISTS | ✅ relation-path where |
| Relation aggregates | ✅ withCount/Sum/Min/Max/Avg/Exists + loadX | ⚠️ `_count` only | ❌ | @VirtualColumn | manual | countBy |
| Pivot mutations | ✅ attach/detach/sync (+morph pivots) | explicit m2m model | `through()` (v2) | @JoinTable | manual | explicit entity |
| Tree entities | ❌ | ❌ | ❌ | ✅ closure/nested-set/mat-path | ❌ | ❌ |
| Default models (withDefault) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Take:** the relation layer is our strongest axis — full Laravel taxonomy. Only MikroORM v7 has real polymorphic; nobody has through-relations, morph pivots, or relation-aggregate breadth.

## Model layer

| Capability | Rudder | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Record instances | ✅ hydrated Models | ❌ POJOs | ❌ POJOs | ✅ | ❌ | ✅ managed entities |
| Lifecycle observers | ✅ full set incl. restoring | ⚠️ query extensions | ❌ | ✅ subscribers | ❌ | ✅ hooks + subscribers |
| **Soft deletes** | ✅ native + restore + prune | ❌ pattern | ❌ pattern | ✅ @DeleteDateColumn | ❌ | ⚠️ via filters |
| Casts / transformers | ✅ richest: decimal:N, enum, hashed, encrypted, vector, custom | ❌ | ❌ | transformer | ❌ | custom Type |
| Mass-assignment guard | ✅ fillable/guarded | n/a | n/a | ❌ | n/a | ❌ |
| Serialization control | ✅ hidden/visible/appends/resources | ❌ | ❌ | ⚠️ | ❌ | ✅ groups/serializers |
| **API Resources** | ✅ JsonResource + paginator envelopes | ❌ | ❌ | ❌ | ❌ | ❌ |
| Factories + seeding | ✅ states/sequences/has/for | seed script only | drizzle-seed | third-party | ❌ | ✅ factories |
| Global scopes / filters | ⚠️ soft-delete only | ❌ | ❌ | ❌ | ❌ | ✅ parameterized filters |
| Identity map / UoW | ❌ (by design) | ❌ | ❌ | ❌ | ❌ | ✅ (the differentiator) |

## Transactions

| | Rudder | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Callback txn | ✅ all 3 adapters | ✅ interactive | ✅ | ✅ | ✅ | ✅ |
| Savepoint nesting | ✅ | **❌** | ✅ | ✅ | ✅ | ✅ + propagation modes |
| **Isolation levels** | **❌** | ✅ | ✅ | ✅ (+DataSource default) | ✅ | ✅ |
| Per-connection scoping | ✅ `{connection}` + ALS join | ❌ | ❌ | per-DataSource | per-instance | per-EM |
| afterCommit hooks | ❌ | ❌ | ❌ | ⚠️ subscribers | ❌ | ⚠️ events |

## Multi-connection / Replicas

| | Rudder | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Named connections | ✅ lazy menu + `Model.on()` | ❌ (separate clients) | ❌ (separate clients) | ✅ DataSources | ❌ | ✅ contextName |
| Read replicas | ✅ round-robin/random/weighted/custom picker (native+Drizzle) | extension (random) | ✅ withReplicas + custom picker | ✅ replication (random) | ❌ | ✅ replicas (random) |
| **Sticky read-your-writes** | ✅ ALS request scope + auto middleware | ⚠️ `$primary()` manual | ⚠️ custom picker manual | ❌ | ❌ | ⚠️ in-txn only |
| Multi-DB migrations | ❌ (default conn only) | per-client | per-config | ✅ | per-instance | per-config |

**Take:** our sticky implementation (request-scoped ALS, middleware auto-installed, Laravel parity) is the only *automatic* read-your-writes in the field.

## Databases / Drivers / Runtime

| | Rudder | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|---|---|---|---|---|---|
| Native engine drivers | sqlite/pg/mysql | PG/MySQL/MariaDB/SQLite/MSSQL/Cockroach/Mongo | PG/MySQL/SQLite/SingleStore/Cockroach/MSSQL families | 10+ incl. Oracle/Mongo/Spanner | PG/MySQL/SQLite/MSSQL/PGlite | 8 incl. Oracle + **Mongo** |
| Edge/serverless | ⚠️ via Drizzle adapter (D1/libsql/neon...) | ✅ driver adapters + Accelerate | ✅ best-in-class (D1/Turso/Durable Objects/RN) | ❌ | ✅ zero-dep | ✅ v7 zero-dep core, JSR |
| React Native | planned (drizzle expo/op-sqlite path) | ❌ | ✅ | ❌ | expo dialect | ❌ |
| **Multi-engine (one API)** | ✅ **unique** | — | — | — | — | — |

## DX

| | Rudder | Prisma | Drizzle | TypeORM | Kysely | MikroORM |
|---|---|---|---|---|---|---|
| Codegen step required | ❌ (side effect of migrate) | ✅ `generate` (gate) | ❌ | ❌ | optional | ❌ |
| GUI / Studio | **❌** | ✅ Studio | ✅ Studio (proprietary) | ❌ | ❌ | ❌ |
| Query events / logging | ✅ DB.listen w/ timing + conn + r/w target | ✅ logging | ⚠️ logger | ✅ logger | ⚠️ plugin | ✅ + slow-query log (v7) |
| **Dev-server/HMR safety** | ✅ pool reuse across re-boots (battle-tested) | ❌ (user-managed singletons) | ❌ | ❌ | ❌ | ❌ |
| Error pointers | ✅ forward-or-throw names the alternative | error codes | raw driver | typed errors | compile-time | typed errors |
| Setup friction | low (scaffolder) / 2 imports standalone | schema+generate+adapter | config+schema+kit | reflect-metadata+tsconfig | interface+dialect | **highest** (UoW/RequestContext) |
| Framework integration | ✅ full (auth/queue/telescope ride the ORM) | — | — | NestJS module | — | NestJS module |

## Performance (our comparative bench shipped — see Rudder row + `benchmarks/`)

- **Prisma 7** (own bench): 2–11× over its Rust era; bundle 1.6MB; ~320ms cold start (third-party).
- **Drizzle**: thin-layer positioning, prepared statements; ~7.4kb/~45ms cold start (third-party).
- **TypeORM**: weakest standing — class-hydration CPU saturation on large sets; ~450kb/~850ms.
- **Kysely / MikroORM**: thin-layer / no headline bench.
- **Rudder banked**: toJSON fast-path (−39%), batched polymorphic eager-load (14.9×), shared positional bindings, model-layer WHERE-IN batching.
- **Published comparative bench** ✅ — [`benchmarks/results/REPORT.md`](../benchmarks/results/REPORT.md) (the `@rudderjs/benchmarks` suite, §14 #11). Rudder native engine vs Prisma vs Drizzle, query-layer only (no HTTP/server), identical SQLite schema + dataset, result-parity asserted before timing. Headline (SQLite 1k/10k, Apple M5 Pro, prod builds): Rudder is fastest on **7 of 10** ops — single insert, **bulk insert (~5× faster than both)**, **findByPk (~2.5× vs Drizzle, ~4× vs Prisma)**, pivot eager-load (~2×), count/filtered-count, increment, single-level eager-load. Drizzle leads on the read/hydration-heavy ops — **large `get()` (~2.4×)**, small filtered list, and raw serialization — where Rudder's Active-Record model wrapping costs vs Drizzle's plain rows (an honest, expected trade; the −39% toJSON figure was vs Rudder's own prior baseline, not vs Drizzle). **SQLite caveat:** under-represents Prisma's query-engine overhead (more visible on Postgres over a socket); **Postgres is the committed follow-up**.

---

## §13 Where Rudder wins (positioning story)

1. **One Model API, three engines** — native (zero-codegen, batteries-included) or bring Prisma/Drizzle. Nobody else has an engine seam at all.
2. **The only full Laravel-grade Active Record in TypeScript** — TypeORM's AR is save/find statics; ours is observers, casts, scopes, soft-delete+prune, factories, resources, mass-assignment guards.
3. **Relation taxonomy depth** — polymorphic (5 forms), through-relations, pivot mutations, relation aggregates, nested whereHas. Closest competitor (MikroORM v7) just gained basic polymorphic.
4. **Types-first migrations** — column types generated from the live DB as a migrate side effect; Prisma needs a codegen gate, Drizzle needs TS-schema-as-truth, TypeORM/Kysely are manual.
5. **Automatic sticky read-your-writes** — request-scoped ALS + auto-installed middleware. Everyone else: manual `$primary()` or nothing.
6. **Dev-server correctness** — HMR-safe connection caches (no pool leaks across re-boots). No competitor addresses the Vite-SSR re-boot world at all.
7. **JSON story completeness** — arrow paths in reads AND writes, dialect-correct null semantics (incl. the mysql JSON_TYPE shape), across 3 dialects × 2 engines.
8. **Honest cross-dialect correctness work** — bound-timestamp TZ, json double-encode, TINY(1) booleans — driver-level fixes none of the thin builders make.

## §14 Gap list → work queue (priority-ordered draft)

**Tier 1 — table stakes we lack (most-cited features across all 5 competitors):**
1. ✅ `transaction(fn, { isolationLevel })` — SHIPPED (quality-arc Tier-1): contracts `TransactionIsolationLevel`/`TransactionOptions`; native emits `SET TRANSACTION ISOLATION LEVEL` at txn begin (pg inside BEGIN, mysql before it — next-txn semantics), sqlite throws; drizzle passes through to its tx config (sqlite throws); prisma maps to `$transaction({ isolationLevel })` PascalCase. Nested call (savepoint) rejects the option everywhere (ORM-level + driver guards).
2. ~~CTEs~~ — **SHIPPED post-audit**: `withExpression`/`withRecursiveExpression` (native engine; raw-or-builder body, recursive via raw SQL + bindings, `join('name', …)` to reference).
3. ✅ Lock options — SHIPPED (quality-arc Tier-1): `lockForUpdate(opts?)`/`sharedLock(opts?)` with `{ skipLocked? | noWait? }` (mutually exclusive → throw at call site); contracts `LockOptions`; native `Dialect.lockSql(mode, opts)` (pg/mysql `SKIP LOCKED`/`NOWAIT`, sqlite stays no-op); drizzle `.for(strength, { skipLocked|noWait })`; Prisma keeps throwing. Live concurrency tests in `database/src/native/lock-live.test.ts`. Follow-up done too: the queue native driver reserves with `lockForUpdate({ skipLocked: true })` (#901).
4. ~~whereExists~~ — **SHIPPED post-audit**: `whereExists`/`whereNotExists`/`orWhere*` (native engine; builder-or-raw body, whereColumn correlation).

**Tier 2 — differentiated-but-real:**
5. ~~Optimistic locking~~ — **SHIPPED post-audit**: `static version` (`true` → `version` column, string → custom name); create stamps 1, `save()`/`update()`-with-baseline do a conditional `WHERE pk AND version = expected` write (+1 bump) and throw `OptimisticLockError` (`code: 'OPTIMISTIC_LOCK'`, `httpStatus: 409`, expected/actual versions) on zero rows — `ModelNotFoundError` when the row is gone. No-baseline updates bump atomically via the `increment` primitive. Pure Model layer on `where().updateAll()` — all 3 adapters, zero adapter changes.
6. ~~INSERT…SELECT~~ — **SHIPPED post-audit**: `insertUsing(columns, query)` (native engine).
7. ~~Window functions~~ — **SHIPPED post-audit**: `selectWindow(fn, { as, partitionBy, orderBy })` (native engine; typed zero-arg ranking set rowNumber/rank/denseRank/percentRank/cumeDist, ADDITIVE projection; aggregates-OVER/lag/lead documented as the selectRaw recipe).
8. ~~Weighted/custom replica picker~~ — **SHIPPED post-audit**: `read.picker` = `'round-robin'` (default) / `'random'` / weights array (weighted random) / `(count) => index` custom fn; shared `makeReplicaPicker` in `@rudderjs/database` (native + Drizzle, same validation — weights fail at adapter construction, custom fn validated per call, picker runs after the sticky check).
9. ~~`Schema.connection()` + `migrate --connection`~~ — **SHIPPED post-audit**: `migrate*/--connection=<name>` (all six commands; state table on the named connection; `--path=<dir>` for per-database sets; works in prisma/drizzle-default apps with a named native connection; typed-registry regen default-only) + `Schema.connection(name)` (facade rides the DB-bridge connection resolver; non-native connections throw; refuses under `--pretend`; cross-connection DDL escapes the batch txn — documented).
10. ~~afterCommit hooks~~ — **SHIPPED post-audit**: `afterCommit(fn)` (orm) + `DB.afterCommit(fn)` / `DB.connection(name).afterCommit(fn)` (facade, via a new bridge runner). Queue lives in the orm's `transaction()` wrapper itself (above the adapter seam → all 3 adapters free): flush in order after the OUTERMOST commit (awaited `transaction()` resolves after the callbacks), drop on rollback; savepoint rollback discards only its own registrations, savepoint release hands them to the parent level; per-connection trees (named-connection transactions keep separate queues); no open transaction → run immediately.

**Tier 3 — ecosystem/positioning (not engine code):**
11. ~~Published comparative benchmark suite~~ — **SHIPPED**: `@rudderjs/benchmarks` (private workspace package, `benchmarks/`). Query-layer head-to-head vs Prisma + Drizzle on an identical SQLite schema/dataset, 10 ops, **result-parity asserted before timing**, mitata runner, committed [`results/REPORT.md`](../benchmarks/results/REPORT.md). Rudder fastest on 7/10 (writes, findByPk, pivot eager-load, aggregates); Drizzle leads the hydration/serialization-heavy reads. **Postgres + MySQL follow-ups SHIPPED**: engine-parameterized (`BENCH_ENGINE=postgres|mysql`), committed [`results/REPORT-postgres.md`](../benchmarks/results/REPORT-postgres.md) (rudder + Drizzle on porsager, Prisma on node-pg) and [`results/REPORT-mysql.md`](../benchmarks/results/REPORT-mysql.md) (rudder + Drizzle on mysql2, Prisma on mariadb), both parity-gated. Over a real socket Rudder leads the query-layer-heavy ops (bulk insert, hydration, eager + pivot loading) while the competitors' engines are competitive/ahead on latency-bound single-statement ops — the contrast SQLite's zero-latency reads hid. **100k tier SHIPPED across all three engines** (#1043), including an ANALYZE-after-seed fix so the m2m pivot eager-load isn't seq-scanned on a stats-less table. §14 #11 is COMPLETE — SQLite + Postgres + MySQL × 1k/10k/100k, all parity-gated. Methodology: `docs/plans/2026-06-11-comparative-orm-benchmark-suite.md`.
12. ~~`db:show` / `db:table` CLI introspection commands~~ — **SHIPPED post-audit**: native-engine inspection (`inspectDatabase`/`inspectTable` in `@rudderjs/database` + orm `db-inspect` command; `--counts`/`--views`/`--json`; prisma/drizzle pointed at their studios).
13. Studio/GUI story — likely "integrate, don't build" (Telescope already records queries; an admin data browser is a separate product call).
14. Set operators intersect/except — low demand, log only.
15. Tree entities (closure table) — niche; revisit on demand.

**Explicit non-goals (by design, document don't build):** identity map/UoW (we're deliberately Active Record), Mongo support, edge-first runtime for the native engine (drizzle adapter covers edge targets).
