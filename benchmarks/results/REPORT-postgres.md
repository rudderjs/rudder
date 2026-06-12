# Comparative ORM benchmark — Postgres query layer

RudderJS native engine vs Prisma vs Drizzle, driven **directly** against an identical Postgres database over a local socket — no HTTP, no server, no Vike. rudder + Drizzle both run on **porsager `postgres`** (postgres-js), so that pair is a pure query-layer comparison over one driver; **Prisma runs on node-postgres** (it has no porsager adapter — an idiomatic-path difference, not a thumb on the scale). Lower is faster; **bold** is the fastest for that op. Numbers are mean per-call wall time from [mitata](https://github.com/evanwashere/mitata).

> Every op is result-parity asserted across all three ORMs before timing (`pnpm bench:parity`) — they each do identical work. Methodology + fairness rules: [`README.md`](../README.md) and [the plan](../../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).

> **Reading these numbers:** every call now pays a real network round-trip (~80–100µs floor on a localhost socket), so single-statement ops (insert/find/list/increment/aggregate) cluster near that floor and Prisma's query engine is competitive — even ahead — there. The ORMs separate on the query-layer-heavy ops (bulk insert, large hydration, eager + pivot loading), where RudderJS's leaner engine still leads. This is the contrast the SQLite report flagged as the committed follow-up: SQLite's zero-latency in-process reads under-represent the per-statement engine cost that a socket exposes.
>
> **Increment caveat:** RudderJS's op uses its idiomatic instance path (`find()` then `increment()` = two round-trips); Drizzle/Prisma issue a single `UPDATE … RETURNING`. On SQLite the extra round-trip is ~free; over a socket it roughly doubles that one op. The result value is identical (parity-gated) — only the round-trip count differs.

## Postgres — 1k

**Size:** 1k (1000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `postgres@3.4.7`, `pg@8.19.0`, `postgres-server@17.5 (Postgres.app)`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 120.70µs (1.39×) | 103.60µs (1.19×) | **86.86µs** | Prisma |
| insert bulk (1k rows) | **2111.51µs** | 8751.74µs (4.14×) | 5188.27µs (2.46×) | RudderJS |
| findByPk (hot loop) | 84.41µs (1.14×) | 97.50µs (1.32×) | **74.09µs** | Prisma |
| where + order + limit 50 | 221.03µs (1.02×) | 249.80µs (1.15×) | **217.43µs** | Prisma |
| where get 1k rows (hydration) | **685.95µs** | 882.11µs (1.29×) | 948.60µs (1.38×) | RudderJS |
| eager-load posts (50 users) | **414.15µs** | 683.20µs (1.65×) | 499.00µs (1.20×) | RudderJS |
| eager-load tags via pivot (200 posts) | **804.12µs** | 1725.88µs (2.15×) | 1370.72µs (1.70×) | RudderJS |
| count + filtered count | 160.48µs (1.05×) | 169.56µs (1.10×) | **153.49µs** | Prisma |
| increment view_count | 180.78µs (1.81×) | 113.20µs (1.13×) | **100.15µs** | Prisma |
| serialize 1k hydrated rows | 313.29µs (1.42×) | 220.53µs | **219.86µs** | Prisma |

## Postgres — 10k

**Size:** 10k (10000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `postgres@3.4.7`, `pg@8.19.0`, `postgres-server@17.5 (Postgres.app)`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 101.02µs (1.18×) | 105.97µs (1.23×) | **85.88µs** | Prisma |
| insert bulk (1k rows) | **2317.71µs** | 8443.99µs (3.64×) | 4978.32µs (2.15×) | RudderJS |
| findByPk (hot loop) | 83.02µs (1.10×) | 96.90µs (1.29×) | **75.28µs** | Prisma |
| where + order + limit 50 | 250.24µs (1.03×) | 277.45µs (1.14×) | **242.84µs** | Prisma |
| where get 1k rows (hydration) | **679.78µs** | 863.70µs (1.27×) | 939.56µs (1.38×) | RudderJS |
| eager-load posts (50 users) | **405.96µs** | 699.40µs (1.72×) | 500.79µs (1.23×) | RudderJS |
| eager-load tags via pivot (200 posts) | **756.09µs** | 1779.30µs (2.35×) | 1315.63µs (1.74×) | RudderJS |
| count + filtered count | **376.85µs** | 377.30µs | 383.15µs (1.02×) | RudderJS |
| increment view_count | 180.63µs (1.84×) | 113.03µs (1.15×) | **98.32µs** | Prisma |
| serialize 1k hydrated rows | 313.13µs (1.45×) | **216.52µs** | 216.59µs | Drizzle |

## Postgres — 100k

**Size:** 100k (100000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `postgres@3.4.7`, `pg@8.19.0`, `postgres-server@17.5 (Postgres.app)`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 113.79µs (1.27×) | 118.04µs (1.32×) | **89.39µs** | Prisma |
| insert bulk (1k rows) | **2035.40µs** | 8846.78µs (4.35×) | 4708.30µs (2.31×) | RudderJS |
| findByPk (hot loop) | 88.50µs (1.19×) | 104.91µs (1.41×) | **74.24µs** | Prisma |
| where + order + limit 50 | 254.21µs (1.04×) | 282.29µs (1.15×) | **244.41µs** | Prisma |
| where get 1k rows (hydration) | **677.73µs** | 854.81µs (1.26×) | 923.23µs (1.36×) | RudderJS |
| eager-load posts (50 users) | **404.92µs** | 685.80µs (1.69×) | 498.62µs (1.23×) | RudderJS |
| eager-load tags via pivot (200 posts) | **758.72µs** | 1746.89µs (2.30×) | 1281.68µs (1.69×) | RudderJS |
| count + filtered count | 1927.92µs | **1922.61µs** | 2284.54µs (1.19×) | Drizzle |
| increment view_count | 182.24µs (1.89×) | 113.48µs (1.17×) | **96.58µs** | Prisma |
| serialize 1k hydrated rows | 313.34µs (1.44×) | 220.21µs (1.01×) | **218.30µs** | Prisma |

---

_Regenerate: `pnpm bench:pg:setup && pnpm bench:pg && pnpm bench:pg:report`. Headline published numbers come from a pinned local machine, not CI (timing on shared runners is noise)._
