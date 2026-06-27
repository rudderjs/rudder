---
"@rudderjs/database": minor
"@rudderjs/orm": minor
---

feat(database): add toSQL() to NativeQueryBuilder, exposed on Model chains

`NativeQueryBuilder.toSQL()` returns the `{ sql, bindings }` pair the query
would run WITHOUT executing it (Laravel's `toSql()`, plus the bound values) —
handy for debugging or logging a query. The `HydratingQueryBuilder` proxy
forwards it too, so `User.query().where('active', true).toSQL()` and
`User.where('role', 'admin').orderBy('name').toSQL()` work from Model chains.
