---
"@rudderjs/ai": minor
---

Add a standalone agent run store for `stream()` pauses. `CachedAgentRunStore` / `InMemoryAgentRunStore` (plus `newAgentRunId()` and the `AgentRunState` type) persist the run state of a top-level `agent.stream()` that parks on a client tool or approval gate across an HTTP boundary, so consumers no longer hand-roll cache-backed run persistence. The standalone sibling of `CachedSubAgentRunStore`, with a `store` / `load` (non-destructive peek) / `consume` (atomic single-use) surface and a 5-minute default TTL. Stays runtime-agnostic on the main entry (lazy `@rudderjs/cache` load).
