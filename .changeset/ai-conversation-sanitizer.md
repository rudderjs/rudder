---
"@rudderjs/ai": minor
---

Add `sanitizeConversation()` and apply it in `OrmConversationStore.load()` so persisted histories are replay-safe.

A conversation interrupted mid-turn (a crash after the assistant message persisted but before all of its tool-result rows landed) leaves a malformed graph in the store. Replaying it 400s: Anthropic rejects a dangling `tool_use` with no matching `tool_result`, and OpenAI-compatible providers (DeepSeek, OpenRouter, Azure) reject an orphan `role:'tool'` not preceded by `tool_calls`.

`sanitizeConversation(messages)` walks the history and enforces the tool-call / tool-result invariant in both directions: complete tool turns are kept (results re-emitted in `toolCalls` order, one per call, extras dropped), dangling turns have their `toolCalls` stripped while preserving any text, and orphan tool results are dropped. It is pure and idempotent. `OrmConversationStore.load()` now applies it automatically; a custom `ConversationStore` can call the exported function from its own `load()`.
