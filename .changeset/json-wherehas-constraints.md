---
"@rudderjs/orm": minor
---

Arrow-path JSON predicates now work inside `whereHas` / `whereDoesntHave` / `has()` / `whereRelation` constrain callbacks (and aggregate constraints like `withCount`) on the native engine — `User.whereHas('posts', q => q.where('meta->lang', 'en'))` compiles the constraint through the same per-dialect `jsonExtract` seam as top-level arrow `where()`, with the base column qualified to the related table inside the correlated EXISTS body. Path segments are validated by the same injection gate; bindings stay in SQL-text order. Closes the whereHas-constraint deferral from the JSON-path arc.
