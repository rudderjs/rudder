---
'@rudderjs/ai': patch
---

fix(ai): OpenAI parallel tool-call args by index + resume-approval placeholder synthesis

Two streaming-shaped fixes from the 2026-05-21 code review (`docs/plans/2026-05-21-framework-ai-protocol-fixes.md`, Phases 2 + 5). Both are silent corruption bugs — the type system can't catch wire-state issues.

**Phase 2 — OpenAI parallel tool-call arg-delta tracking**

The agent loop tracked stream partials in a single `Map<id, partial>` keyed by call id, and routed arg-only deltas to "the last partial in insertion order." When OpenAI streams ≥2 parallel tool calls interleaved by `index`, the second tool's start-delta becomes the most recent insert, so subsequent arg fragments for the first tool land on the second tool's partial (and vice versa). `JSON.parse` then either fails silently → `{}` args, or succeeds with truncated-but-parseable JSON → wrong args.

Fix:
1. Add `toolCallIndex?: number` to `StreamChunk`. Optional — adapters whose tool calls arrive whole per block (Anthropic, Google) don't set it.
2. OpenAI adapter passes `tc.index` through on both the start-delta and arg-only deltas.
3. Agent loop keeps a parallel `partialsByIndex` map; arg-deltas route via index when present, fall back to the legacy last-insertion behavior when absent (back-compat for non-OpenAI streaming providers). Partials live in both maps by reference — no extra finalization work.

**Phase 5 — resume-approval orphan `tool_use` synthesis**

`resumePendingToolCalls` iterated an assistant's pending `toolCalls`, executed approved ones, and `break`'d on the first `'pending'` decision — leaving every subsequent tool call without a matching `tool` message. Anthropic specifically rejects the next request because every `tool_use` block must be followed by a `tool_result`.

Fix: when `break`ing on `'pending'`, synthesize placeholder `tool` messages for this call AND every still-unresolved sibling, marked with `_pending: true` (new `@internal` field on `AiMessage`). On the next resume, the function strips trailing placeholders, finds the parent assistant message (which is now buried under real + placeholder tool messages from prior resumes), skips tool calls already resolved (their non-`_pending` tool messages are still there), and re-walks. Multi-step approval flows can now make any number of partial-approval round-trips without 400ing Anthropic.

**Tests** — `src/streaming-and-approval-fixes.test.ts`, 5 specs:
- Parallel tool-call args interleaved by index don't cross-contaminate
- Back-compat: `toolCallIndex`-less adapters keep the legacy last-insertion routing
- Placeholders synthesized for every unresolved sibling on partial approval
- Placeholders stripped + re-walked on resume without double-executing approved tools
- Anthropic invariant: every `tool_use` in the parent assistant has a matching tool message after partial approval

Verified: 839 AI tests pass; `orm-prisma`, `orm-drizzle`, `telescope` typecheck clean.
