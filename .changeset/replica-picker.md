---
'@rudderjs/database': minor
'@rudderjs/orm': minor
'@rudderjs/orm-drizzle': minor
---

Weighted/custom read-replica picker on read/write-split connections. `read.picker` in `config/database.ts` selects the replica per query: `'round-robin'` (default, the previous behavior), `'random'`, a weights array (one non-negative weight per replica — `[3, 1]` sends ~75% of reads to the first), or a custom `(count) => index` function (Drizzle's `getReplica` equivalent). Shared `makeReplicaPicker` in `@rudderjs/database` powers both the native engine and the Drizzle adapter: malformed weight lists fail fast at adapter construction, a custom function's return is validated per call, and the picker runs after the sticky check so a sticky-routed read never consumes a pick.
