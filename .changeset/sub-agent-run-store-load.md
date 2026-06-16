---
'@rudderjs/ai': minor
---

feat(ai): non-destructive `load()` on `SubAgentRunStore`

`SubAgentRunStore` gains an optional `load(subRunId)` that reads a paused sub-agent snapshot without deleting it, alongside the existing atomic `consume()`. Both reference implementations (`InMemorySubAgentRunStore`, `CachedSubAgentRunStore`) implement it.

This is for hosts that need a validate-then-resume pre-flight: inspect a paused snapshot's `meta` (per-user / per-resource ownership, tool-result coverage) before handing the id to `Agent.resumeAsTool` / `resumeManyAsTool`, which own the single `consume`. Previously a host had to `consume` then re-`store` to peek, because the resume path consumes internally. `load` removes that round-trip.

Additive and non-breaking: `load` is optional on the interface, so existing custom `SubAgentRunStore` implementations are unaffected, and the resume paths are unchanged (still `consume`). Mirrors the sibling `AgentRunStore.load`.
