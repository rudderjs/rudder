---
"@rudderjs/ai": minor
---

**A4 Phase 2 — auto-inject middleware for user memory.** `Agent.remembers().inject === 'auto'` now actually injects facts; the declaration shipped in Phase 1 finally has a runtime.

- `withMemoryInject(spec, opts?)` — exported `AiMiddleware` factory. Runs in `onStart` (async, so `recall()` can await), reads the latest user message from `ctx.messages`, calls `mem.recall(spec.user, userText, { limit, tags })`, renders matched facts as a fenced `<user-memory>…</user-memory>` block, and prepends them to the system message in place. Skips silently when no `UserMemory` is registered, no facts match, or the budget can't fit even one entry.
- **Auto-cascade** — when `Agent.remembers()` returns `{ inject: 'auto', … }`, `Agent.prompt()` / `Agent.stream()` install `withMemoryInject` automatically before the loop runs. Continuation calls (`options.messages` set) skip injection so the system prompt isn't double-augmented across tool round-trips. Sync fast path preserved when both `conversational()` and `remembers()` declare nothing.
- **Token-budget enforcement** — `spec.injectTokenBudget` drops lowest-score facts first (undefined scores treated as 0.5). Default `~4 chars/token` estimator; override via `MemoryInjectOptions.estimateTokens`.
- **Recall improvement (Phase 1 carryover)** — `MemoryUserMemory.recall()` switches from naive substring match to **case-insensitive token overlap** (≥3-char tokens, alphanumeric split). Natural-language queries like "what is my project?" now pull facts containing "project" without forcing the caller to extract keywords. The Phase 1 single-word recall test continues to pass; the change is strictly more lenient.
- **Internal: `Symbol.for('rudderjs.ai.extraMiddlewares')` slot on options** — the auto-cascade plumbs framework-injected middlewares through this hidden slot so `getMiddleware(a, options)` can append them after `agent.middleware()` without polluting `AgentPromptOptions`'s public surface. Phase 3 (auto-extract) will reuse the slot.

```ts
class SupportAgent extends Agent {
  remembers() {
    return {
      user: 'user_123',
      inject: 'auto',
      tags: ['support'],
      injectLimit: 5,
      injectTokenBudget: 400,
    }
  }
}

// Recall fires before each model call; the matching facts get
// prepended to the system message as a `<user-memory>` block.
await new SupportAgent().prompt('Where does my project deploy?')
```
