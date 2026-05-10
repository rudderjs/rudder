---
"@rudderjs/ai": minor
---

**A5 Phase 3 — `jsonShape` / `semanticMatch` / `tokenCost` + `compose`.** Three new built-in metrics for `@rudderjs/ai/eval` plus a composition helper.

- **`jsonShape(schema: z.ZodType)`** — strict structural assertion. Strips ```` ``` ```` / ```` ```json ```` fences from `response.text`, parses, runs `safeParse`. On failure surfaces the zod issue path (e.g. `customer.email`) so debugging doesn't require a separate console log. Pairs naturally with `Output.object({ schema })` on the agent.
- **`semanticMatch(reference, opts?)`** — embedding-based fuzzy match. Embeds both `reference` and `response.text` via `AI.embed()`, computes pure-JS cosine, passes when score >= `opts.threshold` (default `0.85`, tighter than `EmbeddingUserMemory`'s 0.5 retrieval-rank floor since this is an assertion, not a ranking). Embed token usage rolls into the case's cost rollup via the same side-channel `llmJudge` already uses.
- **`tokenCost(threshold)`** — passes when `response.usage.totalTokens <= threshold`. Detects prompt-size regressions before they show up as a billing surprise.
- **`compose(...metrics)`** — runs metrics in order, short-circuits on the first failure, surfaces its reason. Awaits async metrics in declaration order.

Internal: the `judgeUsage` side-channel symbol is renamed to `extraUsage` so the embed cost from `semanticMatch` can ride the same channel without misleading naming. No public API change — the symbol is internal-only.

Phase 4 adds `--record` / `--replay` (AiFake-backed) + telescope `agent.eval.completed` events; Phase 5 adds the HTML report.
