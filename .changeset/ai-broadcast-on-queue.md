---
"@rudderjs/ai": minor
---

**B6 — `.broadcast(channel)` on queued prompts.** Background AI work + live UI without polling. Closes a Laravel parity gap.

`QueuedPromptBuilder` (returned by `agent.queue(input)`) gains a new `.broadcast(channel, opts?)` method. When set, the queued job uses `agent.stream()` instead of `prompt()` and pushes each `StreamChunk` to the channel via `@rudderjs/broadcast`:

```ts
await new SupportAgent()
  .queue('Help with refund request')
  .broadcast(`user.${userId}.support`)
  .send()

// Subscribers receive: { event: 'chunk', data: <StreamChunk> } per chunk,
// then { event: 'done', data: <AgentResponse> } at completion,
// or { event: 'error', data: { message } } on failure.
```

- Optional `eventPrefix` namespaces events (e.g. `agent.chunk` / `agent.done` / `agent.error`)
- `@rudderjs/broadcast` is loaded lazily — only required when `.broadcast()` is called
- Process-model caveat: `broadcast()` writes to in-process WS state. The typical RudderJS dev setup (single process running web + `queue:work`) works out of the box. Cross-process workers will need a pub/sub bridge (Redis, Reverb, etc.) — not in v1
