---
'@rudderjs/ai': patch
---

Fix Anthropic + Bedrock streaming providers clobbering `promptTokens` with 0
on the `finish` chunk. Anthropic's stream protocol splits prompt + completion
token counts across two distinct events — `message_start.message.usage.input_tokens`
carries the prompt count, `message_delta.usage.output_tokens` carries the
completion count. The providers were emitting `promptTokens: 0` on the
`finish` chunk derived from `message_delta`, and the agent loop's last-wins
usage aggregation then overwrote the correct earlier value from
`message_start`. Result: any streamed call reported `AgentResponse.usage.promptTokens === 0`.

Impact:

- Consumers billing on input tokens silently undercharged for streamed calls
  (non-streaming `.prompt()` was unaffected — it reads `input_tokens` directly).
- `withBudget()` middleware silently over-allowed streamed requests — the
  true-up step subtracted the estimated input cost but never added the real
  one back, so per-user budget caps were under-enforced.

Surfaced 2026-05-19 by pilotiq-io's meta-model gateway smoke test, which
asserts `inputTokens > 0` on every Phase B call.

What changes:

- `providers/anthropic.ts`: stream loop now threads `lastPromptTokens` from
  `message_start` into the `message_delta` → `finish` chunk so the usage
  object is complete.
- `providers/bedrock.ts`: same fix; Bedrock-Anthropic streams use the
  identical event protocol. `mapBedrockAnthropicEvent` now takes a
  `BedrockStreamState` parameter to carry the prompt count across events.
- `agent.ts`: stream-loop usage aggregation switches from last-wins to MAX
  per field (`mergeUsage`). Defensive layer — prevents this class of bug
  if any future provider emits multi-chunk usage with under-reported later
  values. Safe because every chunk is a running snapshot, not a delta.
- The `usage` chunk from `message_start` no longer claims a `totalTokens`
  that mixes the (final) prompt count with a stale `output_tokens: 0`. The
  authoritative final total is on the `finish` chunk.

No public API change. The `mapBedrockAnthropicEvent` signature is an
internal helper (its `state` parameter is `BedrockStreamState`, also exported
as a type for consumers calling it directly in tests).
