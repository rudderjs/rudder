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
| insert single row | 135.06µs (1.45×) | **93.36µs** | 354.02µs (3.79×) | Drizzle |
| insert bulk (1k rows) | **2007.88µs** | 6093.67µs (3.03×) | 6883.40µs (3.43×) | RudderJS |
| findByPk (hot loop) | **55.51µs** | 65.59µs (1.18×) | 136.33µs (2.46×) | RudderJS |
| where + order + limit 50 | **443.04µs** | 530.77µs (1.20×) | 618.30µs (1.40×) | RudderJS |
| where get 1k rows (hydration) | **527.94µs** | 771.27µs (1.46×) | 1404.15µs (2.66×) | RudderJS |
| eager-load posts (50 users) | **414.60µs** | 766.94µs (1.85×) | 738.35µs (1.78×) | RudderJS |
| eager-load tags via pivot (200 posts) | **673.31µs** | 1508.54µs (2.24×) | 3373.20µs (5.01×) | RudderJS |
| count + filtered count | 224.71µs (1.02×) | **219.72µs** | 341.77µs (1.56×) | Drizzle |
| increment view_count | 185.88µs (1.26×) | **147.40µs** | 447.10µs (3.03×) | Drizzle |
| serialize 1k hydrated rows | 311.21µs (1.43×) | 217.56µs | **217.52µs** | Prisma |

## MySQL — 10k

**Size:** 10k (10000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `mysql2@3.15.3`, `mariadb@3.5.2`, `mysql-server@8.0.33`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 137.26µs (1.46×) | **93.81µs** | 357.74µs (3.81×) | Drizzle |
| insert bulk (1k rows) | **2365.78µs** | 6214.53µs (2.63×) | 7089.57µs (3.00×) | RudderJS |
| findByPk (hot loop) | **53.53µs** | 63.32µs (1.18×) | 126.07µs (2.35×) | RudderJS |
| where + order + limit 50 | **558.50µs** | 629.04µs (1.13×) | 667.41µs (1.19×) | RudderJS |
| where get 1k rows (hydration) | **521.41µs** | 745.19µs (1.43×) | 1385.02µs (2.66×) | RudderJS |
| eager-load posts (50 users) | **411.12µs** | 766.08µs (1.86×) | 732.39µs (1.78×) | RudderJS |
| eager-load tags via pivot (200 posts) | **664.31µs** | 1539.86µs (2.32×) | 3062.29µs (4.61×) | RudderJS |
| count + filtered count | 330.43µs (1.14×) | **290.79µs** | 393.66µs (1.35×) | Drizzle |
| increment view_count | 182.78µs (1.25×) | **146.75µs** | 434.97µs (2.96×) | Drizzle |
| serialize 1k hydrated rows | 311.06µs (1.43×) | **217.69µs** | 220.32µs (1.01×) | Drizzle |

## MySQL — 100k

**Size:** 100k (100000 users) · **Date:** 2026-06-12

- **Machine:** Apple M5 Pro (15 cores) · Darwin 25.4.0 · arm64 · Node v24.16.0
- **Versions:** `@rudderjs/orm@1.21.0`, `@rudderjs/database@1.5.1`, `drizzle-orm@0.45.2`, `@prisma/client@7.4.2`, `mysql2@3.15.3`, `mariadb@3.5.2`, `mysql-server@8.0.33`, `mitata@1.0.34`
- **Seed:** `2654435769` (deterministic)

| Operation | RudderJS | Drizzle | Prisma | Fastest |
|---|--:|--:|--:|---|
| insert single row | 134.23µs (1.45×) | **92.38µs** | 365.53µs (3.96×) | Drizzle |
| insert bulk (1k rows) | **2975.44µs** | 7076.96µs (2.38×) | 7290.41µs (2.45×) | RudderJS |
| findByPk (hot loop) | **52.31µs** | 61.92µs (1.18×) | 129.67µs (2.48×) | RudderJS |
| where + order + limit 50 | **588.58µs** | 717.53µs (1.22×) | 803.98µs (1.37×) | RudderJS |
| where get 1k rows (hydration) | **525.99µs** | 801.58µs (1.52×) | 1343.28µs (2.55×) | RudderJS |
| eager-load posts (50 users) | **444.16µs** | 766.49µs (1.73×) | 864.14µs (1.95×) | RudderJS |
| eager-load tags via pivot (200 posts) | **694.63µs** | 1695.93µs (2.44×) | 2980.36µs (4.29×) | RudderJS |
| count + filtered count | 1361.65µs (1.06×) | **1288.53µs** | 1607.55µs (1.25×) | Drizzle |
| increment view_count | 192.43µs (1.30×) | **148.00µs** | 463.48µs (3.13×) | Drizzle |
| serialize 1k hydrated rows | 311.65µs (1.41×) | **220.75µs** | 221.54µs | Drizzle |

---

_Regenerate: `pnpm bench:mysql:setup && pnpm bench:mysql && pnpm bench:mysql:report`. Headline published numbers come from a pinned local machine, not CI (timing on shared runners is noise)._
