# Auto-persist conversation behavior (B3)

**Status:** design — pre-implementation. Roadmap reference: `docs/plans/2026-05-09-ai-roadmap.md` §B3.

---

## Why

`forUser(userId)` and `continue(conversationId)` already exist on `Agent`. They produce a `ConversableAgent` that wraps load → run → append around the inner loop. The plumbing works, but every caller has to remember to opt in:

```ts
const r = await new ChatAgent().forUser(req.user.id).prompt('Hi')
//                              ^ forget this and the turn is silently lost
```

The failure mode — "history-loss until somebody notices" — is the worst kind. Laravel's `RemembersConversations` style (declare once on the class, then plain `prompt()` works) removes the footgun.

## Goals

- Class-level opt-in so `agent.prompt(input)` auto-loads + auto-saves without each caller threading a userId through.
- Continue working in queue jobs and CLI commands, not just HTTP.
- Preserve the explicit form: `agent.forUser(id).prompt()` and `agent.continue(id).prompt()` still win when present.
- No mandatory dep on `@rudderjs/auth` — agents declare their own user identity source.

## Non-goals

- **Cross-conversation memory** (extracted facts, summaries) — that's A4 (User memory beyond conversation history). Different problem, different surface.
- **Conversation listing / management UI** — separate (panels integration).
- **Auto-titling** — optional, can layer in later via the `setTitle` hook on `ConversationStore`.

---

## Existing code path (anchor before changing)

- `Agent.prompt()` (`packages/ai/src/agent.ts:151`) → `runAgentLoop(this, input, options)`.
- `Agent.stream()` (`packages/ai/src/agent.ts:156`) → `runAgentLoopStreaming(this, input, options)`.
- `Agent.forUser(id)` (`packages/ai/src/agent.ts:166`) → `new ConversableAgent(this).forUser(id)`.
- `ConversableAgent.prompt()` (`agent.ts:258`) does `store.load → runAgentLoop → store.append`. `ConversableAgent.stream()` is the streaming twin.
- `ConversationStore` interface lives at `packages/ai/src/types.ts`; default impl `MemoryConversationStore` at `packages/ai/src/conversation.ts`.
- Resolver: `resolveConversationStore()` in `agent.ts` reads the registered global instance set via `setConversationStore()` or via `AiProvider`'s `ai.conversations` DI binding.

The existing `ConversableAgent` already does exactly what auto-persist needs. The work is **lifting that flow into `Agent.prompt`/`stream` when the agent class opts in**, not building a parallel implementation.

---

## Surface options

### Option A — static class flag

```ts
class ChatAgent extends Agent {
  static remembersConversations = true
  user(): string { return ctx().user.id }   // user-supplied ALS shim
}
```

**Pros:** zero-runtime decision, easy to grep for. **Cons:** `static` doesn't compose well across inheritance; if a subclass forgets to redeclare, `Agent.remembersConversations` lookups still resolve via the parent (which is the desired behavior here, but easy to misread).

### Option B — instance method

```ts
class ChatAgent extends Agent {
  remembersConversations(): boolean { return true }
  user(): string { return ctx().user.id }
}
```

**Pros:** lets the agent return a dynamic decision (e.g. only persist authenticated users — `return ctx().user != null`). **Cons:** one more method to override.

### Option C — combined `conversational()` shape

```ts
class ChatAgent extends Agent {
  conversational(): { user: string; id?: string } | false {
    const u = ctx().user
    return u ? { user: u.id } : false
  }
}
```

Returns `false` to opt out per-call (e.g. anonymous user); returns the user id (and optionally a thread id) to opt in. Subsumes A + B.

**Recommendation: C.** Single hook, returns enough info to drive both load and save in one place. Default `Agent.conversational()` returns `false` (current behavior unchanged). Maps cleanly to the existing `ConversableAgent` flow.

---

## ALS / `ctx()` strategy

Today there's no framework-wide `ctx()` helper. `auth-manager.ts` has its own ALS for `Auth::user()`. Queue jobs run inside `runScoped()` from `@rudderjs/core`'s container — they get scoped DI but no auth context unless someone wired it.

**Decision: don't ship a new `ctx()` global.** Make `conversational()` the user's responsibility — they decide where the user id comes from. Document the typical shapes:

```ts
// HTTP
conversational() { return { user: Auth.user()?.id }  /* @rudderjs/auth */ }

// Queue job
conversational() { return { user: this.context?.userId } }

// CLI
conversational() { return { user: 'cli' } }
```

This keeps `@rudderjs/ai` runtime-agnostic and avoids leaking a new global. It costs the user a one-line override; that line is the explicit hand-off documenting *which* identity matters in *this* runtime.

If a future refactor introduces a real framework-wide `ctx()`, agents can switch to it without an API break.

---

## Thread-resolution semantics

When `conversational()` returns `{ user: 'u-1' }` (no `id`), what thread does the prompt land in?

- **Always create a new thread** — every `prompt()` call starts fresh. Simple, but defeats the point.
- **Re-use the most-recent thread for the user** — closest to "ChatGPT's default UX." Requires `ConversationStore.list(userId)` (already in the interface) + a "most-recent" query.
- **Re-use a single 'current' thread per agent + user** — requires a tagging convention (`store.create(title, { userId, agentClass: 'ChatAgent' })`).

**Recommendation: most-recent for the user + agent class** — agent identity included in the lookup so two agents on the same user (e.g. `ChatAgent` + `SupportAgent`) keep separate threads. Implementation: `ConversationStoreMeta` already supports `userId`; add `agent?: string` (the class name) and have `list()` filter by it. Backwards-compatible — existing stores ignore unknown fields.

When `conversational()` returns `{ user, id: 'specific-id' }`, the explicit id always wins.

---

## Loop integration

Lift the existing `ConversableAgent` flow into `runAgentLoop` / `runAgentLoopStreaming` as a preamble + epilogue:

```ts
// Pseudo
async function runAgentLoop(agent, input, options) {
  const conv = await resolveConversational(agent, options)  // returns null or { id, store }
  if (conv) {
    options = { ...options, history: [...(await conv.store.load(conv.id)), ...(options.history ?? [])] }
  }

  const response = await runInnerLoop(agent, input, options)

  if (conv) {
    await conv.store.append(conv.id, [{ role: 'user', content: input }, ...messagesFromSteps(response.steps)])
    response.conversationId = conv.id
  }

  return response
}
```

`resolveConversational` precedence:
1. Per-call `options.conversation: { user?, id? } | false` override (new `AgentPromptOptions` field).
2. Existing `ConversableAgent` state (`forUser`/`continue`) — already calls `runAgentLoop` directly today.
3. Agent's `conversational()` declaration.
4. Else `null` (no persistence — current behavior).

Concretely: `ConversableAgent` becomes the explicit-form sugar, and the auto-form just routes through the same hook. Both forms share one persistence path — no duplicated load/append code.

## Open design questions

_All resolved 2026-05-09 (review pass 1). See "Resolved questions" at the bottom._

---

## Test plan

In-process tests with `MemoryConversationStore`:

1. Class with `conversational(): false` (or absent) — `prompt()` does **not** call store. Current behavior preserved.
2. Class with `conversational() => { user: 'u-1' }` — first `prompt()` creates a thread; second `prompt()` resumes the same thread (most-recent lookup).
3. Two different agent classes for the same user — distinct threads.
4. Streaming variant: same auto-load/auto-save behavior, deltas still flow.
5. Per-call override: `prompt(input, { conversation: false })` skips persistence even when class opts in.
6. `agent.forUser('explicit').prompt()` overrides `conversational()`'s user.
7. `agent.continue(id).prompt()` overrides both — picks up exactly that thread regardless of class declaration.
8. No store registered + class opts in → clear error (don't silently no-op).
9. `conversational()` returns `Promise<{ user }>` — supported.

No live API calls — all tests use the existing `AiFake` + `MemoryConversationStore`.

---

## Estimated scope

~250 LOC in `@rudderjs/ai` + 8 tests + docs:

- Add `conversational()` method to `Agent` base + `AgentPromptOptions.conversation` per-call override (~10 LOC types + 5 LOC default).
- Lift load/append from `ConversableAgent` into a shared `withConversationPersistence(loop, agent, input, options)` helper (~80 LOC). Both `ConversableAgent.prompt` and `runAgentLoop` route through it.
- Most-recent-thread lookup in `ConversationStore.list()` filter helper (~30 LOC, including the `agent` meta field).
- Tests (~120 LOC).
- README + `docs/guide/ai.md` + `boost/guidelines.md` updates.

Estimate: ~3 days, matching the roadmap. Risk concentrates in Q3/Q4 — happy to defer the agent-key axis (Q4) to a follow-up if that keeps the PR small.

---

## Out of scope

- A4 (extracted user memory / facts) — different problem.
- Auto-titling on first reply — easy follow-up, not core.
- Sliding-window truncation — separate middleware concern.
- Cross-process / distributed conversation locking — same-user concurrent prompts on different workers can race; document, don't fix in v1.

---

## Resolved questions

**Resolved 2026-05-09 (review pass 1):**

- ✅ **Q1 — async `conversational()`.** Decision: **support both**. Final signature:
  ```ts
  conversational(): false | ConversationalSpec | Promise<false | ConversationalSpec>
  type ConversationalSpec = { user: string; id?: string; agent?: string; historyLimit?: number }
  ```
  The loop preamble awaits the result; sync overrides return synchronously without overhead.

- ✅ **Q2 — history truncation.** Decision: **opt-in via `historyLimit?: number` on the return shape**, default unbounded (matches today's `ConversableAgent`). When set, the loop preamble caps the loaded history to the last N messages (`history.slice(-N)`) before merging with `options.history`. Token-aware trimming and summarization remain a separate middleware concern (revisit when A4 lands).
  ```ts
  class ChatAgent extends Agent {
    conversational() { return { user: ctx().user.id, historyLimit: 50 } }
  }
  ```

- ✅ **Q3 — `forUser`/`continue` precedence.** Decision: **explicit wins**. `forUser('x').prompt()` and `continue('id').prompt()` shadow-override `conversational()`'s `user` / `id` fields respectively. Document the precedence chain explicitly: per-call `options.conversation` → `ConversableAgent` state → `conversational()` → none.

- ✅ **Q4 — thread-segregation key.** Decision: **default to class name; user can override via `agent` field on the return shape**. The `ConversationStoreMeta` gets a new optional `agent?: string` field; `store.list(userId)` filters by it when looking up the most-recent thread. Existing stores ignore the field, preserving back-compat.
  ```ts
  conversational() { return { user, agent: 'chat-v2' } }   // rename-safe override
  ```
