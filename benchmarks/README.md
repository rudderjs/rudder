# @rudderjs/benchmarks

Comparative **query-layer** ORM benchmark suite — the RudderJS native engine head-to-head with **Prisma** and **Drizzle** on an *identical* schema and dataset, on **three engines: SQLite, Postgres and MySQL**. Private, never published (`chore:`, no changeset).

It answers one question: **how much does the ORM/query layer itself cost?** Each contender is driven directly in a plain Node script against the same database — no HTTP, no Vike, no server adapter in the path. That isolates the thing RudderJS actually claims wins on, unlike the through-the-server `playground/bench/realistic.mjs` (which routing/SSR/JSON dominate).

The engine is chosen at launch with `BENCH_ENGINE` (default `sqlite`); the `bench:pg:*` / `bench:mysql:*` scripts set it for you. SQLite removes network + pool variance (pure query-layer/hydration signal); **Postgres and MySQL over a local socket** add a real round-trip, which is exactly where a query engine's per-statement cost shows — the reports together tell the full story.

> This is §14 #11 ("Published comparative benchmark suite") of the [DB/ORM gap work-queue](../claude-notes/db-orm-comparison.md). Full methodology: [`docs/plans/2026-06-11-comparative-orm-benchmark-suite.md`](../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).

## Run it

```bash
# from repo root — packages must be built first (prod builds only, never tsx)
pnpm build
cd benchmarks

# ── SQLite (default engine) ───────────────────────────────────────────────
pnpm prisma:generate      # one-time: generate the SQLite Prisma client
pnpm bench:setup          # build the seeded SQLite DBs (.dbs/seed-{1k,10k,100k}.sqlite)
pnpm bench:parity         # prove all three ORMs return identical results (the gate)
pnpm bench                # run 1k + 10k (add `100k` for the big one)
pnpm bench:report         # render results/REPORT.md

# ── Postgres (needs a running server; set BENCH_PG_URL) ────────────────────
pnpm prisma:generate:pg   # one-time: generate the Postgres Prisma client
pnpm bench:pg:setup        # create + seed rudder_bench_{1k,10k} databases
pnpm bench:pg:parity       # parity gate on Postgres
pnpm bench:pg              # run 1k + 10k
pnpm bench:pg:report       # render results/REPORT-postgres.md

# ── MySQL (needs a running server; set BENCH_MYSQL_URL) ────────────────────
pnpm prisma:generate:mysql # one-time: generate the MySQL Prisma client
pnpm bench:mysql:setup     # create + seed rudder_bench_{1k,10k} databases
pnpm bench:mysql:parity    # parity gate on MySQL
pnpm bench:mysql           # run 1k + 10k
pnpm bench:mysql:report    # render results/REPORT-mysql.md
```

`pnpm bench 1k 10k 100k` runs every size. `100k` is local/dedicated-machine only (heavy). The published headline numbers in [`results/REPORT.md`](results/REPORT.md) (SQLite), [`results/REPORT-postgres.md`](results/REPORT-postgres.md) and [`results/REPORT-mysql.md`](results/REPORT-mysql.md) come from a **pinned local machine**, not CI — timing on shared runners is noise.

**Postgres server.** `BENCH_PG_URL` is the base URL — host/port/user, no database (the suite owns the `rudder_bench_<size>` names). Default `postgres://localhost:5433`. Any local Postgres works; the framework dev machine uses a self-contained Postgres.app cluster on port 5433 (see the `bench-postgres-local-install` note). `bench:pg:setup` creates one database per size; write-bench scratch is a `CREATE DATABASE … TEMPLATE` clone (the Postgres analog of the SQLite file copy).

**MySQL server.** `BENCH_MYSQL_URL` is the base URL — host/port/user, no database. Default `mysql://root@127.0.0.1:3306`. Any local MySQL 8 works. `bench:mysql:setup` creates one database per size; MySQL has no `CREATE DATABASE … TEMPLATE`, so write-bench scratch recreates the tables (`CREATE TABLE … LIKE`) and bulk-copies rows (`INSERT … SELECT`) on the server — the MySQL analog of the file copy / TEMPLATE clone. **Auth note:** the `mariadb` driver Prisma rides on (and `mysql2`) need a user whose plugin they can speak — if Prisma fails to connect against a MySQL-8 `caching_sha2_password` account, point `BENCH_MYSQL_URL` at a `mysql_native_password` user (or `ALTER USER … IDENTIFIED WITH mysql_native_password`).

Reproducible: same seed + same versions ⇒ same dataset ⇒ comparable numbers. Versions, machine, and engine are recorded in each `results/<engine>-<size>.json` `provenance` block.

## What's measured

Ten operations (see `src/contenders/index.mjs`), each implemented three times behind a uniform interface and **result-parity asserted before timing**:

| # | Op | Exercises |
|---|---|---|
| 1 | insert single row | write floor / binding overhead |
| 2 | insert bulk (1k rows) | bulk-write path |
| 3 | findByPk (hot loop) | per-row hydration + dispatch |
| 4 | where + order + limit 50 | filter + small hydration |
| 5 | where get 1k rows | hydration at scale |
| 6 | eager-load posts (50 users) | batched WHERE-IN eager load |
| 7 | eager-load tags via pivot (200 posts) | m2m pivot batching |
| 8 | count + filtered count | aggregate path |
| 9 | increment view_count | atomic counter |
| 10 | serialize 1k hydrated rows | `toJSON` / serialization (rows hydrated once, only serialize is timed) |

## Fairness rules (enforced in code + review)

1. **Identical DDL.** One raw-SQL schema per engine (`src/schema.mjs` — `DDL` for SQLite, `PG_DDL` for Postgres, `MYSQL_DDL` for MySQL) is applied directly; each ORM only *maps* onto the existing tables (Prisma `@@map`/`@map`, Drizzle `sqliteTable`/`pgTable`/`mysqlTable`, RudderJS `static table`). No ORM owns the DDL, so none gets a schema-shape edge. The three engine schemas are the same shape mapped to native types (SQLite `INTEGER PK AUTOINCREMENT` ↔ Postgres `SERIAL` ↔ MySQL `INT AUTO_INCREMENT`; `INTEGER` 0/1 ↔ Postgres `BOOLEAN` ↔ MySQL `BOOLEAN`/`TINYINT(1)`); `created_at` is `TEXT` on all three (datetime types serialize differently per ORM, which would diverge the stored bytes).
2. **Identical data.** A deterministic seeded PRNG (`src/prng.mjs`, no `Math.random()`) writes the rows ORM-neutrally — raw `better-sqlite3` on SQLite, raw porsager bulk inserts on Postgres, raw `mysql2` bulk inserts on MySQL — so no contender gets a seeding-path advantage. The same PRNG stream + fan-out drives all three engines, so the datasets are equivalent. **The seeder runs `ANALYZE` after the bulk load on every engine** (SQLite `ANALYZE`, Postgres `ANALYZE`, MySQL `ANALYZE TABLE`): a cost-based planner querying never-analyzed statistics mis-plans — at 100k it seq-scans the 1.4M-row `post_tags` pivot for an indexed `post_id IN (…)` eager load instead of an index scan, which measures the planner's cold start, not the ORM. Real deployments always have stats; refreshing them keeps the comparison honest (it helps whichever contender the planner was mis-serving, not a fixed one). Read benches open the untouched seed DB; write benches get a fresh scratch first (file copy on SQLite, `CREATE DATABASE … TEMPLATE` clone on Postgres — which carries the stats — `CREATE TABLE … LIKE` + `INSERT … SELECT` on MySQL).
3. **Identical connection profile.** SQLite contenders set `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=OFF` (`src/schema.mjs` `PRAGMAS`). Postgres and MySQL each use one server with default settings, hit over a local socket by every contender.
4. **Idiomatic path per ORM, documented — no strawman.** Each op uses each ORM's *documented* path, not a hand-tuned fastest:
   - **Insert bulk:** Drizzle `db.insert().values(array)` (one multi-row INSERT — verified), Prisma `createMany`, RudderJS `query().insertMany()`. **No explicit `.prepare()` reuse** layered on any of them — RudderJS's larger lead here reflects its engine reusing prepared statements internally, which Drizzle/Prisma recompile per call. That's an engine difference, not a thumb on the scale.
   - **findByPk / list / get:** each ORM's default (non-prepared) select.
   - **increment:** each ORM's atomic `col = col + 1` returning the new value. RudderJS uses its idiomatic instance path (`find()` then `increment()`); on Postgres that's two socket round-trips vs a single `UPDATE … RETURNING` for the others — ~free on in-process SQLite, visible over a socket. **MySQL has no `UPDATE … RETURNING`**, so on MySQL Drizzle issues UPDATE-then-SELECT and Prisma does the equivalent internally — there *every* contender pays two statements, so the op is a closer read than on Postgres. Same result value everywhere (parity-gated), different round-trip count; called out in each server report.
   - **Postgres driver split:** rudder (native engine) and Drizzle (postgres-js) both run on **porsager `postgres`** — so that pair is one driver, pure query-layer. **Prisma runs on node-postgres** (`@prisma/adapter-pg`); Prisma has no porsager adapter, so this is the idiomatic Prisma path, not a handicap.
   - **MySQL driver split:** rudder (native engine) and Drizzle both run on **`mysql2`** — again one driver for that pair. **Prisma runs on the `mariadb` driver** (`@prisma/adapter-mariadb`); Prisma has no mysql2 adapter, so this is the idiomatic Prisma path, mirroring the Postgres split.
5. **Result-parity gate.** `src/parity.mjs` asserts all three contenders return the same normalized value for every op before any timing. A bench that measures different work is worse than no bench. It runs inside every `pnpm bench` and standalone via `pnpm bench:parity`.
6. **Steady state.** One warm call before timing; [mitata](https://github.com/evanwashere/mitata) handles warm-up batches + GC control and reports mean per-call wall time.
7. **Prod builds only.** `@rudderjs/*` resolve to compiled `dist/` (the `bench` Turbo task `dependsOn: ^build`), never `tsx` source.

## Caveats

- **Three engines, three pictures.** SQLite removes network + pool variance (clean query-layer/hydration signal) but under-represents Prisma's query-engine overhead. Postgres and MySQL over a socket add a ~80–120µs round-trip floor, so single-statement ops cluster there (Prisma's engine is competitive/ahead) while the ORMs separate on the query-layer-heavy ops (bulk, hydration, eager/pivot loading), where RudderJS leads. Read [`REPORT.md`](results/REPORT.md), [`REPORT-postgres.md`](results/REPORT-postgres.md) and [`REPORT-mysql.md`](results/REPORT-mysql.md) **together**. (100k rows on every engine remains the documented heavy follow-up.)
- **`toJSON` content differs by design** (Prisma camelCase vs snake_case keys), so parity for op #10 compares the row count, not the serialized string — the *work* (serialize 1k hydrated rows) is equivalent.
- **Version drift.** Pinned competitor versions go stale; exact versions live in each result's `provenance`. Re-running is one `pnpm bench:setup && pnpm bench` (or the `bench:pg:*` / `bench:mysql:*` equivalents) away. Not a CI gate, so drift never breaks `main`.

## Layout

```
benchmarks/
├── prisma/
│   ├── schema.prisma           # Prisma's SQLite view of the shared schema (maps onto existing tables)
│   ├── schema.postgres.prisma  # …its Postgres view (postgresql provider, separate client)
│   └── schema.mysql.prisma     # …and its MySQL view (mysql provider, separate client)
├── src/
│   ├── engine.mjs              # engine selection (BENCH_ENGINE) + Postgres/MySQL URL helpers
│   ├── pg.mjs                  # Postgres admin: CREATE/DROP/TEMPLATE-clone database
│   ├── mysql.mjs               # MySQL admin: CREATE/DROP database + LIKE+SELECT clone (same API as pg.mjs)
│   ├── schema.mjs              # single-source DDL (SQLite + Postgres + MySQL) + pragmas + dataset spec
│   ├── prng.mjs                # deterministic seeded PRNG
│   ├── seed.mjs                # ORM-neutral seeder (raw better-sqlite3 / porsager / mysql2)
│   ├── fixtures.mjs            # deterministic per-size op parameters
│   ├── scratch.mjs             # fresh DB copies for write benches (file copy / TEMPLATE clone / LIKE+SELECT)
│   ├── setup.mjs               # bench:setup — builds the seeded DBs; exports the connect target
│   ├── parity.mjs              # the result-parity gate
│   ├── run.mjs                 # the mitata runner → results/<engine>-<size>.json
│   ├── report.mjs              # results JSON → results/REPORT.md | REPORT-postgres.md | REPORT-mysql.md
│   └── contenders/
│       ├── index.mjs           # op matrix + contender registry
│       ├── rudder.mjs          # RudderJS native engine (sqlite + postgres + mysql driver)
│       ├── drizzle.mjs         # Drizzle ORM (better-sqlite3 + postgres-js + mysql2)
│       └── prisma.mjs          # Prisma (adapter-better-sqlite3 + adapter-pg + adapter-mariadb)
└── results/                    # committed artifact: <engine>-<size>.json + REPORT*.md
```
