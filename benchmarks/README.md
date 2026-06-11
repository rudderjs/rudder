# @rudderjs/benchmarks

Comparative **query-layer** ORM benchmark suite — the RudderJS native engine head-to-head with **Prisma** and **Drizzle** on an *identical* schema, dataset, and SQLite database. Private, never published (`chore:`, no changeset).

It answers one question: **how much does the ORM/query layer itself cost?** Each contender is driven directly in a plain Node script against the same `better-sqlite3` file — no HTTP, no Vike, no server adapter in the path. That isolates the thing RudderJS actually claims wins on, unlike the through-the-server `playground/bench/realistic.mjs` (which routing/SSR/JSON dominate).

> This is §14 #11 ("Published comparative benchmark suite") of the [DB/ORM gap work-queue](../claude-notes/db-orm-comparison.md). Full methodology: [`docs/plans/2026-06-11-comparative-orm-benchmark-suite.md`](../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).

## Run it

```bash
# from repo root — packages must be built first (prod builds only, never tsx)
pnpm build

cd benchmarks
pnpm prisma:generate      # one-time: generate the Prisma client from prisma/schema.prisma
pnpm bench:setup          # build the seeded SQLite DBs (.dbs/seed-{1k,10k,100k}.sqlite)
pnpm bench:parity         # prove all three ORMs return identical results (the gate)
pnpm bench                # run 1k + 10k (add `100k` for the big one)
pnpm bench:report         # render results/REPORT.md
```

`pnpm bench 1k 10k 100k` runs every size. `100k` is local/dedicated-machine only (heavy). The published headline numbers in [`results/REPORT.md`](results/REPORT.md) come from a **pinned local machine**, not CI — timing on shared runners is noise.

Reproducible: same seed + same versions ⇒ same dataset ⇒ comparable numbers. The exact command is `pnpm bench:setup && pnpm bench && pnpm bench:report`; versions and machine are recorded in each `results/sqlite-<size>.json` `provenance` block.

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

1. **Identical DDL.** One raw-SQL schema (`src/schema.mjs`) is applied via `better-sqlite3`; each ORM only *maps* onto the existing tables (Prisma `@@map`/`@map`, Drizzle `sqliteTable`, RudderJS `static table`). No ORM owns the DDL, so none gets a schema-shape edge. `created_at` is `TEXT` everywhere (datetime types serialize differently per ORM, which would diverge the stored bytes).
2. **Identical data.** A deterministic seeded PRNG (`src/prng.mjs`, no `Math.random()`) writes the rows via raw `better-sqlite3` — ORM-neutral, so no contender gets a seeding-path advantage. Read benches open the untouched seed file; write benches copy it to a fresh scratch first.
3. **Identical pragmas.** Every contender sets `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=OFF` (`src/schema.mjs` `PRAGMAS`).
4. **Idiomatic path per ORM, documented — no strawman.** Each op uses each ORM's *documented* path, not a hand-tuned fastest:
   - **Insert bulk:** Drizzle `db.insert().values(array)` (one multi-row INSERT — verified), Prisma `createMany`, RudderJS `query().insertMany()`. **No explicit `.prepare()` reuse** layered on any of them — RudderJS's larger lead here reflects its engine reusing prepared statements internally, which Drizzle/Prisma recompile per call. That's an engine difference, not a thumb on the scale.
   - **findByPk / list / get:** each ORM's default (non-prepared) select.
   - **increment:** each ORM's atomic `col = col + 1` returning the new value.
5. **Result-parity gate.** `src/parity.mjs` asserts all three contenders return the same normalized value for every op before any timing. A bench that measures different work is worse than no bench. It runs inside every `pnpm bench` and standalone via `pnpm bench:parity`.
6. **Steady state.** One warm call before timing; [mitata](https://github.com/evanwashere/mitata) handles warm-up batches + GC control and reports mean per-call wall time.
7. **Prod builds only.** `@rudderjs/*` resolve to compiled `dist/` (the `bench` Turbo task `dependsOn: ^build`), never `tsx` source.

## Caveats

- **SQLite ≠ production.** SQLite removes network + pool variance (good for signal) but under-represents Prisma's query-engine overhead, which shows more on Postgres over a socket. Read these as query-layer/hydration numbers. **Postgres is the committed follow-up.**
- **`toJSON` content differs by design** (Prisma camelCase vs snake_case keys), so parity for op #10 compares the row count, not the serialized string — the *work* (serialize 1k hydrated rows) is equivalent.
- **Version drift.** Pinned competitor versions go stale; exact versions live in each result's `provenance`. Re-running is one `pnpm bench:setup && pnpm bench` away. Not a CI gate, so drift never breaks `main`.

## Layout

```
benchmarks/
├── prisma/schema.prisma        # Prisma's view of the shared schema (maps onto existing tables)
├── src/
│   ├── schema.mjs              # single-source DDL + pragmas + dataset spec
│   ├── prng.mjs                # deterministic seeded PRNG
│   ├── seed.mjs                # ORM-neutral seeder (raw better-sqlite3)
│   ├── fixtures.mjs            # deterministic per-size op parameters
│   ├── scratch.mjs             # fresh DB copies for write benches
│   ├── setup.mjs               # bench:setup — builds the seeded DBs
│   ├── parity.mjs              # the result-parity gate
│   ├── run.mjs                 # the mitata runner → results/sqlite-<size>.json
│   ├── report.mjs              # results JSON → results/REPORT.md
│   └── contenders/
│       ├── index.mjs           # op matrix + contender registry
│       ├── rudder.mjs          # RudderJS native engine
│       ├── drizzle.mjs         # Drizzle ORM
│       └── prisma.mjs          # Prisma
└── results/                    # committed artifact: sqlite-<size>.json + REPORT.md
```
