---
"@rudderjs/database": minor
"@rudderjs/orm": minor
---

feat: `insertUsing(columns, query)` on the native engine — `INSERT INTO table (cols) SELECT …` with rows produced by a subquery (another native query chain or a raw SQL string with `?` placeholders + bindings; same body forms as `whereExists`). The explicit column list maps the subquery projection positionally; returns the inserted-row count (`RETURNING *` on sqlite/pg, driver `affectedRows` on MySQL). Bulk data-plane write: no observer events, no `fillable`/`guarded` filtering, no key generation — like `insertMany`/`upsert`. Available on query chains and as a `Model.insertUsing` static. Native engine only — Drizzle/Prisma throw the forward-or-throw guard error.
