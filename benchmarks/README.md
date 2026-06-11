# @rudderjs/benchmarks

Comparative **query-layer** ORM benchmark suite — the RudderJS native engine head-to-head with **Prisma** and **Drizzle** on an *identical* schema and dataset, on **two engines: SQLite and Postgres**. Private, never published (`chore:`, no changeset).

It answers one question: **how much does the ORM/query layer itself cost?** Each contender is driven directly in a plain Node script against the same database — no HTTP, no Vike, no server adapter in the path. That isolates the thing RudderJS actually claims wins on, unlike the through-the-server `playground/bench/realistic.mjs` (which routing/SSR/JSON dominate).

The engine is chosen at launch with `BENCH_ENGINE` (default `sqlite`); the `bench:pg:*` scripts set it for you. SQLite removes network + pool variance (pure query-layer/hydration signal); **Postgres over a local socket** adds a real round-trip, which is exactly where a query engine's per-statement cost shows — the two reports together tell the full story.

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
```

`pnpm bench 1k 10k 100k` runs every size. `100k` is local/dedicated-machine only (heavy). The published headline numbers in [`results/REPORT.md`](results/REPORT.md) (SQLite) and [`results/REPORT-postgres.md`](results/REPORT-postgres.md) come from a **pinned local machine**, not CI — timing on shared runners is noise.

**Postgres server.** `BENCH_PG_URL` is the base URL — host/port/user, no database (the suite owns the `rudder_bench_<size>` names). Default `postgres://localhost:5433`. Any local Postgres works; the framework dev machine uses a self-contained Postgres.app cluster on port 5433 (see the `bench-postgres-local-install` note). `bench:pg:setup` creates one database per size; write-bench scratch is a `CREATE DATABASE … TEMPLATE` clone (the Postgres analog of the SQLite file copy).

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

1. **Identical DDL.** One raw-SQL schema per engine (`src/schema.mjs` — `DDL` for SQLite, `PG_DDL` for Postgres) is applied directly; each ORM only *maps* onto the existing tables (Prisma `@@map`/`@map`, Drizzle `sqliteTable`/`pgTable`, RudderJS `static table`). No ORM owns the DDL, so none gets a schema-shape edge. The two engine schemas are the same shape mapped to native types (SQLite `INTEGER PK AUTOINCREMENT` ↔ Postgres `SERIAL`, `INTEGER` 0/1 ↔ `BOOLEAN`); `created_at` is `TEXT` on both (datetime types serialize differently per ORM, which would diverge the stored bytes).
2. **Identical data.** A deterministic seeded PRNG (`src/prng.mjs`, no `Math.random()`) writes the rows ORM-neutrally — raw `better-sqlite3` on SQLite, raw porsager bulk inserts on Postgres — so no contender gets a seeding-path advantage. The same PRNG stream + fan-out drives both engines, so the datasets are equivalent. Read benches open the untouched seed DB; write benches get a fresh scratch first (file copy on SQLite, `CREATE DATABASE … TEMPLATE` clone on Postgres).
3. **Identical connection profile.** SQLite contenders set `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=OFF` (`src/schema.mjs` `PRAGMAS`). Postgres uses one server with default settings, hit over a local socket by every contender.
4. **Idiomatic path per ORM, documented — no strawman.** Each op uses each ORM's *documented* path, not a hand-tuned fastest:
   - **Insert bulk:** Drizzle `db.insert().values(array)` (one multi-row INSERT — verified), Prisma `createMany`, RudderJS `query().insertMany()`. **No explicit `.prepare()` reuse** layered on any of them — RudderJS's larger lead here reflects its engine reusing prepared statements internally, which Drizzle/Prisma recompile per call. That's an engine difference, not a thumb on the scale.
   - **findByPk / list / get:** each ORM's default (non-prepared) select.
   - **increment:** each ORM's atomic `col = col + 1` returning the new value. RudderJS uses its idiomatic instance path (`find()` then `increment()`); on Postgres that's two socket round-trips vs a single `UPDATE … RETURNING` for the others — ~free on in-process SQLite, visible over a socket. Same result value (parity-gated), different round-trip count; called out in the Postgres report.
   - **Postgres driver split:** rudder (native engine) and Drizzle (postgres-js) both run on **porsager `postgres`** — so that pair is one driver, pure query-layer. **Prisma runs on node-postgres** (`@prisma/adapter-pg`); Prisma has no porsager adapter, so this is the idiomatic Prisma path, not a handicap.
5. **Result-parity gate.** `src/parity.mjs` asserts all three contenders return the same normalized value for every op before any timing. A bench that measures different work is worse than no bench. It runs inside every `pnpm bench` and standalone via `pnpm bench:parity`.
6. **Steady state.** One warm call before timing; [mitata](https://github.com/evanwashere/mitata) handles warm-up batches + GC control and reports mean per-call wall time.
7. **Prod builds only.** `@rudderjs/*` resolve to compiled `dist/` (the `bench` Turbo task `dependsOn: ^build`), never `tsx` source.

## Caveats

- **Two engines, two pictures.** SQLite removes network + pool variance (clean query-layer/hydration signal) but under-represents Prisma's query-engine overhead. Postgres over a socket adds a ~80–100µs round-trip floor, so single-statement ops cluster there (Prisma's engine is competitive/ahead) while the ORMs separate on the query-layer-heavy ops (bulk, hydration, eager/pivot loading), where RudderJS leads. Read [`REPORT.md`](results/REPORT.md) and [`REPORT-postgres.md`](results/REPORT-postgres.md) **together**. (100k rows on both engines remains the documented heavy follow-up.)
- **`toJSON` content differs by design** (Prisma camelCase vs snake_case keys), so parity for op #10 compares the row count, not the serialized string — the *work* (serialize 1k hydrated rows) is equivalent.
- **Version drift.** Pinned competitor versions go stale; exact versions live in each result's `provenance`. Re-running is one `pnpm bench:setup && pnpm bench` (or `pnpm bench:pg:setup && pnpm bench:pg`) away. Not a CI gate, so drift never breaks `main`.

## Layout

```
benchmarks/
├── prisma/
│   ├── schema.prisma           # Prisma's SQLite view of the shared schema (maps onto existing tables)
│   └── schema.postgres.prisma  # …and its Postgres view (postgresql provider, separate client)
├── src/
│   ├── engine.mjs              # engine selection (BENCH_ENGINE) + Postgres URL helpers
│   ├── pg.mjs                  # Postgres admin: CREATE/DROP/TEMPLATE-clone database
│   ├── schema.mjs              # single-source DDL (SQLite + Postgres) + pragmas + dataset spec
│   ├── prng.mjs                # deterministic seeded PRNG
│   ├── seed.mjs                # ORM-neutral seeder (raw better-sqlite3 / porsager)
│   ├── fixtures.mjs            # deterministic per-size op parameters
│   ├── scratch.mjs             # fresh DB copies for write benches (file copy / TEMPLATE clone)
│   ├── setup.mjs               # bench:setup — builds the seeded DBs; exports the connect target
│   ├── parity.mjs              # the result-parity gate
│   ├── run.mjs                 # the mitata runner → results/<engine>-<size>.json
│   ├── report.mjs              # results JSON → results/REPORT.md | REPORT-postgres.md
│   └── contenders/
│       ├── index.mjs           # op matrix + contender registry
│       ├── rudder.mjs          # RudderJS native engine (sqlite + postgres driver)
│       ├── drizzle.mjs         # Drizzle ORM (better-sqlite3 + postgres-js)
│       └── prisma.mjs          # Prisma (adapter-better-sqlite3 + adapter-pg)
└── results/                    # committed artifact: <engine>-<size>.json + REPORT*.md
```
