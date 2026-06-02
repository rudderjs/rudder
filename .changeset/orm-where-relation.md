---
'@rudderjs/orm': minor
---

feat(orm): `whereRelation` / `orWhereRelation` — column-on-relation filter sugar (Laravel parity)

Shorthand for `whereHas(relation, q => q.where(column, …))`:

```ts
await User.whereRelation('posts', 'published', true).get()       // = operator
await User.whereRelation('posts', 'views', '>=', 100).get()      // explicit operator
await User.orWhereRelation('posts', 'flagged', true).get()       // OR-rooted
```

Available as `Model` statics and as chainable methods on the query builder
(`User.where(...).whereRelation(...)`). Delegates to the existing `whereHas`
predicate machinery, so it works across every relation type `whereHas` supports
(including pivot relations) and carries the same adapter support — no adapter or
contract change.
