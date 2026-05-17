# Realistic-workload bench — find the real hot spots

**Status:** scaffold, 2026-05-17. Tool, not a perf PR. Goal is a measurement that informs the *next* round of perf work — convert "what should we audit next" from a guess into a number.

---

## Why this exists

Every perf PR shipped this week has been driven by a synthetic microbench: cold-boot timing (`bench-cold-boot.mjs`), per-row ORM hydration (`bench-hydrate.mjs`), per-middleware timing harness, single-endpoint curl loops. Those numbers are precise but narrow — they tell us how fast one operation is, not where time goes in production-shaped traffic.

A realistic-workload bench hits a representative route mix at meaningful concurrency and surfaces:

- Which **routes** are slow in absolute terms (which view? which DB query?)
- Whether the bottleneck is route-handler work, view rendering, the ORM, or framework overhead
- Whether the perf shape under load matches the shape under sequential bench (uncovers contention)

Output is **inputs to the next perf decision** — not a PR by itself.

---

## Subject

`playground/` in **prod mode** (`node dist/server/index.mjs`), 22 framework providers booted. Sqlite via `@prisma/adapter-better-sqlite3`. Local machine, warm FS cache. The playground is the closest thing to a real RudderJS app — auth, sessions, middleware groups, view rendering, DB, the whole stack.

---

## Workload shape

Eight routes covering the cross-product of {API, view} × {no-DB, DB} × {auth-checked, anonymous}:

| Route | Class | Weight | Notes |
|---|---|---:|---|
| `/api/health` | JSON, floor | 15% | cheapest path — no DB, no view, no auth |
| `/api/config` | JSON, framework | 15% | reads `config<T>()` — measures DI/config-cache overhead |
| `/api/users` | JSON, DB list | 12% | `User.all()` — bulk hydration (now post-Lever-B) |
| `/api/users/:id` | JSON, DB find | 13% | single-row `User.find()` |
| `/` | view, no-DB | 15% | welcome page (React SSR, no DB read) |
| `/about` | view, no-DB | 10% | simple SSR view |
| `/demos/todos` | view, DB | 10% | SSR + ORM read |
| `/demos/polymorphic` | view, complex DB | 10% | SSR + morph relations |

Weights approximate a content-driven app: more API + view reads than DB-heavy paths. Tunable in the bench script.

Per-phase request counts:

- **Per-route sequential** (Phase 1): 200 requests per route, concurrency=1 — establishes p50/p95 floor per route in isolation
- **Mixed weighted** (Phase 2): 5000 total requests at concurrency=8 — surfaces contention + measures throughput under load

Warm-up: 20 requests against `/api/health` before any timing capture (clears first-request lazy boot, JIT, FS cache).

---

## Tool

Single self-contained Node script at `playground/bench/realistic.mjs`:

1. Spawns `node dist/server/index.mjs` as a child process
2. Waits for the `[RudderJS] ready` log line on stdout (or a 30 s timeout)
3. Runs warm-up
4. Runs Phase 1 (per-route)
5. Runs Phase 2 (mixed weighted)
6. Kills the child process
7. Prints a per-route table + mixed-workload summary

No external dependencies — vanilla Node `fetch` and `performance.now()`. ~150 lines.

Runs from the repo root:

```bash
pnpm build                                 # build all framework packages
cd playground && pnpm exec prisma generate # one-time
pnpm --filter=playground run build         # build playground prod bundle
node playground/bench/realistic.mjs        # run the bench
```

---

## Expected outputs

```
Per-route (sequential, 200 reqs each)
─────────────────────────────────────────────────────────────────────────
Route                          p50         p95         p99         floor
GET /api/health                X.XXms      X.XXms      X.XXms      ★
GET /api/config                X.XXms      X.XXms      X.XXms
GET /api/users                 X.XXms      X.XXms      X.XXms
...

Mixed weighted (5000 reqs, c=8)
─────────────────────────────────────────────────────────────────────────
Total throughput:              XXX req/s
End-to-end latency:            p50=X.XXms  p95=X.XXms  p99=X.XXms
Per-route latency (under load): ...
```

The "floor" route is `/api/health` — it sets the framework's irreducible per-request overhead. Every other route's overhead-over-floor is the budget the actual handler work consumed.

---

## What this bench is NOT

- Not a comparative bench against Next.js / Nuxt / Astro — those would need matched scaffolding on each framework. Out of scope.
- Not an SLA / production load test — concurrency=8 is "useful signal," not "production-realistic peak."
- Not a memory / GC bench — different axis, would need long-running RSS sampling.
- Not a database-tuning bench — DB shape is whatever `prisma db push` + the playground's seed gave us.

---

## Decision after running

The bench produces a table. The user decides:

1. **Top route is well above the floor → drill into it.** (E.g. if `/demos/polymorphic` is 20× the floor, audit the polymorphic relation path.)
2. **All routes hover near the floor → throughput is the next axis.** Bench at higher concurrency / cluster mode (revisits the killed cluster spike with realistic workload).
3. **Floor itself is high → server-hono / Vike / hono-node-server is the bottleneck.** Already audited as outside-our-stack in `ssr-rps-gap-outside-vike`, but realistic workload could surface a different facet.
4. **No obvious hot spot → perf is at floor.** Park further perf work, redirect.

---

## Reusable artifacts

`playground/bench/realistic.mjs` is committed and re-runnable. The plan doc captures the methodology so the bench can be re-run before any future architectural perf change to measure impact (and after, to confirm the win).
