---
"@rudderjs/ai": minor
---

**A6 Phase 3 — `withBudget(...)` middleware.** Composes the pricing catalog (phase 1) and the `BudgetStorage` contract (phase 2) into the user-facing API. Per-user spend caps now enforce in production with a one-line install on any `Agent`.

```ts
import { withBudget, memoryBudgetStorage } from '@rudderjs/ai'

const budgeted = withBudget({
  user:    (ctx) => ctx.context as string,         // your app's user-id source
  budget:  () => ({ daily: 0.50, monthly: 10 }),   // USD
  storage: memoryBudgetStorage(),                  // ormBudgetStorage in phase 4
})

class MyAgent extends Agent {
  middleware() { return [budgeted] }
}
```

- **Pre-debit on `onIteration`** — fires before each model call (every step). Estimates input cost from the live messages array via the configured (or default) token estimator + `pricing[model].inputPer1k`. Calls `storage.checkAndDebit` with the estimate. Throws `BudgetExceededError` (or whatever your `onExceeded` throws) on the first denied period.
- **True-up on `onUsage`** — fires after each step with the provider's reported usage. Computes actual cost from `promptTokens` + `completionTokens`, debits the delta over the pre-debit. Always-applies (`cap: MAX_SAFE_INTEGER`) since the response already streamed; the next request bites if the user is now over cap.
- **Bypass** — `user` returning `null`/`undefined` skips enforcement (unauthenticated paths). `budget` returning neither `daily` nor `monthly` skips for that user.
- **Custom error class** — `onExceeded` can throw your own subclass; if it doesn't throw, the middleware throws `BudgetExceededError` so the run never silently passes a denied debit.
- **Daily AND monthly** — both caps may be set; first denial wins.
- **Pricing override** — pass any `Record<string, ModelPriceEntry>` for negotiated rates: `pricing: { ...ModelPricing, 'anthropic/claude-opus-4-7': { inputPer1k: 0.012, outputPer1k: 0.060, _snapshotDate: '2026-01-15' } }`.
- **Fail-loud on unknown model** — `assertKnownModelPricing` throws `UnknownModelPricingError` at iteration time if the agent's model isn't in the configured pricing catalog. Catches typos before they zero-cost through.

Caveats:
- **No refunds on errors.** If the provider call fails after the pre-debit, the estimate stays debited. Apps that need refund-on-error can subscribe `onError` and call `storage` directly.
- **No cache-rate accounting.** `TokenUsage` does not yet expose `cacheReadInputTokens` / `cacheWriteInputTokens`; cached requests are billed at the full `inputPer1k` rate. A `TokenUsage` widening + this middleware integration is a phase 3.x follow-up.
- **Tokenizer accuracy.** Default estimator is `Math.ceil(text.length / 4)` — fine for English-heavy prompts. Pass a tiktoken-backed `estimateTokens` for tight caps.

Also widens `AiFakeStep` with optional `usage` so tests can specify realistic provider-side token counts (used by the budget integration tests; useful for any middleware that depends on usage).
