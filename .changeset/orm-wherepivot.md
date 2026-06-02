---
'@rudderjs/orm': minor
---

feat(orm): belongsToMany pivot query constraints — `wherePivot` family (Laravel parity)

`belongsToMany` / `morphToMany` / `morphedByMany` relation reads can now filter by
pivot-table columns, not just project them with `withPivot`:

- `wherePivot(column, value)` / `wherePivot(column, operator, value)`
- `wherePivotIn(column, values)` / `wherePivotNotIn(column, values)`
- `wherePivotBetween(column, [min, max])`
- `orWherePivot(column, value?)`

```ts
await user.related('roles').wherePivot('active', 1).get()
await user.related('roles').wherePivotBetween('level', [3, 5]).withPivot('level').get()
```

The constraints apply to the pivot-rows query in step 1 of the existing two-step
load, so all three adapters get it with no adapter or contract change. The chainable
read surface is exported as the `PivotQueryBuilder` type.
