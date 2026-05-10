---
"@rudderjs/ai": minor
---

**A4 Phase 3 — auto-extract middleware for user memory.** `Agent.remembers().extract === 'auto'` (with an `extractWith` model) now distills durable facts from each successful turn and writes them via `mem.remember()` — the third piece of the runtime that the Phase 1 declaration promised.

- `withMemoryExtract(spec, opts?)` — exported `AiMiddleware` factory. Runs in `onFinish` (only fires on successful runs, so failed turns don't pollute memory). Pulls the latest `[user, assistant]` turn from `ctx.messages`, calls a one-shot anonymous agent on the small model (`spec.extractWith`) with an `Output.object({ schema })` prompt asking for `{ facts: [{ fact, score, tags? }] }`, filters by confidence threshold, unions `spec.tags` into each entry, and writes via `mem.remember()`.
- **Auto-cascade extension** — the existing memory cascade in `Agent.prompt` / `Agent.stream` now installs both inject (Phase 2) AND extract (Phase 3) middlewares when each is opted in. Continuation calls (`options.messages` set) skip BOTH so the same facts aren't double-written across tool round-trips.
- **Confidence threshold** — `MemoryExtractOptions.threshold` defaults to `0.7`; facts below the floor are dropped before any `remember()` call. Tighten for high-risk domains; this is the v1 mitigation for the memory-poisoning pitfall.
- **Audit hook** — `MemoryExtractOptions.onExtracted(entries)` fires after a successful write with the persisted entries. Use it to stream into telescope, write an audit log, or assert in tests.
- **Failure swallow** — extract errors (network, JSON parse, zod validation, `remember()` throw) route through `MemoryExtractOptions.onError` and are otherwise swallowed. The parent prompt never breaks because of memory work.

```ts
class SupportAgent extends Agent {
  remembers() {
    return {
      user:        'user_123',
      inject:      'auto',
      extract:     'auto',
      extractWith: 'anthropic/claude-haiku-4-5',
      tags:        ['support'],
    }
  }
}

// On success, durable facts get distilled and written. The next turn
// will see them via auto-inject's recall.
await new SupportAgent().prompt('hi, my project Foo lives at /var/www/foo')
```
