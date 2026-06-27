---
"@rudderjs/ai": patch
---

Inline the `/server` provider and the `make:agent` / `ai:eval` CLI commands instead of re-exporting them from `@gemstack/ai-sdk`.

These are Rudder-coupled bindings (`AiProvider` reads `config('ai')` via `@rudderjs/core`; `make:agent` needs `@rudderjs/console`'s `MakeSpec`; `ai:eval` reads config + registers on the Rudder runner) that did not belong in the framework-agnostic engine. They now hold real implementations here, consuming the engine's public API from `@gemstack/ai-sdk` (the `GoogleCacheRegistry` class and the eval `defaultFixturesDir` / `readFixture` / `writeFixture` helpers, both published in `@gemstack/ai-sdk@0.4.0`). The `@gemstack/ai-sdk` dependency is bumped to `^0.4.0`.

No public API change: `AiProvider` (`./server`), `makeAgentSpec` (`./commands/make-agent`), and `registerAiEvalCommand` (`./commands/ai-eval`) keep the same names and behavior.
