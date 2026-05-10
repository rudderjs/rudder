---
"@rudderjs/ai": minor
---

**A6 Phase 2 — `BudgetStorage` interface + `memoryBudgetStorage`.** Locks the persistence contract that `withBudget(...)` middleware (phase 3) and `ormBudgetStorage` (phase 4) both implement against.

- `BudgetStorage.checkAndDebit(opts)` — atomically reads the current spend, adds `costUsd` if it stays within `cap`, returns `{ allowed, spent, cap }`. Atomic by contract: implementations must keep the read + write in a single critical section to prevent two concurrent callers both passing the check before either debits.
- `memoryBudgetStorage()` — Map-backed in-process implementation. Atomic because `Map.get` / `Map.set` are synchronous; a concurrency test with 100 parallel `checkAndDebit` calls at the cap line confirms exactly `floor(cap/cost)` succeed. Cross-process caveat documented loudly: queue workers don't see the same Map, so apps with workers must use `ormBudgetStorage` (phase 4) or a Redis-backed storage.
- `periodKey(period, now, timezone?)` — TZ-aware bucket key (`YYYY-MM-DD` for `daily`, `YYYY-MM` for `monthly`). Default UTC; pass an IANA name (`'America/Los_Angeles'`) for user-local rollover. Daily buckets in PST roll at PST midnight, even when that crosses UTC date or month boundaries.
- `costUsd: 0` is a pure read — useful for "you've spent $X today" status displays without mutating the counter.
- Validation: rejects negative / NaN / Infinity for `cap` and `costUsd` at debit time.
- `reset?(userId, period, now?, timezone?)` — optional, useful for tests + admin overrides.

Phase 3 will compose this with the pricing catalog from phase 1 to ship the user-facing `withBudget(...)` middleware.
