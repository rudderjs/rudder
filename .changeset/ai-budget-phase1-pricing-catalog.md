---
"@rudderjs/ai": minor
---

**A6 Phase 1 — pricing catalog + cost estimation.** Foundation for the upcoming `withBudget(...)` middleware (phase 3). The eval framework's local `PRICING` table is replaced with this catalog so the cost column on eval reports is meaningful for every shipped provider, not just 8 hardcoded models.

- `ModelPricing` — `<provider>/<model>` → `{ inputPer1k, outputPer1k, cacheReadPer1k?, cacheWritePer1k?, _snapshotDate }`. Covers all headline models for every provider in `src/providers/` (Anthropic, OpenAI, Google, Bedrock, xAI, DeepSeek, Mistral, Groq, Cohere). Catalog snapshot is dated 2026-05-11; entries carry `_snapshotDate` per row so apps with negotiated rates can spot stale rows when they upgrade.
- `estimateCost(model, promptTokens, completionTokens, pricing?)` — same shape as the previous eval-internal `estimateCost`, but accepts an override map. Returns `0` for unknown models (eval cost columns shouldn't crash on a fresh model id). Re-exported from `@rudderjs/ai/eval` for back-compat.
- `assertKnownModelPricing(model, pricing?)` — fail-loud variant for budget enforcement. Throws `UnknownModelPricingError` carrying the model id + catalog snapshot date so apps fail at construction instead of zero-costing through a typo'd model.
- `BudgetExceededError` — error class shipped now so apps can `instanceof`-check against it from `withBudget({ onExceeded })` callbacks once phase 3 lands.

Override entries by spreading: `pricing: { ...ModelPricing, 'anthropic/claude-opus-4-7': { inputPer1k: 0.012, outputPer1k: 0.060, _snapshotDate: '2026-01-15' } }`.
