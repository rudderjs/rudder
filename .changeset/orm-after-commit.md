---
"@rudderjs/orm": minor
"@rudderjs/database": minor
---

feat: after-commit hooks — `afterCommit(fn)` (orm) and `DB.afterCommit(fn)` / `DB.connection(name).afterCommit(fn)` (facade) queue side effects (emails, webhooks, queue dispatches) to run only after the transaction open in the current async context commits, mirroring Laravel's `DB::afterCommit`. Callbacks flush in registration order after the OUTERMOST transaction commits (the awaited `transaction()` resolves after they finish) and are dropped on rollback; a rolled-back savepoint discards only the callbacks registered inside it, a released savepoint hands its callbacks to the enclosing level. Named-connection transactions keep separate queues (pass `{ connection }` to target one explicitly); with no open transaction the callback runs immediately. The queue lives in the orm's `transaction()` wrapper itself — above the adapter seam — so it works identically on the native engine, Drizzle, and Prisma. `@rudderjs/database` gains the `registerAfterCommitRunner`/`resolveAfterCommitRunner` bridge seam and the facade methods.
