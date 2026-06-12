# Comparative ORM benchmark — SQLite query layer

RudderJS native engine vs Prisma vs Drizzle, driven **directly** against an identical `better-sqlite3` file — no HTTP, no server, no Vike. Lower is faster; **bold** is the fastest for that op. Numbers are mean per-call wall time from [mitata](https://github.com/evanwashere/mitata).

> Every op is result-parity asserted across all three ORMs before timing (`pnpm bench:parity`) — they each do identical work. Methodology + fairness rules: [`README.md`](../README.md) and [the plan](../../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).

> **SQLite caveat:** SQLite removes network + connection-pool variance, which under-represents Prisma's query-engine overhead (more visible on Postgres over a socket — see [`REPORT-postgres.md`](REPORT-postgres.md)). Read these as query-layer/hydration numbers.

## SQLite — 1k

**Size:** 1k (1000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `better-sqlite3@12.6.2`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | **16.65µs** | 17.53µs (1.05×) | 32.10µs (1.93×) | RudderJS |
| insert bulk (1k rows) | **639.93µs** | 3238.04µs (5.06×) | 3437.40µs (5.37×) | RudderJS |
| findByPk (hot loop) | **5.47µs** | 14.89µs (2.72×) | 24.74µs (4.52×) | RudderJS |
| where + order + limit 50 | **61.52µs** | 83.57µs (1.36×) | 97.00µs (1.58×) | RudderJS |
| where get 1k rows (hydration) | **374.03µs** | 434.07µs (1.16×) | 719.83µs (1.92×) | RudderJS |
| eager-load posts (50 users) | **153.07µs** | 357.72µs (2.34×) | 345.10µs (2.25×) | RudderJS |
| eager-load tags via pivot (200 posts) | **262.13µs** | 770.39µs (2.94×) | 1000.58µs (3.82×) | RudderJS |
| count + filtered count | **13.69µs** | 21.84µs (1.60×) | 45.01µs (3.29×) | RudderJS |
| increment view_count | **20.88µs** | 21.79µs (1.04×) | 33.75µs (1.62×) | RudderJS |
| serialize 1k hydrated rows | 301.68µs (1.43×) | **211.67µs** | 215.01µs (1.02×) | Drizzle |

## SQLite — 10k

**Size:** 10k (10000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `better-sqlite3@12.6.2`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | **16.54µs** | 17.79µs (1.08×) | 32.53µs (1.97×) | RudderJS |
| insert bulk (1k rows) | **646.59µs** | 3297.18µs (5.10×) | 3332.14µs (5.15×) | RudderJS |
| findByPk (hot loop) | **5.38µs** | 15.14µs (2.81×) | 25.04µs (4.65×) | RudderJS |
| where + order + limit 50 | **70.50µs** | 92.85µs (1.32×) | 106.35µs (1.51×) | RudderJS |
| where get 1k rows (hydration) | **370.76µs** | 436.47µs (1.18×) | 720.49µs (1.94×) | RudderJS |
| eager-load posts (50 users) | **154.23µs** | 364.58µs (2.36×) | 341.20µs (2.21×) | RudderJS |
| eager-load tags via pivot (200 posts) | **266.16µs** | 772.40µs (2.90×) | 997.84µs (3.75×) | RudderJS |
| count + filtered count | **16.50µs** | 24.95µs (1.51×) | 119.11µs (7.22×) | RudderJS |
| increment view_count | **20.64µs** | 22.03µs (1.07×) | 34.05µs (1.65×) | RudderJS |
| serialize 1k hydrated rows | 301.05µs (1.42×) | **211.51µs** | 213.95µs (1.01×) | Drizzle |

## SQLite — 100k

**Size:** 100k (100000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `better-sqlite3@12.6.2`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | **16.65µs** | 17.99µs (1.08×) | 33.04µs (1.98×) | RudderJS |
| insert bulk (1k rows) | **655.11µs** | 3345.60µs (5.11×) | 3386.18µs (5.17×) | RudderJS |
| findByPk (hot loop) | **5.49µs** | 15.31µs (2.79×) | 25.34µs (4.62×) | RudderJS |
| where + order + limit 50 | **72.50µs** | 95.07µs (1.31×) | 108.39µs (1.49×) | RudderJS |
| where get 1k rows (hydration) | **375.68µs** | 437.26µs (1.16×) | 725.13µs (1.93×) | RudderJS |
| eager-load posts (50 users) | **156.76µs** | 368.87µs (2.35×) | 342.84µs (2.19×) | RudderJS |
| eager-load tags via pivot (200 posts) | **267.24µs** | 782.90µs (2.93×) | 996.32µs (3.73×) | RudderJS |
| count + filtered count | **50.91µs** | 59.86µs (1.18×) | 857.51µs (16.84×) | RudderJS |
| increment view_count | **21.28µs** | 22.86µs (1.07×) | 34.30µs (1.61×) | RudderJS |
| serialize 1k hydrated rows | 310.26µs (1.43×) | **217.49µs** | 220.33µs (1.01×) | Drizzle |

---

_Regenerate: `pnpm bench:setup && pnpm bench && pnpm bench:report`. Headline published numbers come from a pinned local machine, not CI (timing on shared runners is noise)._
