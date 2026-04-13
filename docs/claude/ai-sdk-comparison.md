# AI SDK Comparison — RudderJS vs Laravel vs Vercel vs TanStack

> Last updated: 2026-04-13

## Philosophy

| | RudderJS AI | Laravel AI SDK | Vercel AI SDK | TanStack AI |
|---|---|---|---|---|
| **Language** | TypeScript (ESM, strict) | PHP (Laravel 13+) | TypeScript/JS | TypeScript/JS |
| **Maturity** | Early (0.0.1) | Stable (March 2026) | Stable (v6, 40M+/mo) | Alpha |
| **Pattern** | Laravel ergonomics + Vercel execution model | Laravel DI, Eloquent, facades | Full-stack AI primitives | Minimal, type-precise, tree-shakeable |
| **Package** | `@rudderjs/ai` | `laravel/ai` | `ai` + `@ai-sdk/*` | `@tanstack/ai` + framework adapters |
| **Standalone** | Yes (works without framework) | No (requires Laravel) | Yes | Yes |
| **Testing** | Full fakes for every modality | Full fakes for every modality | Basic mock model | None |
| **MCP** | Separate `@rudderjs/mcp` package | — | `@ai-sdk/mcp` | — |

---

## Provider Support

| Provider | RudderJS | Laravel | Vercel | TanStack |
|---|:---:|:---:|:---:|:---:|
| Anthropic | ✅ | ✅ | ✅ | ✅ |
| OpenAI | ✅ | ✅ | ✅ | ✅ |
| Google Gemini | ✅ | ✅ | ✅ | ✅ |
| Azure OpenAI | ✅ | ✅ | ✅ | — |
| Mistral | ✅ | ✅ | ✅ | — |
| Groq | ✅ | ✅ | ✅ | ✅ |
| xAI (Grok) | ✅ | ✅ | ✅ | ✅ |
| DeepSeek | ✅ | ✅ | ✅ | — |
| Ollama | ✅ | ✅ | ✅ (community) | ✅ |
| Cohere | ✅ (embed/rerank) | ✅ (embed/rerank) | ✅ | — |
| Jina | ✅ (embed/rerank) | ✅ (embed/rerank) | — | — |
| Amazon Bedrock | — | — | ✅ | — |
| Together.ai | — | — | ✅ | — |
| ElevenLabs | — | ✅ (TTS/STT) | ✅ (TTS) | — |
| Fal | — | — | ✅ (image) | ✅ (image/video) |
| **Total** | **11** | **~12** | **20+ official** | **~8** |

---

## Core Capabilities

| Capability | RudderJS | Laravel | Vercel | TanStack |
|---|:---:|:---:|:---:|:---:|
| Text generation | ✅ `agent.prompt()` | ✅ `$agent->prompt()` | ✅ `generateText()` | ✅ adapter calls |
| Streaming | ✅ `agent.stream()` + chunks | ✅ `stream: true` | ✅ `streamText()` | ✅ SSE/HTTP stream |
| Structured output | ✅ `Output.object/array/choice()` | ✅ `HasStructuredOutput` | ✅ `generateObject()` | ✅ `outputSchema` |
| Tool/function calling | ✅ `toolDefinition()` + Zod | ✅ `HasTools` + JSON Schema | ✅ `tools` param | ✅ `toolDefinition()` |
| Image generation | ✅ `AI.image()` | ✅ `AiImage::generate()` | ✅ `generateImage()` + editing | ✅ via fal |
| Image editing | — | — | ✅ inpaint/outpaint/style | — |
| Embeddings | ✅ `AI.embed()` + cache + batch | ✅ `AiEmbedding::make()` | ✅ `embed()` / `embedMany()` | — |
| TTS | ✅ `AI.audio()` | ✅ `AiAudio::speak()` | ✅ `generateSpeech()` | — |
| STT | ✅ `AI.transcribe()` | ✅ `AiTranscription::transcribe()` | ✅ transcription adapters | — |
| Reranking | ✅ `AI.rerank()` + Cohere/Jina | ✅ `AiRerank::rank()` | ✅ `rerank()` | — |
| File management | ✅ `AI.files()` + OpenAI/Anthropic/Google | ✅ `AiFile::upload/list/delete()` | — (via provider tools) | — |
| Vector stores | — | ✅ `AiVectorStore` | — (via provider tools) | — |
| Video generation | — | — | ✅ experimental | ✅ via fal |
| Multimodal input | ✅ `DocumentAttachment` / `ImageAttachment` | ✅ attachments | ✅ images/audio/video | ✅ content types |

---

## Agent & Multi-Step

| | RudderJS | Laravel | Vercel | TanStack |
|---|---|---|---|---|
| **Agent class** | ✅ `Agent` base class + `agent()` inline | ✅ PHP classes + `make:agent` | ✅ `Agent` + `ToolLoopAgent` | ✅ loop strategies |
| **Tool loop** | ✅ auto re-prompt, configurable stops | ✅ automatic | ✅ automatic, 20-step default | ✅ `maxIterations` |
| **Stop conditions** | ✅ `stepCountIs()`, `hasToolCall()`, custom | — | ✅ `stopWhen` | ✅ `maxIterations` |
| **Tool approval** | ✅ `needsApproval` + resume | — | ✅ `needsApproval` + `addToolApprovalResponse` | ✅ `requiresApproval` + `ToolCallManager` |
| **Client tools** | ✅ browser-routed, pause/resume | — | — | ✅ `.client()` isomorphic |
| **Subagents** | ✅ nested agent tools + client dispatch | — | ✅ hierarchical agents | — |
| **Durable/resumable** | — | — | ✅ Durable Agent | — |
| **Failover** | ✅ failover model chain | ✅ `failover:` param | ✅ AI Gateway | — |
| **Conversation memory** | ✅ `ConversableAgent` + pluggable store | ✅ `RemembersConversations` trait | — (manual) | — |
| **Inline/anonymous** | ✅ `agent('instructions')` | ✅ `AnonymousAgent` | ✅ `generateText()` with tools | ✅ inline |

---

## Streaming & Protocol

| | RudderJS | Laravel | Vercel | TanStack |
|---|---|---|---|---|
| **Chunk types** | text-delta, tool-call, tool-result, tool-update, usage, finish, pending-client-tools, pending-approval | text, tool-call, tool-result, finish | text-delta, tool-call, tool-result, finish, step-finish | text, tool, finish |
| **Vercel protocol compat** | ✅ `toVercelDataStream()` / `toVercelResponse()` | ✅ supported | ✅ native | — |
| **Tool progress updates** | ✅ async generator `tool-update` chunks | — | — | — |
| **Backpressure** | — | — | ✅ | — |
| **Resume/reconnect** | — | — | ✅ | — |
| **Generative UI** | — | — | ✅ `createAgentUIStream()` | — |

---

## Middleware & Observability

| | RudderJS | Laravel | Vercel | TanStack |
|---|---|---|---|---|
| **Middleware** | ✅ 8 hooks (config, chunk, before/after tool, usage, abort, error, sequential) | ✅ agent-level middleware classes | ✅ model wrapping middleware | — |
| **Observer/events** | ✅ `aiObservers` globalThis registry | ✅ Laravel events (`Prompted`, `ToolCalled`, etc.) | ✅ OpenTelemetry integration | ✅ typed observability events |
| **DevTools** | ✅ Telescope AI collector (full UI) | — (use Telescope equivalent) | ✅ DevTools UI (localhost:4983) | — |
| **Queue integration** | ✅ `QueuedPromptBuilder` via `@rudderjs/queue` | ✅ `queue: true` | — | — |
| **Broadcasting** | — (via `@rudderjs/broadcast`) | ✅ `->broadcast(to:)` | — | — |

---

## Frontend / UI Hooks

| | RudderJS | Laravel | Vercel | TanStack |
|---|---|---|---|---|
| **Chat hook** | — (server SDK; use Vercel protocol on frontend) | — (server SDK) | ✅ `useChat()` | ✅ `useChat()` |
| **Completion hook** | — | — | ✅ `useCompletion()` | — |
| **Object streaming** | — | — | ✅ `useObject()` | — |
| **Framework support** | Server-side (any Node.js) | PHP/Laravel (backend only) | React, Vue, Svelte, Angular, Expo | React, Solid, Preact |

> RudderJS and Laravel are server-side SDKs. Frontend chat UI is handled by consuming the Vercel AI protocol stream or custom SSE. `@pilotiq-pro/ai` implements the chat UI on the frontend.

---

## Testing

| | RudderJS | Laravel | Vercel | TanStack |
|---|---|---|---|---|
| **Text fake** | ✅ `AiFake.respondWith()` | ✅ `AgentFake::agents()` | ✅ mock model | — |
| **Image fake** | ✅ `respondWithImage()` | ✅ `ImageFake` | — | — |
| **Audio fake** | ✅ `respondWithAudio()` | ✅ `AudioFake` | — | — |
| **STT fake** | ✅ `respondWithTranscription()` | ✅ `TranscriptionFake` | — | — |
| **Embed fake** | — | ✅ `EmbeddingFake` | — | — |
| **Rerank fake** | — | ✅ `RerankFake` | — | — |
| **File fake** | — | ✅ `FileFake` | — | — |
| **Assertions** | ✅ `assertPrompted()`, `assertImageGenerated()`, etc. | ✅ `assertPrompted()`, etc. | — | — |

---

## RudderJS-Unique Features

Features in `@rudderjs/ai` not found in the other three:

| Feature | Description |
|---|---|
| **Tool progress streaming** | `async function*` tools yield `tool-update` chunks — live progress during long tool execution. No other SDK has this. |
| **`.modelOutput()` transform** | Decouple what the UI sees from what the model sees next. Critical for subagent summarization — show full output to user, feed compressed version back to model. |
| **Client tool pause/resume** | Agent loop halts, sends `pending-client-tools` to browser, browser executes tool, sends result back, loop resumes. Enables browser-routed tools (DOM manipulation, form state, etc.). |
| **Tool approval gates** | Per-tool `needsApproval` with inline approve/reject UI. Loop suspends until user decides. |
| **Provider-native tool metadata** | `meta` system passes provider-specific tool config (e.g., Anthropic `cache_control`, OpenAI `strict`). |
| **Standalone + framework** | Works without `@rudderjs/core` (observers on globalThis, no DI required). Gains queue/broadcast/telescope when framework is present. |
| **Telescope AI collector** | Full monitoring UI showing agent executions, tool calls, steps, tokens, duration — integrated into the framework's Telescope dashboard. |
| **Vercel protocol bridge** | `toVercelDataStream()` / `toVercelResponse()` — any frontend consuming Vercel AI SDK protocol works out of the box. |

---

## Remaining Gaps (RudderJS vs Field)

| Gap | Laravel | Vercel | Status | Notes |
|---|:---:|:---:|---|---|
| ~~Reranking~~ | ✅ | ✅ | **DONE** | `AI.rerank()` + Cohere + Jina providers |
| ~~File management~~ | ✅ | — | **DONE** | `AI.files()` + OpenAI/Anthropic/Google adapters |
| ~~Embedding fake~~ | ✅ | — | **DONE** | `respondWithEmbedding()` + `assertEmbedded()` |
| ~~Cohere provider~~ | ✅ | ✅ | **DONE** | Reranking + embeddings |
| ~~Jina provider~~ | ✅ | — | **DONE** | Reranking + embeddings (direct HTTP) |
| **Vector stores** | ✅ | — | Not planned | Provider-specific, low abstraction value |
| **Stream backpressure** | — | ✅ | Not planned | — |
| **Stream resume** | — | ✅ | Not planned | — |
| **Durable agents** | — | ✅ | Not planned | Different execution model |
| **Generative UI** | — | ✅ | — | Tool renderer registry (different approach) |
| **Image editing** | — | ✅ | Not planned | — |
| **Video generation** | — | ✅ | Not planned | — |
| **DevTools (standalone)** | — | ✅ | — | Telescope fills this role |

### Intentional Non-Goals

| Feature | Why Not |
|---|---|
| **Frontend hooks** (`useChat`, etc.) | RudderJS is a server framework. Frontend consumes Vercel AI protocol via `toVercelResponse()`. `@pilotiq-pro/ai` owns the chat UI. |
| **Vector stores** | Provider-specific, low abstraction value. Users call provider SDKs directly. |
| **Durable agents** | RudderJS agents use queue integration + conversation persistence instead. Different pattern, same outcome. |
| **Video generation** | Niche. Can be added as a provider adapter later. |
| **Stream resume** | Complexity vs value. SSE reconnect at the transport layer is sufficient. |

---

## Architecture Difference: RudderJS vs The Field

```
Laravel AI SDK          Vercel AI SDK           TanStack AI             RudderJS AI
─────────────────       ─────────────────       ─────────────────       ─────────────────
PHP classes             generateText()          openaiText()            Agent class
  + Eloquent traits       + streamText()          + anthropicText()       + agent() inline
  + DI injection          + generateObject()      + toolDefinition()     + toolDefinition()
  + queue: true           + useChat() hooks       + useChat() hooks      + Zod schemas
  + broadcasting          + MCP client            + isomorphic tools     + middleware hooks
                          + DevTools                                     + observers
                          + Durable Agent                                + Vercel protocol
                                                                        + client tools
                                                                        + tool progress
                                                                        + queue integration

Backend-only            Full-stack              Frontend-first          Backend-first
Eloquent persistence    Platform-optional       Minimal, composable     Framework-optional
Laravel events          OpenTelemetry           Typed events            globalThis observers
```

**RudderJS's position:** Laravel's ergonomics (classes, DI, facades, testing fakes, queue) in TypeScript, with Vercel's streaming execution model, plus unique features (client tools, tool progress, `.modelOutput()`) that neither has. The Vercel AI protocol bridge means any Vercel-compatible frontend works without changes.
