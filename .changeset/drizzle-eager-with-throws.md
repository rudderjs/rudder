---
"@rudderjs/orm-drizzle": patch
---

fix(orm-drizzle): `.with()` eager loading throws instead of silently dropping

Direct-relation eager loading (`Model.with('author').get()`) was never
implemented on the Drizzle adapter — `with()` was a no-op that returned the rows
with the relation **unloaded**, so it looked like it worked while loading
nothing. It now throws an actionable error instead, so a missing relation can't
masquerade as success.

**Behavior change** (the prior behavior was silent data-not-loaded): code that
called `.with(...)` on a Drizzle-backed model and ignored the result no longer
silently no-ops — it throws, pointing at the `related()` accessor / Drizzle's
relational query API. `withWhereHas` (which implies eager loading) throws on
Drizzle for the same reason — use `whereHas(relation)` for the filter-only case
(it never calls `with()`). Polymorphic relations are eager-loaded in the ORM's
Model layer and are unaffected.

Full direct-relation eager loading on Drizzle is a follow-up.
