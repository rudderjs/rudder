---
'@rudderjs/orm-drizzle': patch
---

Fix `increment` / `decrement` / `deleteAll` / `updateAll` on Drizzle + MySQL.

MySQL drivers don't support `RETURNING`, so the existing implementations
either threw (`increment` / `decrement` — "returned no rows") or silently
reported a 0-row count (`deleteAll` / `updateAll`). The 0-count broke the
`prune --mass` chunk loop, which exits as soon as the affected count drops
below the chunk size — on MySQL it always exited after the first pass with
rows still in the table.

`DrizzleConfig` gains a new optional `dialect: 'pg' | 'mysql' | 'sqlite'`
field. It's inferred from `driver` when present (`'postgresql'` → `'pg'`,
`'sqlite'` / `'libsql'` → `'sqlite'`, `'mysql'` → `'mysql'`), and defaults
to `'pg'` when a pre-built `client` is supplied without an explicit dialect
(matches the previous code path, so existing Postgres / SQLite users see no
behavior change).

On MySQL:

- `increment` / `decrement` run the `UPDATE` then re-select the target row
  (two round-trips instead of one — the trade-off for losing `RETURNING`).
- `deleteAll` / `updateAll` read `affectedRows` from the driver result
  metadata. Both `mysql2`'s `affectedRows` and planetscale-serverless's
  `rowsAffected` shapes are accepted.

`'mysql'` is now a valid `driver` value in `DrizzleConfig` and
`DatabaseConnectionConfig`. When used, the adapter boots a `mysql2/promise`
pool and routes it through `drizzle-orm/mysql2`. `mysql2` is declared as an
optional peer.

Closes Phase 4 of `docs/plans/2026-05-21-framework-orm-correctness.md`.
