---
"@rudderjs/contracts": minor
"@rudderjs/database": minor
"@rudderjs/orm": minor
---

Nested `whereHas` / `whereDoesntHave` inside constrain callbacks now works on the native engine: `User.whereHas('posts', q => q.where('published', true).whereHas('comments', c => c.where('approved', true)))`. Strictly more expressive than the dot-path form — constraints at EVERY level (not just the deepest), inner `whereDoesntHave` ("posts with NO flagged comments"), sibling branches that AND together, unbounded recursion, and dot-paths composing inside callbacks. The predicate contract's `nested` field widens to `RelationExistencePredicate | RelationExistencePredicate[]` (dot-paths keep the singular form; existing emitters unaffected) and the native compiler normalizes each level to a child list, compiling one correlated EXISTS per child with its own polarity and constraints. Drizzle and Prisma keep rejecting nested predicates via the `supportsNestedRelationPredicates` marker guard with a clear error (adapter implementations planned separately). `withWhereHas` with a nesting callback falls back to plain `with()` — the flat `withConstrained` shape can't carry children.
