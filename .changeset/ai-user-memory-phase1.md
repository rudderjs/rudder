---
"@rudderjs/ai": minor
---

**A4 Phase 1 — `UserMemory` interface + in-memory backend + DI wiring.** Foundation for per-user memory beyond conversation history (Mem0-style); the auto-inject and auto-extract runtimes land in Phase 2 and 3.

- `UserMemory` interface — `remember()` / `recall()` / `forget()` / `list()` (and optional `forgetAll()` for GDPR cascades). Drop-in alongside `ConversationStore`; backends range from in-process to ORM-backed to embedding-backed.
- `MemoryUserMemory` — in-process Map-backed implementation. Substring-match `recall()` (case-insensitive against fact + tags), tag-intersection filtering, per-user isolation. Ships in the runtime-agnostic main entry — no `node:` imports.
- `Agent.remembers()` — class hook returning `false | RemembersSpec | Promise<…>`. Default `false` (memory-stateless); subclasses opt in by returning `{ user, inject?, extract?, tags?, … }`. Mirrors `Agent.conversational()`.
- `AgentPromptOptions.memory?: false | RemembersSpec` — per-call override with the same precedence chain (per-call > class).
- `AiConfig.memory?: UserMemory` — config key wired by `AiProvider`. Bound to the `ai.memory` DI key and to the module-level `setUserMemory()` registry that Phase 2/3 middleware will consume.
- `resolveRemembersSpec()` — shared resolver used by the upcoming auto-inject middleware. Public re-export so apps reading the spec manually get the same precedence rules.

Phase 1 introduces no runtime behavior change to existing agents — `remembers()` defaults to `false` and nothing in the prompt loop reads the spec yet. Apps can already wire a backend via `AiConfig.memory` and call it manually through `app().make<UserMemory>('ai.memory')`.
