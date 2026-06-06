---
"@rudderjs/orm": patch
---

Pivot ops (`sync`/`attach`/`detach`/`updatePivot`) now compare ids loosely and write DB-typed values. Ids arriving as strings from an HTML form (`sync(["1","3"])`) no longer re-attach already-present numeric ids — previously a UNIQUE-constraint violation on a constrained pivot, or a silent duplicate-then-delete on an unconstrained one — and `detach`/`updatePivot` WHERE values are coerced to the id type observed on the stored pivot rows, so typed adapters (Prisma/Drizzle) never see a string bound against an Int column. Applies to `belongsToMany`, `morphToMany`, and `morphedByMany`.
