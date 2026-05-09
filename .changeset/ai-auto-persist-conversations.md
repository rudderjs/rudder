---
'@rudderjs/ai': minor
---

Auto-persist conversation behavior (B3):

`Agent.conversational()` lets a chat-style agent class opt into automatic conversation persistence — `agent.prompt(input)` then auto-loads the user's thread, runs, and auto-saves the new turn without each caller having to call `forUser()` / `continue()`. Inspired by Laravel's `RemembersConversations` trait.

```ts
class ChatAgent extends Agent {
  conversational() { return { user: Auth.user()?.id } }
}
await new ChatAgent().prompt('Hi')          // auto-loads + auto-saves
await new ChatAgent().prompt('still you?')  // resumes the same thread
```

The hook returns `false | ConversationalSpec | Promise<...>` — async returns are awaited (useful when the user identity comes from an async DI binding). Optional `historyLimit` caps loaded messages for long-running threads. Each `(user, agent class)` pair gets its own thread, so a `ChatAgent` and a `SupportAgent` for the same user don't cross-contaminate; override the segregation key with `agent: 'custom'` if you ever rename the class.

Per-call escape hatches:
- `prompt(input, { conversation: false })` — opt out for one call.
- `prompt(input, { conversation: { user, id?, ... } })` — replace the class declaration for this call.
- `agent.forUser(id)` / `agent.continue(id)` — explicit form always wins.

Internals: a new `runWithPersistence` / `runWithPersistenceStreaming` helper at `packages/ai/src/conversation-persistence.ts` is the single load/append code path; the existing `ConversableAgent` (returned by `forUser` / `continue`) now routes through it instead of duplicating logic. `ConversationStoreMeta` gains an optional `agent?: string` for per-class segregation; `MemoryConversationStore.list()` now correctly filters by `userId` and surfaces the `agent` key. Existing custom stores keep working unchanged — they'll just always create new threads (the conservative behavior) until they start surfacing the `agent` field in `list()`.
