# Data-layer test/coverage audit — 2026-06-05

> Quality-arc Q1 deliverable. Scope: `packages/{orm,database,orm-prisma,orm-drizzle}`.
> Companion to `claude-notes/db-orm-comparison.md` (§14 is the *feature* work queue; this doc
> is the *test-gap* work queue). Findings doc only — no tests written yet; each item below is
> a candidate test PR. CI/turbo changes are explicitly out of scope for this audit
> (documented where relevant, to be fixed in a separate PR).
>
> Method: three audit sweeps (live-suite dialect breadth, untested public surface,
> error-path guards), each claim then verified by direct grep/read of source + tests.
> Items the raw sweep flagged that turned out to be **already covered** or **non-existent
> API** are listed at the bottom so they don't get re-reported next audit.

Priority legend: **P0** = run-it-now hole (the #882 class: code path shippable-broken with
green CI) · **P1** = live-dialect gap on a write/correctness path · **P2** = untested public
surface / single-dialect live coverage · **P3** = cheap unit asserts (error paths).

---

## 1. Live-suite breadth (sqlite-only coverage where pg/mysql can differ)

Live tests gate on `PG_TEST_URL` / `MYSQL_TEST_URL`. Current live-gated inventory: 6 files in
`packages/database`, 12 in `packages/orm/src/native`, 5 in `packages/orm-drizzle`, **0 in
`packages/orm-prisma`**.

### P0-1 · CI never executes the orm-drizzle live suites

`.github/workflows/ci.yml:419,472` — both live jobs run
`turbo run test --filter @rudderjs/orm --filter @rudderjs/database`. The five live-gated
orm-drizzle suites (`mysql.test.ts`, `mysql-writes.test.ts`, `json-where.test.ts`,
`json-update.test.ts`, `read-write-split.test.ts`) **only ever run on a developer's machine
with the env vars set**. The post-#882 regression tests exist but are dead in CI — exactly
the green-by-skip failure mode #885 fixed for turbo env stripping.

*Fix (separate PR, not this audit): add `--filter @rudderjs/orm-drizzle` to both jobs.
Watch CI minutes — the drizzle live suites spin up their own schemas.*

### P0-2 · orm-prisma has zero live coverage of any kind

All 13 test files run sqlite (better-sqlite3 driver adapter or mocks). Never tested against
real pg/mysql: write paths, `$transaction` isolation-level mapping (PascalCase translation,
`packages/orm-prisma/src/index.ts` txn section), error pass-through shapes, type round-trips.
The Prisma adapter is the one most users bring to production first.

*Suggested: a `pg-live.test.ts` + `mysql-live.test.ts` pair mirroring
`packages/orm/src/native/drivers/postgres.test.ts` / `mysql.test.ts` (Model round-trip:
create/update/delete/upsert/increment/transaction/isolation). Needs a generated client per
dialect — likely a fixture schema + `prisma generate` in the suite setup, or a prebuilt
fixture client checked into test fixtures.*

### P1-3 · Drizzle has no live **Postgres write** round-trip

Live PG coverage on orm-drizzle is `json-where` / `json-update` / one read-path block in
`read-write-split.test.ts:349`. The mysql side got `mysql-writes.test.ts` after #882; PG has
no equivalent. Drizzle's PG write path (RETURNING handling, `restore`, `increment` merge-back,
`updateAll`, upsert `onConflict`) is sqlite+mysql tested only.

*Suggested: `packages/orm-drizzle/src/pg-writes.test.ts` cloned from `mysql-writes.test.ts`
(live half).*

### P1-4 · Transactions + isolation levels: Drizzle and Prisma sqlite-only

`packages/orm/src/native/transaction-isolation.test.ts` proves all 4 levels live on PG+MySQL
— **native engine only**. `orm-drizzle/src/transactions.test.ts` and
`orm-prisma/src/transactions.test.ts` run sqlite, where isolation levels *throw by design* —
so the pass-through seams (drizzle tx-config, prisma `$transaction({ isolationLevel })`) have
never run against a database that accepts them. Savepoint nesting on live pg/mysql:
implicit-at-best on both adapters.

### P1-5 · Lock wait-options on Drizzle never tested under real concurrency

`packages/database/src/native/lock-live.test.ts` (PG+MySQL, two-connection contention) covers
the **native** engine only. `orm-drizzle/src/lock.test.ts` asserts SQL shape on sqlite. The
drizzle `.for(strength, { skipLocked|noWait })` path — the queue-reservation pattern from
#899/#901 — has no live proof.

*Suggested: extend `lock-live.test.ts`'s scenario into an orm-drizzle live suite (gated on
both URLs).*

### P1-6 · Constraint-violation error shapes: zero assertions anywhere

No test in any of the four packages asserts what reaches user code on unique-violation,
FK-violation, NOT-NULL violation, or missing table — per dialect, per adapter. We don't map
driver errors today (pass-through is the contract), but nothing pins that contract: a driver
bump that changes error shape (mysql2 `ER_DUP_ENTRY` vs pg `23505` vs better-sqlite3
`SQLITE_CONSTRAINT_UNIQUE`) would ship silently. Queue retry/backoff and user `catch` code
depend on these shapes.

*Suggested: one `constraint-errors` live suite per engine asserting the error's
discriminating fields (code/errno/constraint name presence) on all three dialects.*

### P1-7 · Vector / pgvector: never exercised against pgvector

`orm/src/vector-cast.test.ts`, `orm-drizzle/src/vector.test.ts`, `orm-prisma/src/vector.test.ts`
are all sqlite-mocked. `whereVectorSimilarTo` / `selectVectorDistance` / vector cast
serialization + dimension validation have never run against a real `pgvector` extension.

*Suggested: PG-gated block (skip when `CREATE EXTENSION vector` unavailable) in each
adapter's vector suite.*

### P1-8 · Read/write split + sticky: no MySQL live coverage at all

`database/src/native/read-write-split.test.ts` has one live block — PG only.
`orm-drizzle/src/read-write-split.test.ts:349` — PG only. MySQL pool acquire/release
semantics and the sticky ALS join have never run live on mysql for either engine. Query
events (`target: 'read' | 'write'`) on drizzle: untested live.

### P2-9 · Eager loading (`with()`) sqlite-only everywhere

`orm/src/native/eager-with.test.ts` and `orm-drizzle/src/eager-with.test.ts` both use the
sqlite driver. The batched WHERE-IN model-layer strategy (large IN lists, mysql placeholder
limits, pg array behavior) has no live proof. whereHas *ops* variants (count comparisons,
OR-rooted — `orm/src/native/where-has-ops.test.ts`) are sqlite-only too; only plain nested
`whereHas` has live PG+MySQL round-trips (`nested-where-has.test.ts:412,477`).

### P2-10 · Single-dialect live coverage on native features

- CTEs: live **PG only** (`orm/src/native/cte.test.ts:72`) — MySQL 8 recursive CTE
  (`cte_max_recursion_depth`, syntax) unproven.
- `insertUsing`: live **MySQL only** (`orm/src/native/insert-using.test.ts:63`) — PG
  RETURNING-on-INSERT…SELECT unproven.
- Date helpers, json suites, isolation: already two-dialect ✅ (good reference shape).

### P2-11 · Schema/migration execution beyond CREATE is sqlite-only — ✅ CLOSED (Wave-3 P2-11 PR)

Closing this one surfaced (and fixed) THREE latent pg/mysql bugs — exactly the class of
failure the audit predicted: `migrate:fresh` read `sqlite_master` unconditionally (threw on
pg/mysql; `Migrator.dropAllTables()` now delegates to the new dialect-aware
`SchemaBuilder.dropAllTables()`/`allTables()` with FK-safe sweeps — pg `CASCADE`, mysql
`FOREIGN_KEY_CHECKS=0`); alter-time FKs (`constrained()`/`foreign()` in `Schema.table`)
were SILENTLY DROPPED on pg/mysql (now `ADD CONSTRAINT`, + `dropForeign` → pg
`DROP CONSTRAINT` / mysql `DROP FOREIGN KEY`); `dropIndex()` emitted the standalone form
MySQL rejects (now `DROP INDEX … ON <table>` there). New suites:
`schema/migrator-live.test.ts` (full lifecycle run→rollback→rollbackAll→fresh with an FK
pair, in an ISOLATED namespace — dedicated pg schema via `search_path`, dedicated mysql
database — because `dropAllTables` would otherwise sweep parallel test files' tables) and
`schema/alter-live.test.ts` (rename/add(+mysql AFTER)/index add+drop/FK add+enforce+drop/
drop column, verified via `inspectTable`). Compile-shape pins appended to
`ddl-compiler.test.ts`. Column-type `.change()` on pg/mysql remains a FEATURE gap (7.4b),
not a test gap.

Original finding: `migrator.test.ts`, `rebuild.test.ts`, `modifiers.test.ts`, `column-types.test.ts` are
sqlite-execution or compile-shape tests. Live pg/mysql DDL execution only happens incidentally
in the introspect suites (`pg-introspect.test.ts`, `mysql-introspect.test.ts`) — CREATE only.
ALTER TABLE paths (mysql `MODIFY` vs pg `ALTER COLUMN`, sqlite table-rebuild fallback vs real
ALTER) and the Migrator lifecycle (`latest/rollback/refresh/fresh` against pg/mysql, including
the migrations table itself) never run live.

### P2-12 · `cursorPaginate` has zero engine coverage; `chunk`/`lazy` zero live

`cursorPaginate` is tested only against an in-memory fake QB (`orm/src/index.test.ts:2487+`).
It has never produced SQL through any engine on any dialect (keyset `(a,b) > (?,?)`
decomposition is dialect-sensitive). `chunk`/`lazy` run on real native **sqlite**
(`orm/src/chunk-lazy.test.ts` uses `NativeAdapter`) but no pg/mysql, and have no
drizzle/prisma adapter tests at all.

### P2-13 · Type round-trips: thin beyond bool/int/string

`drivers/postgres.test.ts` + `drivers/mysql.test.ts` cover boolean (incl. TINY(1)), int,
string. Sparse-or-absent live round-trips: decimal precision (`decimal:N` cast vs pg string
return), bigint range, timestamp/TZ write-read symmetry (the bound-timestamp TZ fix has
compile tests, no live read-back on drizzle), JSON double-encode regression on drizzle PG.

---

## 2. Untested public surface — ✅ CLOSED (Wave-3 surface PR)

Shipped exactly as the closing note suggested: `orm/src/serialization-visibility.test.ts`
covers the visibility block; the `orWhere*` variants were appended to `date-helpers` /
`json-where` / `group-having` (inheriting their live gates). The two "low — note only"
rows stay notes by design; `cursorPaginate` engine-level closed earlier via P2-12 (#918).

Method: enumerate exports/public methods, grep all four packages' test files for call sites.
"Zero refs" = no test anywhere invokes it.

| Symbol | Defined at | Status | Minimal test |
|---|---|---|---|
| `makeVisible()` | `orm/src/index.ts:3717` | zero refs | hidden field appears in `toJSON()` after call |
| `setVisible()` | `orm/src/index.ts:3738` | zero refs | only listed keys serialize |
| `setHidden()` | `orm/src/index.ts:3747` | zero refs | listed keys dropped |
| `mergeVisible()` | `orm/src/index.ts:3756` | zero refs | union with static `visible` |
| `mergeHidden()` | `orm/src/index.ts:3766` | zero refs | union with static `hidden` |
| `makeHidden()` | `orm/src/index.ts:3728` | 1 ref | — (ok, could ride the same suite) |
| `orWhereDate()` | `database/src/native/query-builder.ts:223` | zero refs | OR-boolean date predicate SQL + round-trip |
| `orWhereTime()` | `database/src/native/query-builder.ts:233` | zero refs | same |
| `orWhereJsonDoesntContain()` | `database/src/native/query-builder.ts:310` | zero refs | OR-negated containment |
| `orHaving()` | `database/src/native/query-builder.ts:496` | zero refs | OR in HAVING group |
| `cursorPaginate()` engine-level | `orm/src/index.ts` (QB compose) | memory-QB only | see P2-12 |
| `whereRelationExists()` (direct) | `database/src/native/query-builder.ts:1064` | indirect only (via Model `whereHas`) | low — note only |
| `withAggregate()` (direct) | `database/src/native/query-builder.ts:1075` | indirect only (via `withCount/Sum/...`) | low — note only |

One-test-fixes-five: a single `serialization-visibility.test.ts` covers the first block; the
`orWhere*` variants can be appended to the existing `date-helpers` / `json-where` /
`group-having` suites (and inherit their live gates for free).

---

## 3. Error-path coverage (guards that no test asserts) — ✅ CLOSED (Wave-3 guard PR)

Shipped as one batch: new `orm/src/guard-errors.test.ts` (model-layer rows + the
deferred-connection QB throws), factory rows appended to `factory.test.ts`, relation rows
appended to `whereHas.test.ts` (the morphTo guard is one site reached by all three entry
forms — `whereHas`/`has`/`orWhereHas` each asserted). The "Drizzle whereHas throw-paths
parity" row was verified ALREADY COVERED (`orm-drizzle/src/where-column.test.ts:60,66`
asserts both `has()` count and `orWhereHas()` throws) — moved to §4 in spirit.

All confirmed by grep: the throw exists in source, no test matches its message. These are
cheap sqlite/unit tests — good batch-PR material.

**Model layer (`packages/orm/src/index.ts`):**

| Guard | Site | Note |
|---|---|---|
| `chunk(size)` non-positive-int | `index.ts:2021` | also rejects floats |
| `lazy(size)` non-positive-int | `index.ts:2039` | |
| `scope("x")` not defined | `index.ts:2196` | named-scope typo path |
| adapter lacks `upsert()` | `index.ts:2787` | capability forward-or-throw |
| `increment()` without PK | `index.ts:3208` | `refresh/delete/restore` variants ARE tested (`index.test.ts:1249,1419,1442`) — increment/decrement missed |
| `decrement()` without PK | `index.ts` (sibling of 3208) | |
| observer-cancel (`false` return) | `index.ts:2883–2949` | observer tests assert firing, not the cancellation throw/abort |

**Factory (`packages/orm/src/factory.ts`):** covered: wrong-kind + no-matching-relation
(`factory.test.ts:358–375`), no-factory-linked (`:188`). **Untested:**

| Guard | Site |
|---|---|
| `state("x")` not defined | `factory.ts:158` |
| `for(F, "rel")` relation not defined | `factory.ts:369` |
| `has(F, "rel")` relation not defined | `factory.ts:391` |
| `hasAttached(F, "rel")` relation not defined | `factory.ts:411` |
| ambiguous implicit resolution (2+ candidate relations) | `factory.ts:442` |

**Relations (`packages/orm/src/relations/where-has.ts`):**

| Guard | Site |
|---|---|
| morphTo + count comparison | `where-has.ts:128` |
| morphTo + OR-rooted predicate | `where-has.ts:135,160` |
| malformed nested path (empty segment, `'a..b'`) | `where-has.ts:290` |

**Misc:**

| Guard | Site |
|---|---|
| deferred-connection QB: method unavailable pre-open | `orm/src/deferred-connection-qb.ts:67,109` |
| Drizzle whereHas throw-paths parity | Prisma's `has()`/`orWhereHas()` throws are asserted (`orm-prisma/src/raw-expr.test.ts` area); verify the Drizzle counterparts (`orm-drizzle/src/index.ts:1251+` registry guards are tested, the predicate-shape throws aren't all) |

---

## 4. Verified non-findings (don't re-report)

Raw sweeps flagged these; direct verification says **already covered** or **not a test gap**:

- **Covered:** morphTo discriminator guards — empty `types`, duplicate alias
  (`morph.test.ts:370,386`); morph id/type-unset (`morph.test.ts:336,353,478`); cursor decode
  guards — malformed, non-object, missing order column, no-orderBy
  (`index.test.ts:2559–2600,2696`); DB-facade seam guards (`db-connection.test.ts:110–114`,
  `db-listen.test.ts:20`, `database/src/index.test.ts:83–93`); registry-bridge resolver guards;
  `whereBelongsTo` guards; through-relation unsaved-parent (`has-through.test.ts:169`);
  `saveQuietly`/`deleteQuietly`/`restoreQuietly`; Drizzle table-registry guards; `Blueprint`
  `.first()`/`.after()` modifiers (`modifiers.test.ts:71`); DB facade unit coverage is complete
  (`orm/src/native/db-facade.test.ts` exercises every facade method — the gap is live-dialect
  only, see P2 items).
- **Not API (feature gaps → `db-orm-comparison.md` §14, not test gaps):** `toggle()` (pivot),
  `touch()`, `sole()`, `firstOrNew()`, `virtualAs()/storedAs()/generatedAs()` — none exist in
  the codebase.

---

## 5. Suggested execution order

1. **Wave 0 (separate small PR):** CI filter fix for P0-1 (out of scope here, but it makes
   every drizzle live test below actually count).
2. **Wave 1 — live writes:** P0-2 prisma live pair, P1-3 drizzle pg-writes, P1-4 adapter
   isolation/txn live, P1-5 drizzle lock-live. (Each mirrors an existing native suite — low
   design cost.)
3. **Wave 2 — correctness pins:** P1-6 constraint-error shapes, P1-7 pgvector, P1-8 mysql
   split, P2-12 cursorPaginate-on-engine.
4. **Wave 3 — breadth batch:** P2-9/10/11/13 live extensions + §2 surface suite + §3
   error-path batch (one PR each, mostly sqlite, fast).

Reminder for anyone running counts locally: `rm -rf dist-test` first (stale compiled tests lie).
