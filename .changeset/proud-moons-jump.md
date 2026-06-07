---
"@rudderjs/orm-drizzle": minor
---

Nested `whereHas` now works on the Drizzle adapter — both the dot-path form (`whereHas('posts.comments')`) and callback nesting (`whereHas('posts', q => q.where('id','>=',4).whereHas('comments', c => c.where('approved', true))))`), with constraints at every level, inner `whereDoesntHave`, sibling branches, unbounded recursion, and pivot hops mid-chain. The relation-existence builder recurses (`_relationExistsExpr`), correlating each child against the enclosing level's related table — children of a pivot level live inside the inner related select, matching the native compiler. The adapter now advertises `supportsNestedRelationPredicates`, lifting the Model-layer guard that previously rejected both nested forms on Drizzle. Every table referenced anywhere in the chain must be registered in `tables: { ... }` (or `DrizzleTableRegistry`) — a missing table at any depth surfaces the standard clear error.
