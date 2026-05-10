---
"@rudderjs/ai": minor
---

**A6 Phase 4 — `ormBudgetStorage` + production-ready persistence.** Closes out #A6.

```ts
import { withBudget } from '@rudderjs/ai'
import { ormBudgetStorage } from '@rudderjs/ai/budget-orm'

const budgeted = withBudget({
  user:    (ctx) => ctx.context as string,
  budget:  () => ({ daily: 0.50, monthly: 10 }),
  storage: ormBudgetStorage(),  // was: memoryBudgetStorage()
})
```

- New subpath export `@rudderjs/ai/budget-orm` (lazy peer dep on `@rudderjs/orm`, mirrors `@rudderjs/ai/memory-orm`):
  - `ormBudgetStorage()` — production-ready `BudgetStorage` implementation
  - `OrmBudgetStorage` — class form for direct use
  - `BudgetUsageRecord` — Model row exposed for admin queries (top spenders, period rollups)
  - `budgetUsagePrismaSchema` — schema reference string for copy-paste
- Schema lives at `playground/prisma/schema/ai.prisma` (alongside the existing `UserMemory` model). The `@@unique([userId, period, periodKey])` constraint is required — without it, the find-or-create path can race and produce duplicate rows that silently break cap accounting.
- `checkAndDebit` uses find-or-create + atomic `Model.increment`. The unique constraint catches first-write races; the storage refetches and falls through to the increment path on a `create` collision.
- `costUsd: 0` is the pure-read path; doesn't touch storage on an empty bucket.
- Single debit larger than cap on an empty bucket refuses without creating a row (no polluting storage with denied requests).
- `reset(userId, period, now?, timezone?)` deletes the bucket for tests + admin overrides.

# Atomicity caveat

The cap check is read-then-conditional-increment. The increment itself is atomic (`UPDATE col = col + n`), but under high concurrency for a single user, two callers can both pass the check before either debits — total spend may briefly exceed `cap` by up to `costUsd × concurrency`. For typical apps (1–2 in-flight requests per user) this is negligible. Strict guarantees require serializable transactions or a Redis-backed counter — both planned as follow-ups.
