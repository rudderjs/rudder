# Comparative ORM benchmark — Postgres query layer

RudderJS native engine vs Prisma vs Drizzle, driven **directly** against an identical Postgres database over a local socket — no HTTP, no server, no Vike. rudder + Drizzle both run on **porsager `postgres`** (postgres-js), so that pair is a pure query-layer comparison over one driver; **Prisma runs on node-postgres** (it has no porsager adapter — an idiomatic-path difference, not a thumb on the scale). Lower is faster; **bold** is the fastest for that op. Numbers are mean per-call wall time from [mitata](https://github.com/evanwashere/mitata).

> Every op is result-parity asserted across all three ORMs before timing (`pnpm bench:parity`) — they each do identical work. Methodology + fairness rules: [`README.md`](../README.md) and [the plan](../../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).

> **Reading these numbers:** every call now pays a real network round-trip (~80–100µs floor on a localhost socket), so single-statement ops (insert/find/list/increment/aggregate) cluster near that floor and Prisma's query engine is competitive — even ahead — there. The ORMs separate on the query-layer-heavy ops (bulk insert, large hydration, eager + pivot loading), where RudderJS's leaner engine still leads. This is the contrast the SQLite report flagged as the committed follow-up: SQLite's zero-latency in-process reads under-represent the per-statement engine cost that a socket exposes.
>
> **Increment caveat:** RudderJS's op uses its idiomatic instance path (`find()` then `increment()` = two round-trips); Drizzle/Prisma issue a single `UPDATE … RETURNING`. On SQLite the extra round-trip is ~free; over a socket it roughly doubles that one op. The result value is identical (parity-gated) — only the round-trip count differs.

## Postgres — 1k

**Size:** 1k (1000 users) · **Date:** 2026-06-11

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.20.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `postgres@3.4.7`, `pg@8.19.0`, `postgres-server@17.5 (Postgres.app)`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 103.26µs (1.16×) | 108.12µs (1.22×) | **88.77µs** | Prisma |
| insert bulk (1k rows) | **2050.78µs** | 8677.75µs (4.23×) | 4530.84µs (2.21×) | RudderJS |
| findByPk (hot loop) | 87.76µs (1.18×) | 103.07µs (1.38×) | **74.58µs** | Prisma |
| where + order + limit 50 | 231.33µs (1.05×) | 259.73µs (1.18×) | **220.42µs** | Prisma |
| where get 1k rows (hydration) | **685.86µs** | 861.18µs (1.26×) | 916.81µs (1.34×) | RudderJS |
| eager-load posts (50 users) | **430.05µs** | 691.66µs (1.61×) | 505.08µs (1.17×) | RudderJS |
| eager-load tags via pivot (200 posts) | **823.24µs** | 1488.32µs (1.81×) | 1382.29µs (1.68×) | RudderJS |
| count + filtered count | 171.83µs (1.06×) | 177.24µs (1.10×) | **161.37µs** | Prisma |
| increment view_count | 179.13µs (1.87×) | 110.81µs (1.16×) | **95.86µs** | Prisma |
| serialize 1k hydrated rows | 306.21µs (1.35×) | **227.26µs** | 228.38µs | Drizzle |

## Postgres — 10k

**Size:** 10k (10000 users) · **Date:** 2026-06-11

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.20.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `postgres@3.4.7`, `pg@8.19.0`, `postgres-server@17.5 (Postgres.app)`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 98.96µs (1.15×) | 105.68µs (1.23×) | **85.90µs** | Prisma |
| insert bulk (1k rows) | **2437.70µs** | 8513.24µs (3.49×) | 5192.93µs (2.13×) | RudderJS |
| findByPk (hot loop) | 83.90µs (1.12×) | 103.77µs (1.39×) | **74.75µs** | Prisma |
| where + order + limit 50 | 261.04µs (1.06×) | 291.23µs (1.19×) | **245.74µs** | Prisma |
| where get 1k rows (hydration) | **715.87µs** | 874.24µs (1.22×) | 919.10µs (1.28×) | RudderJS |
| eager-load posts (50 users) | **413.98µs** | 676.76µs (1.63×) | 483.93µs (1.17×) | RudderJS |
| eager-load tags via pivot (200 posts) | **752.98µs** | 1487.64µs (1.98×) | 1290.94µs (1.71×) | RudderJS |
| count + filtered count | **284.26µs** | 293.41µs (1.03×) | 310.44µs (1.09×) | RudderJS |
| increment view_count | 174.92µs (1.85×) | 108.74µs (1.15×) | **94.52µs** | Prisma |
| serialize 1k hydrated rows | 308.98µs (1.37×) | 226.32µs | **225.56µs** | Prisma |

---

_Regenerate: `pnpm bench:pg:setup && pnpm bench:pg && pnpm bench:pg:report`. Headline published numbers come from a pinned local machine, not CI (timing on shared runners is noise)._
