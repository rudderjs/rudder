---
"@rudderjs/ai": minor
---

Add `@rudderjs/ai/gateway` — an abstract template for normalizing an upstream LLM gateway behind the `ProviderAdapter` contract.

`HttpGatewayAdapter` is the Laravel custom-driver pattern (Template Method) for AI providers: the base class owns the reusable lifecycle — `fetch`, JSON / SSE handling, `AbortSignal` wiring, and error mapping — and leaves four `protected` hooks for the gateway's wire format (`buildHeaders`, `buildRequestBody`, `parseResponse`, `parseStreamEvent`). Subclass it, then register via the usual `AiRegistry.register()` path (the framework's `extend()` equivalent).

Reach for this only when the gateway's wire format matches no built-in provider. An OpenAI- or Anthropic-compatible gateway needs no subclass — register the `openai` / `anthropic` driver with a `baseUrl` override instead.

The subpath also exports `parseSseStream(body, signal)` + `SseEvent` for adapters that need raw `text/event-stream` framing. Runtime-agnostic (any `fetch`-capable runtime; no `node:` imports).
