---
'@rudderjs/orm-drizzle': minor
---

Real `union()` / `unionAll()` on the Drizzle adapter — built on Drizzle's native set operators instead of throwing. Each member contributes its select body (its own ORDER BY / LIMIT are dropped); the base query's ORDER BY / LIMIT / OFFSET apply to the whole compound, and `count()` / `paginate()` count the combined rows. This was the last throwing query-builder method on Drizzle — the native and Drizzle adapters now have full query-builder parity (`selectRaw` remains the one DB-facade pointer).
