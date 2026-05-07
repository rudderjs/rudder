---
'@rudderjs/ai': minor
---

Run multiple tool calls within a single agent step concurrently. When the model emits >1 tool call in one step, their `execute()` functions now run in parallel by default; the streamed chunk order is preserved as `tool-call A → updates A → tool-result A → tool-call B → ...` so consumers see deterministic sequences regardless of which tool finishes first. Approval gates, client-tool pauses, and `onBeforeToolCall` middleware decisions still resolve serially in tool-call order *before* any `execute()` runs, matching the prior single-tool semantics.

Opt out per call (`prompt('…', { parallelTools: false })`) or per agent (override `parallelTools()` to return `false`) when tools share non-idempotent state — counters, file writes, sequential transactions. Single-tool batches always route through the serial path so live `tool-update` streaming for the one tool is unchanged.
