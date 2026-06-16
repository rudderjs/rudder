# AI gateway ProviderAdapter template (`@rudderjs/ai/gateway`)

**Status:** OPEN 2026-06-16
**Issue:** #1168 (deferred from epic #1143, downstream `@pilotiq-pro` audit #2)
**Scope:** `@rudderjs/ai` — new subpath `@rudderjs/ai/gateway`; light refactor of inline SSE framing in `packages/ai/src/providers/openai.ts` / `anthropic.ts`
**Source:** `@pilotiq-pro/internal/pilotiq-gateway.ts`, audit 2026-06-15
**Severity:** p2, minor (new opt-in surface; no behavior change for existing apps)

---

## Gap

`@pilotiq-pro` hand-rolls a gateway `ProviderAdapter` to normalize an upstream LLM gateway (its own auth scheme + request/response/SSE envelope) behind the framework's `ProviderAdapter` interface. The framework ships no reusable template for a gateway whose wire format matches no built-in provider, so any downstream consumer in that position reimplements the same fetch + SSE + abort + error-mapping plumbing from scratch.

---

## Validation verdict (the gate this issue was filed behind)

The issue blocked on one question: **is the generic shape tied to pilotiq.io, or does it stand on its own?**

**Verdict: it stands on its own — as an *abstract template*, not a concrete adapter.** The pilotiq-specific bits (auth header, routing, JSON envelope, SSE event shape) are exactly the parts that become *subclass hooks*; none of them enter framework code.

Evidence from the existing package:

- The contract is already minimal and clean — `packages/ai/src/types.ts:257`:
  ```ts
  export interface ProviderAdapter {
    generate(options: ProviderRequestOptions): Promise<ProviderResponse>
    stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk>
  }
  ```
- The framework **already covers the easy gateway cases** and does not need a template for them:
  - **OpenAI-compatible gateways** (LiteLLM, Helicone, Cloudflare AI Gateway, OpenRouter, Groq, DeepSeek, xAI) → reuse `OpenAIAdapter` + a `baseUrl` override. `deepseek.ts` / `groq.ts` / `xai.ts` / `openrouter.ts` are each ~30-line delegations to `OpenAIAdapter`.
  - **Anthropic-compatible gateways** → `AnthropicAdapter` + `baseUrl`.
- The **only uncovered case** is a gateway with a **non-standard envelope + auth** that matches no built-in provider. That is precisely what pilotiq hand-rolled, and it generalizes: the reusable contribution is the HTTP/SSE/abort/error skeleton; the envelope mapping is the per-gateway part.

Conclusion: ship the skeleton as an abstract base class with four abstract hooks. Provider-agnostic by construction.

---

## Design — the Laravel custom-driver pattern

This is Laravel's Template Method idiom (custom Mail transports extend `AbstractTransport` and implement `doSend()`; custom Notification channels implement `send()`; custom Broadcast drivers subclass and register). The framework already owns the *manager* half of that pattern: `AiRegistry.register(factory)` is the `extend()` equivalent.

Three pieces, mirroring the Laravel shape:

1. **Contract** — `ProviderAdapter` (exists, unchanged).
2. **Abstract template** — `HttpGatewayAdapter implements ProviderAdapter` (the `AbstractTransport` analogue). Owns the reusable lifecycle; leaves four `protected abstract` hooks:
   ```ts
   export interface GatewayAdapterConfig {
     baseUrl: string
     apiKey?: string | undefined
     headers?: Record<string, string> | undefined
   }

   export interface SseEvent {
     event?: string | undefined
     data: string
   }

   export abstract class HttpGatewayAdapter implements ProviderAdapter {
     constructor(protected readonly config: GatewayAdapterConfig, protected readonly model: string) {}

     // --- reusable plumbing (concrete) ---
     //   generate(): POST JSON, wire options.signal, map non-2xx → AiError, call parseResponse
     //   stream():   POST, frame the SSE body, wire options.signal, call parseStreamEvent per event

     // --- the four provider-specific hooks (abstract) ---
     protected abstract buildHeaders(): Record<string, string>
     protected abstract buildRequestBody(options: ProviderRequestOptions): unknown
     protected abstract parseResponse(json: unknown): ProviderResponse
     protected abstract parseStreamEvent(event: SseEvent): StreamChunk[]
   }
   ```
3. **Registration** — downstream writes a ~40-line subclass filling the four hooks plus a tiny `ProviderFactory`, then registers via the existing `AiRegistry.register()` path. No framework change needed to wire it.

Subpath: **`@rudderjs/ai/gateway`** (new entry in `package.json` `exports`). Kept out of the main entry so the template is opt-in and the main entry stays lean.

---

## Work breakdown (one PR = one changeset)

1. **`packages/ai/src/gateway/http-gateway-adapter.ts`** — the abstract class + `GatewayAdapterConfig` / `SseEvent` types + the concrete `generate` / `stream` plumbing.
2. **Self-contained SSE framer** — the template ships its own `parseSseStream(body, signal)` async-generator helper. Investigation confirmed every built-in chat provider streams through a vendor SDK (`openai`, `@anthropic-ai/sdk`, `@google/genai`), so there is **no existing raw-fetch SSE chat framer to extract** and no provider to refactor. Zero blast radius.
3. **`packages/ai/src/gateway/index.ts`** + `./gateway` export in `package.json`.
4. **Reference subclass in tests** — an `ExampleEchoGatewayAdapter` against a fake `fetch`, proving generate + stream + abort + error mapping end to end. Not exported; it is the template's executable documentation.
5. **Tests** (`packages/ai/src/gateway/http-gateway-adapter.test.ts`, node:test, mocked `fetch`):
   - JSON `generate` happy path → `ProviderResponse`.
   - SSE `stream` chunking → ordered `StreamChunk[]`.
   - `AbortSignal` propagation (abort mid-stream stops iteration).
   - non-2xx HTTP → `AiError` mapping.
   - malformed / partial SSE event tolerance.
6. **Changeset** — minor, `@rudderjs/ai` (new surface).
7. **Docs** — `docs/guide/ai/custom-gateway-provider.md`, framed as *the Laravel custom-driver pattern for AI providers* (subclass the abstract transport, register the factory). The key teaching point: **when to reach for this vs. just `baseUrl` on an OpenAI/Anthropic-compatible gateway** (use the template only when the gateway's wire format matches no built-in provider). Add a one-line pointer in the providers guide, then `docs:sync` to rudderjs.com.

---

## Scope guard / risks

- **Keep it to `generate` + `stream`.** The optional multi-modal factory methods (`createEmbedding` / `createImage` / `createTts` / `createStt` / `createReranking`) are out of scope for v1 — the template covers chat/completion gateways only.
- **No refactor of existing providers.** The template is self-contained (its own SSE framer); zero blast radius. Errors follow the existing `throw new Error('[RudderJS AI] …')` convention (there is no `AiError` class).
- **No pilotiq coupling.** Acceptance is met only if the four hooks are the *sole* place a gateway's specifics live; if any pilotiq-shaped assumption leaks into the base class, stop and reshape.

---

## Acceptance (from #1168, now confirmed)

- [x] Confirm a generic, provider-agnostic `ProviderAdapter` contract exists → yes (`types.ts:257`); template is the missing reusable skeleton over it.
- [ ] Ship the template at `@rudderjs/ai/gateway`.
- [ ] Tests + a changeset (minor).
- [ ] Docs (`custom-gateway-provider.md` + providers-guide pointer + `docs:sync`).
