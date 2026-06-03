---
'@rudderjs/orm-drizzle': minor
---

`onQuery` query listening on the Drizzle adapter — completes `DB.listen()` coverage across all three adapters (native, Prisma, Drizzle). Every fluent query reports `{ sql, bindings, duration, connection }` to registered listeners (SQL text + params via the builder's `toSQL()`), the raw `DB.*` seams (`selectRaw` / `affectingStatement`) report their text + bindings directly, and transaction-scoped queries report to the same listeners as top-level ones. Listener errors are swallowed; only successful executions report (Laravel `QueryExecuted` parity). pgvector similarity queries (raw `db.execute` path) are not reported.
