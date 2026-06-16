# Custom Gateway Provider

`@rudderjs/ai` talks to LLM providers through a single contract — `ProviderAdapter`, with two methods, `generate()` and `stream()`. Most providers ship in the box. When you put a **gateway** in front of them (a proxy that adds routing, billing, caching, or org-wide policy), you have two paths, and picking the right one matters.

## First: do you even need a custom adapter?

If your gateway speaks a **wire format the framework already knows**, you don't write any code — you point an existing driver at it with `baseUrl`:

```ts
// config/ai.ts — an OpenAI-compatible gateway (LiteLLM, Helicone,
// Cloudflare AI Gateway, OpenRouter, Portkey, ...)
providers: {
  gateway: {
    driver:  'openai',                       // reuse the OpenAI wire format
    apiKey:  Env.get('GATEWAY_API_KEY', ''),
    baseUrl: 'https://gateway.internal/v1',  // ...just change where it points
  },
}
```

The same trick works for an Anthropic-compatible gateway (`driver: 'anthropic'`, `baseUrl`). The built-in `deepseek`, `groq`, `xai`, `openrouter`, and `ollama` drivers are themselves nothing more than the OpenAI adapter with a different base URL.

**Reach for the template below only when your gateway's request/response/SSE envelope matches no built-in provider** — its own auth scheme, its own JSON shape, its own streaming events.

## The template — `HttpGatewayAdapter`

`@rudderjs/ai/gateway` ships an abstract base class that owns all the boilerplate — `fetch`, JSON decoding, SSE framing, `AbortSignal` wiring, and HTTP error mapping — and leaves you four hooks for the parts that are actually gateway-specific. It is the same custom-driver pattern Laravel uses for mail transports, notification channels, and broadcast drivers: subclass an abstract transport, fill the gaps, register it.

```ts
import {
  HttpGatewayAdapter,
  type GatewayRequestContext,
  type SseEvent,
} from '@rudderjs/ai/gateway'
import type {
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
} from '@rudderjs/ai'

class AcmeGatewayAdapter extends HttpGatewayAdapter {
  // 1. Auth scheme — headers added to every request.
  protected buildHeaders() {
    return { authorization: `Bearer ${this.config.apiKey}` }
  }

  // 2. Request envelope — map the framework request to your gateway's body.
  //    `ctx.stream` tells you which path you're on.
  protected buildRequestBody(o: ProviderRequestOptions, ctx: GatewayRequestContext) {
    return { model: this.model, messages: o.messages, stream: ctx.stream }
  }

  // 3. Response envelope — map a complete response back to ProviderResponse.
  protected parseResponse(json: unknown): ProviderResponse {
    const j = json as { text: string; usage: { in: number; out: number } }
    return {
      message:      { role: 'assistant', content: j.text },
      usage:        { promptTokens: j.usage.in, completionTokens: j.usage.out, totalTokens: j.usage.in + j.usage.out },
      finishReason: 'stop',
    }
  }

  // 4. Stream events — map one SSE frame to zero or more StreamChunks.
  protected parseStreamEvent(e: SseEvent): StreamChunk[] {
    if (e.data === '[DONE]') return [{ type: 'finish', finishReason: 'stop' }]
    const { delta } = JSON.parse(e.data) as { delta?: string }
    return delta ? [{ type: 'text-delta', text: delta }] : []
  }
}
```

That's the whole adapter. The base class handles the rest.

### What the base class does for you

| Concern | Handled by |
|---|---|
| POST + JSON serialization | `generate()` / `stream()` |
| `Content-Type` / `Accept` headers | merged automatically (`text/event-stream` on the stream path) |
| `AbortSignal` forwarding + clean stream cancellation | wired through `fetch` and the SSE reader |
| `text/event-stream` framing (multi-line `data:`, `\r\n`, events split across reads) | `parseSseStream` |
| Non-2xx → readable `Error` with status + body | `onErrorResponse` (overridable) |

### Optional overrides

Two concrete methods have sensible defaults you can override:

- **`endpoint(ctx)`** — the request URL. Defaults to `config.baseUrl`; override to append a path or branch on `ctx.stream` (e.g. a separate `/stream` endpoint).
- **`onErrorResponse(res)`** — error mapping. Override to parse your gateway's error envelope instead of the default text body.

## Register it

A gateway adapter is registered the same way as any provider — through a `ProviderFactory` and `AiRegistry.register()` (the framework's `extend()` equivalent), typically from a service provider's `boot()`:

```ts
import { AiRegistry } from '@rudderjs/ai'

AiRegistry.register({
  name: 'acme-gateway',
  create: (model) => new AcmeGatewayAdapter(
    { baseUrl: Env.get('ACME_GATEWAY_URL'), apiKey: Env.get('ACME_GATEWAY_KEY') },
    model,
  ),
})
```

Agents then select it with the usual `provider/model` string: `model() { return 'acme-gateway/some-model' }`.

## Raw SSE framing

If you need the framing without the adapter (a non-chat endpoint, a custom transport), `parseSseStream` is exported on its own:

```ts
import { parseSseStream } from '@rudderjs/ai/gateway'

for await (const event of parseSseStream(response.body, signal)) {
  console.log(event.event, event.data)
}
```

It's runtime-agnostic (any `fetch`-capable runtime — Node, browser, RN, Electron) and has no `node:` dependencies.

> **Security:** a gateway adapter calls out with your gateway credentials. As with any provider, keep that on the server — calling it directly from a browser or React Native client leaks the key.
