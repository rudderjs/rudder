# Realistic-workload HTTP bench — baseline

Through-the-server numbers for the prod **playground** (native engine): boot the
server, warm it, then hit a weighted route mix. This measures the *whole* request
path (router + normalization + middleware + handler + SSR), not the query layer in
isolation (that is `benchmarks/`). Rate limiting is disabled via `RUDDER_BENCH=1`.

Regenerate with `node playground/bench/realistic.mjs --save` from the repo root.
Numbers come from a pinned local machine, not CI (shared-runner timing is noise).

## Provenance

- **Date:** 2026-06-16T15:12:29.127Z
- **Node:** v24.16.0
- **OS / CPU:** Darwin 25.4.0 arm64 — Apple M5 Pro (15 cores)
- **Run:** per-route n=200 (c=1), mixed=5000 (c=8), warmup=20
- **Packages:** `@rudderjs/core` 1.13.0, `@rudderjs/server-hono` 1.8.0, `@rudderjs/router` 1.9.1, `@rudderjs/orm` 1.21.2, `@rudderjs/database` 1.5.4, `@rudderjs/view` 1.4.0, `@rudderjs/vite` 2.11.2, `@rudderjs/middleware` 1.2.3

## Per-route, sequential (c=1)

| Route | p50 (ms) | p95 (ms) | p99 (ms) | errors |
|---|--:|--:|--:|--:|
| GET /api/health         JSON, floor | 0.38 | 0.50 | 0.54 | 0 |
| GET /api/config         JSON, framework | 0.34 | 0.49 | 2.43 | 0 |
| GET /api/users          JSON, DB list | 0.37 | 0.55 | 6.15 | 0 |
| GET /api/users/:id      JSON, DB find | 0.33 | 0.48 | 6.06 | 0 |
| GET /                   view, no-DB | 0.66 | 1.11 | 6.86 | 0 |
| GET /about              view, no-DB | 0.56 | 0.73 | 6.43 | 0 |
| GET /demos/todos        view, DB | 0.72 | 1.11 | 6.23 | 0 |
| GET /demos/polymorphic  view, complex DB | 0.74 | 1.63 | 6.18 | 0 |

## Mixed weighted (total=5000, c=8)

- **Throughput:** 2251 req/s
- **End-to-end latency:** p50 2.94ms, p95 9.18ms, p99 10.70ms
- **Errors:** 0/5000

| Route | n | p50 (ms) | p95 (ms) | p99 (ms) |
|---|--:|--:|--:|--:|
| GET /api/health         JSON, floor | 742 | 2.78 | 8.96 | 10.14 |
| GET /api/config         JSON, framework | 737 | 2.82 | 9.00 | 10.27 |
| GET /api/users          JSON, DB list | 601 | 2.89 | 9.28 | 11.39 |
| GET /api/users/:id      JSON, DB find | 666 | 2.96 | 9.26 | 10.98 |
| GET /                   view, no-DB | 762 | 2.58 | 8.78 | 10.60 |
| GET /about              view, no-DB | 496 | 3.09 | 9.21 | 11.18 |
| GET /demos/todos        view, DB | 505 | 3.25 | 9.22 | 10.43 |
| GET /demos/polymorphic  view, complex DB | 491 | 3.28 | 9.70 | 11.38 |
