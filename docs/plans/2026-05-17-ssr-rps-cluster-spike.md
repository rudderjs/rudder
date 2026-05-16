# SSR RPS — server-hono per-phase instrumentation + cluster spike

> **Status: CLOSED, 2026-05-17.** Per-phase measurement confirmed our adapter is sub-millisecond. Cluster mode spike (W=4, W=8) showed ~0% RPS gain. The ceiling is per-connection RTT through Node HTTP + `@hono/node-server`, not CPU. The only remaining lever is replacing the HTTP transport, which is high-risk and not pursued here.

---

## Context

Direct follow-up to [`2026-05-16-vike-architectural-levers.md`](./2026-05-16-vike-architectural-levers.md) and the next-cycle playbook from memory `project_ssr_rps_gap_outside_vike.md`. The vike investigation proved <1% of SSR latency lives in `renderPageServer`. This investigation asks two questions in sequence:

1. **Where exactly does the other 99% live?** Instrument `@rudderjs/server-hono` end-to-end and measure per-phase percentiles under autocannon load.
2. **If the bottleneck is single-thread CPU, does cluster mode unlock N× RPS?** Spike `node:cluster` with W=4 and W=8 workers and re-bench.

---

## Phase 1 — Per-phase instrumentation in `@rudderjs/server-hono`

### Implementation

New module `packages/server-hono/src/perf-boundaries.ts` (~115 lines), gated behind `RUDDER_PERF_BOUNDARIES=1` env var — every public function is a no-op when unset, zero overhead in production.

11 ordered boundaries instrument the full fetch handler + route handler path:

```
HONO_FETCH_IN → APP_FETCH_IN → ROUTE_HANDLER_IN → NORM_DONE →
BODY_PARSE_DONE → MIDDLEWARE_DONE → HANDLER_DONE →
VIEW_TORESPONSE_IN → VIEW_TORESPONSE_OUT → APP_FETCH_OUT → HONO_FETCH_OUT
```

`AsyncLocalStorage<number>` propagates the perfId from the outer fetch handler into the route handler (which lives downstream of `app.fetch()` inside Hono's router). Output is dumped to `$RUDDER_PERF_OUT` (default `/tmp/rudder-perf.txt`) on SIGTERM/SIGINT/beforeExit as a per-phase percentile table.

Branch: `perf/ssr-rps-instrument` (uncommitted, local).

### Setup

Bench app: `~/perf-bench/rudderjs` (same fixture as the vike investigation). Welcome page route at `/` returning `view('welcome', {...})` — middleware chain includes rate-limit + session + auth on the web group. Built against the workspace-linked `@rudderjs/server-hono` via `pnpm.overrides`. Smoke test (3 curls) confirmed marks captured.

### Results — per-phase percentiles

**c=10, 30s, 22,558 samples, autocannon RPS = 752, wall-clock p50 = 12ms:**

| Phase | p50 | p99 |
|---|---:|---:|
| HONO_FETCH_IN → APP_FETCH_IN (URL rewrite check) | 0.003ms | 0.010ms |
| APP_FETCH_IN → ROUTE_HANDLER_IN (Hono routing) | 0.010ms | 0.045ms |
| ROUTE_HANDLER_IN → NORM_DONE (normalizeRequest/Response) | 0.013ms | 0.061ms |
| NORM_DONE → BODY_PARSE_DONE | 0.002ms | 0.009ms |
| BODY_PARSE_DONE → MIDDLEWARE_DONE (group MW: rate-limit + session + auth) | 0.009ms | 0.037ms |
| MIDDLEWARE_DONE → HANDLER_DONE (controller `view(...)` call) | 0.005ms | 0.014ms |
| HANDLER_DONE → VIEW_TORESPONSE_IN | 0.001ms | 0.005ms |
| **VIEW_TORESPONSE_IN → OUT (vike renderPage)** | **0.939ms** | 2.69ms |
| VIEW_TORESPONSE_OUT → APP_FETCH_OUT | 0.035ms | 0.108ms |
| APP_FETCH_OUT → HONO_FETCH_OUT (request log) | 0.049ms | 0.142ms |
| **END_TO_END (instrumented span)** | **1.071ms** | 3.07ms |

**c=100, 30s, 25,113 samples, autocannon RPS = 837, wall-clock p50 = 114ms:**

| Phase | p50 | p99 |
|---|---:|---:|
| HONO_FETCH_IN → APP_FETCH_IN | 0.002ms | 0.008ms |
| APP_FETCH_IN → ROUTE_HANDLER_IN | 0.008ms | 0.040ms |
| ROUTE_HANDLER_IN → NORM_DONE | 0.010ms | 0.051ms |
| NORM_DONE → BODY_PARSE_DONE | 0.002ms | 0.008ms |
| BODY_PARSE_DONE → MIDDLEWARE_DONE | 0.007ms | 0.034ms |
| MIDDLEWARE_DONE → HANDLER_DONE | 0.003ms | 0.012ms |
| HANDLER_DONE → VIEW_TORESPONSE_IN | 0.001ms | 0.004ms |
| **VIEW_TORESPONSE_IN → OUT** | **0.827ms** | 2.99ms |
| VIEW_TORESPONSE_OUT → APP_FETCH_OUT | 0.024ms | 0.097ms |
| APP_FETCH_OUT → HONO_FETCH_OUT | 0.034ms | 0.129ms |
| **END_TO_END (instrumented span)** | **0.919ms** | 3.26ms |

### Interpretation — Phase 1

| Concurrency | Wall-clock p50 | Instrumented span p50 | Gap outside our span |
|---:|---:|---:|---:|
| c=10  | 12ms  | 1.07ms | **~91%** |
| c=100 | 114ms | 0.92ms | **~99%** |

1. **Our adapter is not the bottleneck** at any concurrency. Combined non-vike adapter overhead is **~0.13ms p50** at c=100 — Hono routing, normalize, middleware chain, body parse, header merge, request log all sum to ~13% of measured time.
2. **Vike's `renderPage` is the only meaningfully sized phase** (~0.83ms p50) — matches the 2026-05-16 vike-internal measurement (0.80ms). Three independent in-vike optimization attempts already hit kill criteria at 0.13%-0.18% of latency.
3. **The 99% gap at c=100 is downstream of `HONO_FETCH_OUT`** — `@hono/node-server`'s stream piping, srvx response framing, and connection-level queueing. Not in code we wrote.

This validates the parked hypothesis from memory `project_ssr_rps_gap_outside_vike.md`: "Stream backpressure / response flush — the HTML stream from `renderToReadableStream` flows *after* the fetch handler returns."

---

## Phase 2 — Cluster mode spike

### Hypothesis

If single-thread Node is CPU-bound (the 95% in-process CPU observation at c=100 suggested it), N workers should give ~N× RPS. Cluster wrapper: 17 lines, `node:cluster` forks N workers sharing port 3000 via Node's round-robin scheduler.

### Setup

- `~/perf-bench/rudderjs/cluster.mjs` — fork N workers, each runs `dist/server/index.mjs`
- All measurements taken with a **clean** machine (70%+ idle CPU). An earlier W=4 run showed 0% gain, but investigation found a competing `vike dev` server consuming 117% CPU on the same machine — the bench was contaminated. After killing the competing process and re-baselining, system CPU was 14% user + 15% sys + 70% idle at rest.

### Results

| Setup | c=10 RPS | c=100 RPS | c=500 RPS | c=100 p50 latency |
|---|---:|---:|---:|---:|
| **Single-thread baseline** | 1079 | 1053 | 1066 | 92ms |
| **W=4 cluster** | 998 | 1092 | 1012 | 91ms |
| **W=8 cluster (all cores)** | — | 1092 | 1098 | 92ms |
| 4 parallel autocannon clients × c=25 vs single-thread | — | ~1068 | — | — |

System CPU during W=4 c=100 run: **68% idle**. During W=8 c=100: **65% idle**.

### Interpretation — Phase 2

1. **Cluster delivers ~0% RPS gain at any worker count or concurrency.** All numbers cluster around 1050-1100 RPS. The 4% spread is within run-to-run variance.
2. **CPU stayed 60-70% idle the whole time** under cluster mode — workers had cores available but never used them.
3. **The 4-parallel-client test rules out client-side cap.** Four autocannon clients × c=25 each (100 total connections) against a single-thread server delivered ~1068 RPS combined — identical to a single autocannon at c=100 (1053 RPS). So the ceiling is server-side regardless of how many clients drive it.
4. **The ceiling is per-connection RTT, not CPU.** Math holds across every run: `RPS ≈ connections / latency`, e.g. `100 / 0.092s = 1087`. Adding workers can't change per-connection round-trip time through Node HTTP parser + `@hono/node-server`'s socket plumbing + loopback packet handling.

### What this disproves

My initial framing — "single-thread is CPU-bound → workers give N× RPS" — was wrong. The per-process CPU metric (95% at c=100 single-thread) was misleading: the *process* was at 95% but the *system* was nowhere near saturated, and workers had cores available and just didn't use them. This is the [[cpu-pct-not-throughput-pct]] lesson re-learned in a new shape.

---

## Decisions

| Pick (from original 4) | Verdict after this investigation |
|---|---|
| 1. Worker threads / cluster | ❌ **Killed** — measured ~0% gain at W=4 and W=8 |
| 2. Replace `@hono/node-server` with `uWebSockets.js` / vanilla `http` | Open — the only remaining lever that could plausibly move the per-connection ceiling. Would need its own spike. High risk: Hono ecosystem coupling, server-hono API churn. |
| 3. Buffered (non-streaming) SSR for small pages | Open but marginal — defeats progressive flush, uncertain win |
| 4. HTTP/2 / keep-alive tuning | Open, small expected win |

**Recommendation: don't pursue any of these unsolicited.** Real-world production gains come from caching (HTTP cache headers on view responses), CDN edge for static assets, and database query optimization — none of which this benchmark exercises. The autocannon test measures keep-alive-on-same-connection throughput, which isn't representative of real traffic shape.

---

## Artifacts

- **Branch:** `perf/ssr-rps-instrument` (uncommitted, local only). Contains:
  - `packages/server-hono/src/perf-boundaries.ts` — ~115 lines, gated, opt-in
  - `packages/server-hono/src/index.ts` — 14 `markBoundary()` call sites
- **Bench wrapper:** `~/perf-bench/rudderjs/cluster.mjs` — 17 lines
- **Raw output:** `/tmp/rudder-perf-c10.txt`, `/tmp/rudder-perf-c100.txt`

### Disposition of branch

Two options for the instrumentation:
- **Ship as opt-in harness** — same justification as `RUDDER_PERF_TRACE`, zero overhead when unset, reusable for any future per-phase question. Small PR (~120 LOC).
- **Shelf** — keep the branch local as reference for the next investigation cycle.

User decision pending.

---

## Related

- [`2026-05-16-vike-architectural-levers.md`](./2026-05-16-vike-architectural-levers.md) — vike-internal investigation that led here
- [`2026-05-16-vike-deep-dive.md`](./2026-05-16-vike-deep-dive.md) — the original deep-dive
- [`2026-05-15-perf-baseline.md`](./2026-05-15-perf-baseline.md) — RudderJS vs Next/Nuxt/Svelte numbers
- [`2026-05-15-ssr-first-render.md`](./2026-05-15-ssr-first-render.md) — the 47% first-render win (#480)
- Memory `project_ssr_rps_gap_outside_vike.md` — should be updated to point here
- Memory `project_perf_investigation_runbook.md` — runbook validated again, no changes needed
