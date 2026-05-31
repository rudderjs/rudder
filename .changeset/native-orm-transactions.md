---
"@rudderjs/contracts": minor
"@rudderjs/orm": minor
---

Native engine Phase 4 — transactions.

Adds first-class database transactions to the ORM, implemented on the native engine (`@rudderjs/orm/native`):

- **`transaction(fn)`** (exported from `@rudderjs/orm`) and the **`Model.transaction(fn)`** alias run `fn` inside a database transaction. Every `Model` query issued anywhere inside the callback — across any model — executes on the transaction's connection, threaded transparently via `AsyncLocalStorage` (no call-site changes, no explicit handle passing). The unit commits when `fn` resolves and rolls back (re-throwing) when it rejects.
- **Nesting maps to SAVEPOINTs.** A nested `transaction()` opens a savepoint; an inner failure rolls back only its own work and leaves the outer transaction intact, while an uncaught inner error propagates and rolls back the whole outer transaction.
- **Contract addition:** `OrmAdapter` gains an **optional** `transaction?<T>(fn: (tx: OrmAdapter) => Promise<T>)`. It passes a transaction-scoped adapter; the Model layer threads it through `AsyncLocalStorage`. Optional = a capability flag — adapters without transaction support omit it, and `transaction()` surfaces a clear error against one. The native engine implements it; the Prisma/Drizzle adapters do not expose it yet (follow-up).
- The native `Driver` seam gains a `Transaction` type (an `Executor` that can open a nested savepoint); the `better-sqlite3` driver implements BEGIN/COMMIT/ROLLBACK with depth-tracked SAVEPOINT nesting over an async callback.

Client-bundle-safe by construction: `node:async_hooks` is lazy-imported only from `transaction()`, never at module-eval time, so `@rudderjs/orm`'s main entry stays out of any browser graph (`Client Bundle Smoke` green).

**Single-connection caveat (SQLite):** transactions assume they aren't run concurrently against one SQLite handle (SQLite serializes writers anyway). Pooled drivers (pg/mysql, later phases) will pin a dedicated client per transaction.
