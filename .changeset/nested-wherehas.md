---
"@rudderjs/orm": minor
"@rudderjs/contracts": minor
---

Nested whereHas on the native engine — dot-path relation chains (`User.whereHas('posts.comments', q => q.where('approved', true))`) compile as nested correlated EXISTS, with Laravel `hasNested` semantics: the constrain callback and any `has()` count comparison apply to the DEEPEST relation, outer levels are plain existence, `whereDoesntHave('a.b')` flips only the outermost EXISTS (a parent row with childless intermediates doesn't defeat it), and `has('a.b', '<', 1)` flips to doesn't-have. Works across `whereHas` / `whereDoesntHave` / `orWhereHas` / `orWhereDoesntHave` / `has` / `orHas` / `whereRelation`, any chain depth, and every relation type the single-level form supports (including belongsToMany pivot hops and arrow-path JSON constraints on the deepest level). `RelationExistencePredicate` (contracts) gains an optional `nested` child predicate. Adapters without support (Drizzle/Prisma for now) throw a clear Model-layer error instead of silently ignoring the field; the nested-whereHas-inside-a-constrain-callback error now points at the dot-path form.
