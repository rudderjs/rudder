# Comparative ORM benchmark suite (§14 #11)

**Filed:** 2026-06-11
**Status:** ✅ SHIPPED (2026-06-11) — `benchmarks/` workspace package; SQLite 1k/10k committed in `benchmarks/results/REPORT.md`. **Postgres follow-up shipped (2026-06-11):** the suite is now engine-parameterized (`BENCH_ENGINE`), with Postgres 1k/10k committed in `benchmarks/results/REPORT-postgres.md` (rudder + Drizzle on porsager, Prisma on node-pg, parity-gated). The only remaining row is 100k numbers on both engines (dedicated-machine heavy run).
**Scope (decided 2026-06-11):** competitors = **Prisma + Drizzle only**; databases = **SQLite + Postgres** (Postgres shipped as the follow-up); location = **in-monorepo `benchmarks/` workspace package**; this document is the methodology signed off before building.

## Context

The DB/ORM comparison doc (`claude-notes/db-orm-comparison.md`) makes the framework's only **unverified public claim**:

> §Performance — "**No published comparative bench yet** — that's deliverable Q3 (`~/perf-bench/rudderjs`, prod builds only)."
> §14 #11 (Tier 3) — "Published comparative benchmark suite (Q3 deliverable)."

Everything else in the §14 work-queue (Tiers 1–2 and most of Tier 3) is shipped. This is the last substantive item that backs a positioning claim. Until it exists, the banked wins in §Performance ("toJSON fast-path −39%, batched polymorphic eager-load 14.9×, shared positional bindings, model-layer WHERE-IN batching") are internal before/after numbers with **no external reference point**, so we can't honestly say "faster than X" anywhere.

**What this is NOT** (already done — don't rebuild):
- **Framework-level bench** (`scripts/perf-bench*.sh`, results 2026-05-15): RudderJS vs Next/Nuxt/SvelteKit — cold boot, first request, build time, bundle size, RPS. That's the *meta-framework* story.
- **HTTP workload bench** (`playground/bench/realistic.mjs`, 2026-06-10): RudderJS-native vs the Prisma twin, route-level latency through the full server stack.

**What's missing and what this plan delivers:** a **query-layer** benchmark that puts RudderJS's native engine head-to-head with Prisma and Drizzle on an *identical* schema + dataset + SQLite database, measuring the ORM/query cost directly — no HTTP, no Vike, no server adapter in the path. This is the apples-to-apples number a Drizzle or Prisma user actually wants before switching.

## Why query-layer and not through HTTP

The existing `realistic.mjs` measures RudderJS-native vs RudderJS-on-Prisma *through the server*. That's a fair internal comparison but a poor *competitive* one: routing, middleware, SSR, and JSON serialization dominate and dilute the ORM signal, and Drizzle/Prisma have no "RudderJS server" to run inside. To compare the **ORMs themselves**, each contender must be driven directly in a plain Node script against the same `better-sqlite3` file, timing only `insert/find/query/hydrate`. That isolates the thing we're actually claiming wins on.

## Grounding (verified 2026-06-11)

- **Native engine entry:** `@rudderjs/database` (v1.5.1) — `Migration`, `Schema`, `NativeAdapter` on the main entry; full surface on `@rudderjs/database/native`. Model layer in `@rudderjs/orm` (v1.20.0).
- **Competitor deps already in the workspace tree** — no heavy new installs: `@prisma/client@7.4.2` (+ `@prisma/adapter-better-sqlite3@7.4.2`), `drizzle-orm@0.45.2`, `better-sqlite3@12.6.2`. The bench package declares them as its own devDeps; pnpm dedupes.
- **Workspace globs** (`pnpm-workspace.yaml`) currently: `packages/*`, `tests/*`, `create-rudder-app`, `create-rudder`, `playground`, `playground-prisma`, `playground-web`. Adding the suite needs a new `benchmarks` entry (or `benchmarks/*` if we ever split per-DB).
- **No `mitata`/`tinybench` in the tree** — pick one (see Harness §). Everything else is reusable from `realistic.mjs`'s percentile/timing helpers.

---

## Phase 0 — Workspace scaffold

**Goal:** a private, never-published `benchmarks/` package that other contributors can clone-and-run.

1. New dir `benchmarks/` with `package.json`:
   - `"name": "@rudderjs/benchmarks"`, `"private": true`, `"version": "0.0.0"`, **no** `publishConfig`, **no** changeset coverage (it's `chore:`, never published — see CLAUDE.md Publishing table).
   - devDeps: `@rudderjs/database` + `@rudderjs/orm` (`workspace:*`), `@prisma/client`, `@prisma/adapter-better-sqlite3`, `prisma`, `drizzle-orm`, `drizzle-kit`, `better-sqlite3`, and the chosen runner (`mitata`).
   - scripts: `bench` (run all), `bench:setup` (build DBs + generate Prisma client + push Drizzle schema), `bench:report` (regenerate the markdown table from the latest results JSON).
2. Add `benchmarks` to `pnpm-workspace.yaml` globs; `pnpm install` from root.
3. `benchmarks/README.md` — how to run, how numbers are produced, the fairness rules (below), and a **"these are reproducible, here's the exact command"** block so the published table is auditable.
4. `.gitignore` the generated SQLite files + `node_modules`, **commit** the results JSON + generated markdown (the published artifact).

**Turbo:** add `benchmarks` to `turbo.json` only as a `bench` task with `"cache": false` (timing must never be cached); it should depend on `^build` so it runs against compiled `dist/`, never `tsx` source (CLAUDE.md: prod builds only).

## Phase 1 — Shared fixture (identical schema + data for all three)

**Goal:** one canonical schema and seed so the only variable is the ORM.

1. **Schema** — a small relational shape that exercises the operations that matter, mirrored exactly in each ORM's native declaration form:
   - `users` (id, name, email, created_at)
   - `posts` (id, user_id → users, title, body, view_count, published, created_at)
   - `comments` (id, post_id → posts, user_id → users, body, created_at)
   - `tags` + `post_tags` pivot (many-to-many — exercises the eager-load/WHERE-IN batching claim)
   - Each ORM gets its own schema artifact, **hand-verified to produce byte-identical DDL where possible** (same column types, same indexes on FKs): RudderJS → a `Migration` in `benchmarks/src/rudder/schema.ts`; Drizzle → `schema.ts` + `drizzle-kit push`; Prisma → `schema.prisma` + `prisma db push`.
2. **Seed** — a deterministic generator (fixed seed, **no `Math.random()`** — the CLAUDE.md/runtime constraint; use a tiny seeded PRNG) producing a fixed dataset at three sizes: **1k / 10k / 100k** users with proportional posts/comments/tags. One seed module writes the rows via raw `better-sqlite3` (ORM-neutral) so no contender gets a seeding-path advantage; each ORM opens the same pre-seeded file read-only for read benches and a fresh copy for write benches.
3. **DB lifecycle:** `bench:setup` builds the seeded SQLite files once into `benchmarks/.dbs/seed-{1k,10k,100k}.sqlite`; each write-bench run copies the file to a temp scratch path so runs are independent and repeatable.

## Phase 2 — The operation matrix

Each operation is implemented three times (rudder / drizzle / prisma) behind a uniform `{ name, setup, run }` interface so the runner is contender-agnostic. Operations chosen to *directly* exercise the banked claims plus the bread-and-butter paths:

| # | Operation | Why it's in the suite |
|---|---|---|
| 1 | `insert` single row × N | write floor; binding overhead |
| 2 | `insert` bulk (1k rows, one statement where supported) | bulk-write path |
| 3 | `findByPk` hot loop | hydration + dispatch cost per row |
| 4 | `where(...).limit(50)` list | filter + small result hydration |
| 5 | `where(...).get()` large (1k rows) | **hydration at scale** — TypeORM's documented weak point; our toJSON/hydration fast-path |
| 6 | eager-load `users.with(posts.with(comments))` | **N+1 vs batched WHERE-IN** — the 14.9× polymorphic/batch claim's cousin |
| 7 | many-to-many eager-load `posts.with(tags)` via pivot | pivot batching |
| 8 | aggregate (`count` + `withCount('posts')`) | aggregate path |
| 9 | update + `increment('view_count')` | atomic counter primitive |
| 10 | `toJSON()` / serialize 1k hydrated rows | the **−39% toJSON fast-path** claim, measured against raw competitor serialization |

**Fairness rules (write these into the README and enforce in code review):**
- Same SQLite file, same `better-sqlite3` build, same pragmas (`journal_mode`, `synchronous`) for every contender — set identically in each setup.
- Prepared-statement reuse allowed for all or none — match each ORM's *idiomatic* path (Drizzle prepared, Prisma client default, RudderJS QueryBuilder default). Document the choice per op.
- Measure **steady state**: warm-up iterations discarded (reuse `realistic.mjs`'s warm-up pattern), then timed batches.
- **Result parity assertion** — before timing, each op asserts all three contenders return the same row count / same first-row id set. A bench that measures different work is worse than no bench. This gate runs in `bench:setup` and fails loudly.
- Prod builds only — `@rudderjs/*` from `dist/`, never `tsx`.

## Phase 3 — Harness + runner

1. **Runner:** `mitata` (preferred — nanosecond resolution, built-in warmup/GC control, stable stats, tiny) over hand-rolled `performance.now()` loops. Fall back to `tinybench` if `mitata`'s output format is awkward to serialize. Decision recorded once chosen.
   - Rationale: the operation set is micro-to-small; we want distribution stats (p50/p99 + stddev), not just a mean, and a runner that controls GC between samples. `realistic.mjs`'s percentile helpers stay for any custom timing we still hand-roll.
2. **Output:** `benchmarks/results/sqlite-<size>.json` with a `provenance` block (node version, OS, cpu model, ORM versions, better-sqlite3 version, date — **date passed in via env/CLI, not `Date.now()` in-script**, per the runtime constraint) + per-op `{ contender, p50, p99, stddev, opsPerSec }`.
3. **Report:** `bench:report` renders results JSON → a markdown table (`benchmarks/results/REPORT.md`) with contender columns and a relative-speedup column (×vs slowest). This is the committed, publishable artifact §Performance will link to.
4. **CI (opt-in, non-gating):** a manually-triggered workflow (`workflow_dispatch`) that runs `bench:setup && bench` on the 1k+10k sizes and uploads the JSON — **never on the PR critical path** (timing on shared CI runners is noise). 100k stays local/dedicated-runner only. Document that headline published numbers come from a pinned local machine, not CI.

## Phase 4 — Publish the numbers back into the docs

1. Replace the §Performance "No published comparative bench yet" line in `claude-notes/db-orm-comparison.md` with a link to `benchmarks/results/REPORT.md` + the headline takeaways (honestly — where we win *and* where we don't; a bench that only shows wins reads as marketing and kills credibility).
2. Update §14 #11 status: `Published comparative benchmark suite` → **SHIPPED**, with the methodology pointer to this doc.
3. Update `ROADMAP.md` Post-1.0 table with a row for the suite.
4. Optional: a short `docs/guide/` or blog-style writeup is a **separate** follow-up, not this plan.

---

## Risks / open questions

- **Result-parity is the credibility linchpin.** If op #6's eager-load returns a different graph shape across ORMs, the number is meaningless. The parity assertion gate (Phase 2) is non-negotiable; budget real time for it.
- **Idiomatic-vs-fastest tension.** Prisma has no true bulk-insert; forcing `createMany` vs looping changes its #2 number 10×. Rule: each contender runs its *documented idiomatic* path for the operation, and the README states exactly what each did. We are not building a strawman.
- **SQLite ≠ production.** SQLite removes network + connection-pool variance (good for signal) but under-represents Prisma's query-engine overhead, which is more visible on Postgres over a socket. **Call this out explicitly in the report**, and frame Postgres as the committed follow-up so the SQLite numbers aren't over-read.
- **mitata not yet in tree** — one new devDep in a private package; acceptable. Confirm it has no native build step that complicates CI.
- **Maintenance drift.** Pinned competitor versions go stale. Record exact versions in `provenance`; re-running is a `bench:setup && bench` away. Not a CI gate, so drift never breaks `main`.

## Definition of done

- `benchmarks/` package runs `pnpm --filter @rudderjs/benchmarks bench` green on a clean clone after `bench:setup`. ✅
- `benchmarks/results/REPORT.md` committed with real SQLite 1k/10k numbers for rudder/drizzle/prisma across all 10 ops, parity-asserted. ✅ (100k = heavy follow-up)
- **Postgres:** `BENCH_ENGINE=postgres` engine path + `benchmarks/results/REPORT-postgres.md` committed with real Postgres 1k/10k numbers, parity-asserted; rudder + Drizzle on porsager, Prisma on node-pg. ✅
- §Performance + §14 #11 updated to point at it; ROADMAP row added. ✅
- No changeset (private package, `chore:`); CI bench workflow is `workflow_dispatch`-only and non-gating. ✅
