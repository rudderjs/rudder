---
"@rudderjs/orm-prisma": minor
---

Nested `whereHas` now works on the Prisma adapter for all-direct chains — `whereHas('posts', q => q.where('published', true).whereHas('comments', c => c.where('approved', true)))` (and the dot-path form) composes as native nested `some`/`none` filters, with constraints at every level, inner `whereDoesntHave` (`none`), sibling branches (same-relation siblings survive via the collision-safe `AND` array), and unbounded recursion. A pivot/polymorphic/through relation is allowed only at the OUTERMOST position of the chain — its deferred 2-step lookup's related filter carries the direct-chain children — and throws a clear mixed-chain error anywhere deeper (the native engine and Drizzle support those; an innermost-first hybrid is a documented follow-up). Every nested level must be declared as a relation in `schema.prisma`, same as top-level direct `whereHas`.
