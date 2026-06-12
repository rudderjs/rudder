# Comparative ORM benchmark — MySQL query layer

RudderJS native engine vs Prisma vs Drizzle, driven **directly** against an identical MySQL database over a local socket — no HTTP, no server, no Vike. rudder + Drizzle both run on **`mysql2`**, so that pair is a pure query-layer comparison over one driver; **Prisma runs on the `mariadb` driver** (@prisma/adapter-mariadb — it has no mysql2 adapter, an idiomatic-path difference, not a thumb on the scale). Lower is faster; **bold** is the fastest for that op. Numbers are mean per-call wall time from [mitata](https://github.com/evanwashere/mitata).

> Every op is result-parity asserted across all three ORMs before timing (`pnpm bench:parity`) — they each do identical work. Methodology + fairness rules: [`README.md`](../README.md) and [the plan](../../docs/plans/2026-06-11-comparative-orm-benchmark-suite.md).

> **Reading these numbers:** every call pays a real network round-trip (~80–120µs floor on a localhost socket), so single-statement ops (insert/find/list/increment/aggregate) cluster near that floor. The ORMs separate on the query-layer-heavy ops (bulk insert, large hydration, eager + pivot loading), where RudderJS's leaner engine leads. Read alongside the Postgres report ([`REPORT-postgres.md`](REPORT-postgres.md)) — the two socket engines tell the same per-statement-cost story SQLite's in-process reads hide.
>
> **Increment caveat:** RudderJS's op uses its idiomatic instance path (`find()` then `increment()` = two round-trips). MySQL has no `UPDATE … RETURNING`, so Drizzle issues UPDATE-then-SELECT and Prisma does the equivalent internally — every contender pays two statements here, so this op is a closer read than on Postgres. The result value is identical (parity-gated).

## MySQL — 1k

**Size:** 1k (1000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `mysql2@3.15.3`, `mariadb@3.5.2`, `mysql-server@8.0.33`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 131.94µs (1.44×) | **91.43µs** | 345.46µs (3.78×) | Drizzle |
| insert bulk (1k rows) | **2783.05µs** | 6638.12µs (2.39×) | 6564.46µs (2.36×) | RudderJS |
| findByPk (hot loop) | **53.58µs** | 66.30µs (1.24×) | 131.17µs (2.45×) | RudderJS |
| where + order + limit 50 | **426.11µs** | 471.93µs (1.11×) | 567.75µs (1.33×) | RudderJS |
| where get 1k rows (hydration) | **525.37µs** | 754.15µs (1.44×) | 1366.95µs (2.60×) | RudderJS |
| eager-load posts (50 users) | **416.96µs** | 750.98µs (1.80×) | 739.53µs (1.77×) | RudderJS |
| eager-load tags via pivot (200 posts) | **672.69µs** | 1511.93µs (2.25×) | 3165.29µs (4.71×) | RudderJS |
| count + filtered count | 224.10µs (1.03×) | **217.10µs** | 344.57µs (1.59×) | Drizzle |
| increment view_count | 180.78µs (1.24×) | **146.27µs** | 443.98µs (3.04×) | Drizzle |
| serialize 1k hydrated rows | 325.04µs (1.45×) | **224.89µs** | 227.22µs (1.01×) | Drizzle |

## MySQL — 10k

**Size:** 10k (10000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `mysql2@3.15.3`, `mariadb@3.5.2`, `mysql-server@8.0.33`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 134.93µs (1.48×) | **90.89µs** | 339.63µs (3.74×) | Drizzle |
| insert bulk (1k rows) | **2092.10µs** | 6036.84µs (2.89×) | 5820.69µs (2.78×) | RudderJS |
| findByPk (hot loop) | **55.26µs** | 66.77µs (1.21×) | 127.83µs (2.31×) | RudderJS |
| where + order + limit 50 | **550.36µs** | 597.13µs (1.08×) | 660.85µs (1.20×) | RudderJS |
| where get 1k rows (hydration) | **525.36µs** | 770.01µs (1.47×) | 1360.34µs (2.59×) | RudderJS |
| eager-load posts (50 users) | **418.28µs** | 765.23µs (1.83×) | 727.04µs (1.74×) | RudderJS |
| eager-load tags via pivot (200 posts) | **673.65µs** | 1545.19µs (2.29×) | 2877.43µs (4.27×) | RudderJS |
| count + filtered count | 332.21µs (1.12×) | **296.12µs** | 415.08µs (1.40×) | Drizzle |
| increment view_count | 194.10µs (1.28×) | **151.75µs** | 456.59µs (3.01×) | Drizzle |
| serialize 1k hydrated rows | 331.02µs (1.45×) | 228.46µs | **228.41µs** | Prisma |

---

_Regenerate: `pnpm bench:mysql:setup && pnpm bench:mysql && pnpm bench:mysql:report`. Headline published numbers come from a pinned local machine, not CI (timing on shared runners is noise)._
