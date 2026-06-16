# Realistic-workload HTTP bench

Through-the-server performance baseline for RudderJS. It boots the **playground**
in prod, warms it, then hits a weighted mix of real routes and reports per-route
and mixed-workload throughput + latency percentiles.

It answers a different question than `benchmarks/` (the comparative ORM suite):

| Suite | Measures | Path |
|---|---|---|
| `benchmarks/` | the **query layer** in isolation (native vs Prisma vs Drizzle) | no HTTP, no SSR |
| `playground/bench/` (this) | the **whole request path** | router + normalization + middleware + handler + SSR |

Because it goes through the server, routing / middleware / SSR are in the numbers.
That makes it the right tool for catching a framework-level latency or throughput
regression, and the wrong tool for isolating the ORM (use `benchmarks/` for that).

## Run it

```bash
# from repo root — prod builds only (never tsx)
pnpm build
pnpm --filter=rudderjs-playground run build

node playground/bench/realistic.mjs            # run + print
node playground/bench/realistic.mjs --save     # also commit results/baseline.json + REPORT.md
```

The DB must be seeded once (`cd playground && pnpm rudder migrate && pnpm rudder db:seed`).
The spawned server runs with `RUDDER_BENCH=1`, which makes the playground skip its
per-minute `RateLimit` middleware — otherwise every request past the cap returns a
429 and the bench would measure rate-limiter rejection instead of real work.

## What it does

1. **Warm-up** — drives the first request so the lazy boot + Vike SSR prewarm settle
   and subsequent timings are steady-state.
2. **Per-route, sequential (c=1)** — isolates each route's cost with no contention.
   The route mix climbs from a floor JSON route up through DB reads and SSR views so
   the framework overhead is legible apart from the database and the renderer:

   | Route | Exercises |
   |---|---|
   | `GET /api/health` | floor — JSON, no framework work |
   | `GET /api/config` | framework JSON (config read) |
   | `GET /api/users` | JSON + DB list (cached) |
   | `GET /api/users/:id` | JSON + DB find (id resolved at runtime, never 404s) |
   | `GET /` , `GET /about` | SSR view, no DB |
   | `GET /demos/todos` , `GET /demos/polymorphic` | SSR view + DB |
3. **Mixed weighted (c=8)** — all routes interleaved under concurrency, reporting
   overall throughput (req/s) and end-to-end p50/p95/p99, plus per-route percentiles
   under load.

## The baseline

`--save` writes [`results/baseline.json`](results/baseline.json) (machine-readable,
with provenance) and renders [`REPORT.md`](REPORT.md) (human-readable). Both are
committed so a performance change can be diffed against a known-good number.

The committed numbers come from a **pinned local machine**, not CI — timing on
shared runners is noise. Re-run `--save` on the same machine before and after a
change and compare the REPORT; treat cross-machine comparisons as directional only.

## Tunables (env)

| Var | Default | Meaning |
|---|---|---|
| `BENCH_PORT` | `3100` | server port |
| `BENCH_PER_ROUTE_N` | `200` | sequential requests per route (phase 1) |
| `BENCH_MIXED_N` | `5000` | total requests (phase 2) |
| `BENCH_CONCURRENCY` | `8` | concurrency for phase 2 |
| `BENCH_WARMUP` | `20` | warm-up requests |
| `BENCH_READY_TIMEOUT` | `30000` | ms to wait for server ready |
| `BENCH_SAVE` | unset | set `1` (or pass `--save`) to persist results |
