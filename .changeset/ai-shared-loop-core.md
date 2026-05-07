---
'@rudderjs/ai': patch
---

Refactor the agent loop: extract shared helpers (`initializeLoop`, `runIterationPrelude`, `runFailover`, `executeToolPhase`, `emitObserverFailed`, `emitObserverCompleted`, `buildAgentResponse`) so `prompt()` and `stream()` share one orchestration path. The two outer functions are now thin wrappers — `prompt()` is ~70 lines, `stream()` ~160 lines (the rest is streaming-specific chunk processing). Pure refactor: zero behavior change, all 122 tests green, observer event payloads / message ordering / abort semantics / stream chunk sequence preserved byte-for-byte. Internal cleanup only — no public API surface changes.
