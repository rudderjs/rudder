---
"@rudderjs/ai": minor
---

**A5 Phase 1 — built-in eval framework.** A new subpath at `@rudderjs/ai/eval` ships `evalSuite()` + `runSuite()` + 3 metrics + a console reporter. `AiFake` proves your agent's wiring works; evals prove it does the right thing on real models.

- **`evalSuite(name, { agent, cases, timeout? })`** — frozen suite definition. Each case is `{ input, assert: Metric, name?, agent?, timeout?, skip? }`. Per-case `agent` and `timeout` override the suite-level defaults; `skip: true` or `skip: 'reason'` skips without calling the agent.
- **`runSuite(suite)`** — serial runner that walks every case and never throws. Agent errors AND assertion throws become `failed` rows with the message in `reason`. Returns a `SuiteReport` with cases, totals, duration, and cost rollup.
- **Three built-in metrics:** `exactMatch(string)`, `regex(RegExp)`, `llmJudge(criterion, opts?)`. The judge runs as a one-shot anonymous agent (no recursion concern — default `remembers()` is `false`) with `Output.object({ schema })` JSON-mode parsing. Judge token usage rolls into the case's cost via a `Symbol.for('rudderjs.ai.eval.judgeUsage')` side-channel.
- **User-defined metrics** implement `(response, ctx) => MetricResult` — no inheritance, no decorators. The catalog is a starting set, not a closed enum.
- **`reportConsole(report, sink?)`** — default reporter; emits a glyph table (✓/✗/○) with cost + tokens. Returns the report unchanged for chaining.
- **`estimateCost(model, prompt, completion)`** — minimal hardcoded `ModelPricing` subset (Anthropic, OpenAI, Google — the 7 most common models). A6 will ship the full versioned catalog.
- **Subpath `@rudderjs/ai/eval`** — keeps the metrics catalog out of the main runtime entry. No new peer deps; reuses `Output.object` from main entry, `agent()` factory from `agent.ts`.

```ts
// evals/support-agent.eval.ts
import { evalSuite, llmJudge, exactMatch, regex } from '@rudderjs/ai/eval'
import { SupportAgent } from '../app/Agents/SupportAgent.js'

export default evalSuite('SupportAgent', {
  agent: () => new SupportAgent(),
  cases: [
    { name: 'password reset', input: 'How do I reset my password?',
      assert: llmJudge('mentions a password reset link') },
    { name: 'price', input: 'How much?', assert: exactMatch('$99/month') },
    { name: 'support', input: 'Contact?', assert: regex(/support@/) },
  ],
})
```

Run programmatically today via `runSuite()`. Phase 2 adds `pnpm rudder ai:eval` for CLI-driven discovery; Phase 3 adds `jsonShape` / `semanticMatch` / `tokenCost`; Phase 4 adds `--record` / `--replay` + telescope integration; Phase 5 adds an HTML report.

28 new tests covering suite definition validation, every built-in metric (including llmJudge fallbacks for unparseable judge responses + missing judge model), runner ordering / skip / per-case timeout / per-case agent override / agent-error-as-failed-row / assertion-throw-as-failed-row, judge token side-channel cleanup, `estimateCost` for 3 known models + 1 unknown (graceful 0), and the console reporter's glyphs + skip-reason rendering.
