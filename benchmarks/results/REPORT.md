# Comparative ORM benchmark — SQLite query layer

RudderJS native engine vs Prisma vs Drizzle, driven **directly** against an identical `better-sqlite3` file — no HTTP, no server, no Vike. Lower is faster; **bold** is the fastest for that op. Numbers are mean per-call wall time from [mitata](https://github.com/evanwashere/mitata).

> Every op is result-parity asserted across all three ORMs before timing (`pnpm bench:parity`) — they each do identical work. Methodology + fairness rules: [`README.md`](../README.md) and [the plan](../../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).

> **SQLite caveat:** SQLite removes network + connection-pool variance, which under-represents Prisma's query-engine overhead (more visible on Postgres over a socket). Read these as query-layer/hydration numbers; Postgres is the committed follow-up.

## SQLite — 1k

**Size:** 1k (1000 users) · **Date:** 2026-06-11

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.20.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `better-sqlite3@12.6.2`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | **17.24µs** | 17.53µs (1.02×) | 31.99µs (1.86×) | RudderJS |
| insert bulk (1k rows) | **639.80µs** | 3267.33µs (5.11×) | 3288.90µs (5.14×) | RudderJS |
| findByPk (hot loop) | **5.78µs** | 15.00µs (2.60×) | 25.85µs (4.48×) | RudderJS |
| where + order + limit 50 | 96.22µs (1.13×) | **85.05µs** | 99.05µs (1.16×) | Drizzle |
| where get 1k rows (hydration) | 1053.98µs (2.46×) | **428.41µs** | 708.35µs (1.65×) | Drizzle |
| eager-load posts (50 users) | **327.11µs** | 354.52µs (1.08×) | 347.76µs (1.06×) | RudderJS |
| eager-load tags via pivot (200 posts) | **383.29µs** | 777.19µs (2.03×) | 988.32µs (2.58×) | RudderJS |
| count + filtered count | **14.32µs** | 21.14µs (1.48×) | 46.15µs (3.22×) | RudderJS |
| increment view_count | 22.31µs (1.02×) | **21.84µs** | 35.18µs (1.61×) | Drizzle |
| serialize 1k hydrated rows | 321.15µs (1.44×) | **222.91µs** | 229.81µs (1.03×) | Drizzle |

## SQLite — 10k

**Size:** 10k (10000 users) · **Date:** 2026-06-11

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.20.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `better-sqlite3@12.6.2`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | **17.06µs** | 18.06µs (1.06×) | 32.85µs (1.93×) | RudderJS |
| insert bulk (1k rows) | **643.45µs** | 3261.67µs (5.07×) | 3409.16µs (5.30×) | RudderJS |
| findByPk (hot loop) | **5.81µs** | 15.14µs (2.61×) | 25.44µs (4.38×) | RudderJS |
| where + order + limit 50 | 101.88µs (1.09×) | **93.89µs** | 106.87µs (1.14×) | Drizzle |
| where get 1k rows (hydration) | 938.30µs (2.18×) | **430.94µs** | 702.25µs (1.63×) | Drizzle |
| eager-load posts (50 users) | **306.55µs** | 362.44µs (1.18×) | 334.47µs (1.09×) | RudderJS |
| eager-load tags via pivot (200 posts) | **365.82µs** | 781.10µs (2.14×) | 993.17µs (2.71×) | RudderJS |
| count + filtered count | **17.03µs** | 23.52µs (1.38×) | 116.12µs (6.82×) | RudderJS |
| increment view_count | 22.36µs (1.02×) | **22.00µs** | 33.98µs (1.54×) | Drizzle |
| serialize 1k hydrated rows | 306.65µs (1.36×) | 224.92µs | **224.76µs** | Prisma |

---

_Regenerate: `pnpm bench:setup && pnpm bench && pnpm bench:report`. Headline published numbers come from a pinned local machine, not CI (timing on shared runners is noise)._
