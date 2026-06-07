---
"@rudderjs/contracts": minor
"@rudderjs/database": minor
"@rudderjs/orm": minor
"@rudderjs/orm-drizzle": minor
"@rudderjs/orm-prisma": minor
---

`whereHas` / `whereDoesntHave` / `has(relation, op, n)` / `withCount` and the other aggregates now work on through relations (`hasOneThrough` / `hasManyThrough`) on all three adapters — Laravel parity for the previously documented v1 gap. The predicate reuses the pivot two-hop `through` shape with the intermediate table in the pivot slot, plus a new `through.fanOut` marker (`@rudderjs/contracts`) for the 1:N intermediate→related cardinality: plain existence keeps the fan-out-safe nested-EXISTS shape, while count comparisons and aggregates run over the JOINED far rows — counts count far rows (a country reaching 3 posts via 2 users has `postsCount === 3`), and a bare intermediate row never satisfies existence. Constrain callbacks apply to the far table (Laravel semantics); nested dot-paths may include through levels; `withWhereHas` on a through relation falls back to plain `with()` (the two-hop eager load is Model-layer). Drizzle requires the intermediate table registered in `tables: { ... }` (same as pivots); Prisma routes whereHas through the existing deferred 2-step lookup and aggregates through a new fan-out-aware batch path. Also fixes a latent Drizzle bug: the pivot-aggregate JOIN's ON clause rendered unqualified column names — ambiguous whenever pivot and related share a column name (always true for through relations, both having `id`).
