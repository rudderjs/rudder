---
"@rudderjs/orm": minor
---

Add the built-in native database engine at the node-only `@rudderjs/orm/native` subpath — Phase 1 (SQLite read path).

`@rudderjs/orm/native` ships a first-party query engine that talks directly to `better-sqlite3` (an optional peer), alongside the existing optional `@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle` adapters. This first phase implements the **read** path only — `first` / `find` / `get` / `all` / `count` / `paginate`, the full `WhereOperator` set, `where` / `orWhere`, `whereGroup` / `orWhereGroup` with Laravel precedence, ordering, limit/offset, and soft-delete scoping (`withTrashed` / `onlyTrashed`). Write, relation, aggregate, and vector terminals throw `NativeNotImplementedError` until their phases land.

The engine is split into two seams from day one for runtime portability: a pure `Dialect` (SQL text — `SqliteDialect` first) and a per-platform `Driver` (`execute`/`close` — `BetterSqlite3Driver` now). The SQL compiler is driver-free and fully parameterized — values always flow through bindings, identifiers are validated and quoted — so a React Native / browser driver can drop in later without touching it. The native code lives entirely under the `./native` subpath and is never re-exported from the client-reachable main entry.
