# AI SDK Comparison — RudderJS vs Laravel vs Vercel vs TanStack

> Last updated: 2026-05-14 (post A1–A7 + B1–B10 + B8.5 shipment)

## Philosophy

| | RudderJS AI | Laravel AI SDK | Vercel AI SDK | TanStack AI |
|---|---|---|---|---|
| **Language** | TypeScript (ESM, strict) | PHP (Laravel 13+) | TypeScript/JS | TypeScript/JS |
| **Maturity** | 1.6.2 (1.0 graduated 2026-05-02; full A/B roadmap shipped 2026-05-11) | Stable (March 2026) | Stable (v6, 40M+/mo) | Alpha |
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
| Amazon Bedrock | ✅ (Anthropic Claude on Bedrock; B4) | — | ✅ | — |
| OpenRouter | ✅ (routing/failover aggregator; B5) | — | ✅ | — |
| Voyage AI | ✅ (embeddings + reranking; B10) | — | — | — |
| Together.ai | — | — | ✅ | — |
| ElevenLabs | ✅ (TTS `eleven_multilingual_v2` + STT `scribe_v1`; B9) | ✅ (TTS/STT) | ✅ (TTS) | — |
| Fal | — | — | ✅ (image) | ✅ (image/video) |
| **Total** | **15** | **~12** | **20+ official** | **~8** |

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
| Vector stores | ✅ ORM vector storage (B7) + hosted (OpenAI / Gemini fileSearch) + pgvector fallback (B8/B8.5) | ✅ `AiVectorStore` | — (via provider tools) | — |
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
| **Subagents** | ✅ `asTool()` streaming + suspend/resume (A2.5) + handoffs (A2) | — | ✅ hierarchical agents | — |
| **Handoffs** | ✅ multi-agent control transfer with state preservation (A2) | — | — | — |
| **Durable/resumable** | ✅ via queue integration + conversation persistence + budget storage | — | ✅ Durable Agent | — |
| **Failover** | ✅ failover model chain (text + image + audio + transcription; B1) | ✅ `failover:` param | ✅ AI Gateway | — |
| **Conversation memory** | ✅ `ConversableAgent` + auto-persist (B3) + Mem0-style user memory (A4) | ✅ `RemembersConversations` trait | — (manual) | — |
| **Prompt caching** | ✅ unified `cacheable()` API across Anthropic / OpenAI / Google (A1) | — | — (provider-specific) | — |
| **Cost / budget enforcement** | ✅ pricing catalog + `BudgetStorage` + `withBudget` middleware (A6) | — | — | — |
| **Eval framework** | ✅ `ai:eval` CLI + JSON/HTML reporters + record/replay fixtures (A5) | — | — | — |
| **Computer use** | ✅ abstraction over Anthropic/OpenAI computer-use tools (A7) | — | — | — |
| **MCP ↔ Agent bridge** | ✅ agents consume MCP servers; MCP servers expose agents (A3) | — | `@ai-sdk/mcp` (client-side only) | — |
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
| **DevTools** | ✅ Telescope AI collector (full UI, real-time SSE updates #431) | — (use Telescope equivalent) | ✅ DevTools UI (localhost:4983) | — |
| **Queue integration** | ✅ `QueuedPromptBuilder` via `@rudderjs/queue` | ✅ `queue: true` | — | — |
| **Broadcasting** | ✅ `.broadcast(channel)` on queued prompts via `@rudderjs/broadcast` (B6) | ✅ `->broadcast(to:)` | — | — |

---

## Frontend / UI Hooks

| | RudderJS | Laravel | Vercel | TanStack |
|---|---|---|---|---|
| **Chat hook** | — (server SDK; use Vercel protocol on frontend) | — (server SDK) | ✅ `useChat()` | ✅ `useChat()` |
| **Completion hook** | — | — | ✅ `useCompletion()` | — |
| **Object streaming** | — | — | ✅ `useObject()` | — |
| **Framework support** | Server-side (any Node.js) | PHP/Laravel (backend only) | React, Vue, Svelte, Angular, Expo | React, Solid, Preact |

> RudderJS and Laravel are server-side SDKs. Frontend chat UI is handled by consuming the Vercel AI protocol stream or custom SSE — wire up your own UI or use any frontend chat library that speaks the protocol.

---

## Testing

| | RudderJS | Laravel | Vercel | TanStack |
|---|---|---|---|---|
| **Text fake** | ✅ `AiFake.respondWith()` | ✅ `AgentFake::agents()` | ✅ mock model | — |
| **Image fake** | ✅ `respondWithImage()` | ✅ `ImageFake` | — | — |
| **Audio fake** | ✅ `respondWithAudio()` | ✅ `AudioFake` | — | — |
| **STT fake** | ✅ `respondWithTranscription()` | ✅ `TranscriptionFake` | — | — |
| **Embed fake** | ✅ `respondWithEmbedding()` + `assertEmbedded()` | ✅ `EmbeddingFake` | — | — |
| **Rerank fake** | ✅ `assertReranked()` | ✅ `RerankFake` | — | — |
| **File fake** | ✅ `respondWithFileUpload()` + `respondWithFileSearchResults()` | ✅ `FileFake` | — | — |
| **`preventStrayPrompts()`** | ✅ `AiFake.preventStrayPrompts()` (B2) | ✅ | — | — |
| **Assertions** | ✅ `assertPrompted()`, `assertImageGenerated()`, `assertEmbedded()`, `assertReranked()`, etc. | ✅ `assertPrompted()`, etc. | — | — |

---

## RudderJS-Unique Features

Features in `@rudderjs/ai` not found in the other three:

| Feature | Description |
|---|---|
| **Tool progress streaming** | `async function*` tools yield `tool-update` chunks — live progress during long tool execution. No other SDK has this. |
| **`.modelOutput()` transform** | Decouple what the UI sees from what the model sees next. Critical for subagent summarization — show full output to user, feed compressed version back to model. |
| **Client tool pause/resume** | Agent loop halts, sends `pending-client-tools` to browser, browser executes tool, sends result back, loop resumes. Enables browser-routed tools (DOM manipulation, form state, etc.). |
| **Tool approval gates** | Per-tool `needsApproval` with inline approve/reject UI. Loop suspends until user decides. |
| **`asTool()` streaming + suspend/resume (A2.5)** | Sub-agent calls stream chunks back to the parent in real time, and can suspend mid-execution for parent-side approval gates before resuming. Absorbs ~700 LOC of bespoke plumbing that downstream projects (`@pilotiq-pro/ai`) used to roll themselves. |
| **Unified prompt caching (A1)** | One declarative `cacheable()` API across Anthropic (`cache_control`), OpenAI (`prompt_cache_key`), and Google (`cachedContent` resources). Provider adapters translate to native primitives behind the scenes. 50–90% cost savings on cacheable content; no other SDK unifies the three. |
| **MCP ↔ Agent bridge (A3)** | Closes the loop between the framework's two AI packages — `@rudderjs/ai` agents consume external MCP servers as tools, and `@rudderjs/mcp` servers can expose agents as MCP tools/prompts. |
| **User memory (A4)** | Mem0-style episodic + semantic user memory, 5 phases: in-memory → auto-inject → auto-extract → ORM backend → embedding backend. Layered into the agent loop without explicit retrieve calls. |
| **Eval framework (A5)** | `ai:eval` CLI, JSON + HTML reporters, record/replay fixtures, configurable metrics. Cohabits with prompt caching to keep eval $/run minimal. |
| **Budget enforcement (A6)** | Pricing catalog (15 providers, all current models) + `BudgetStorage` interface + `withBudget` middleware. Hard-stops agent runs that would breach a per-user/per-tenant cap; production-grade cost control. |
| **Auto-persist conversations (B3)** | Agents that extend `ConversableAgent` auto-thread without explicit `forUser`/`continue` calls — Laravel's default. Devs stop forgetting. |
| **Provider-native tool metadata** | `meta` system passes provider-specific tool config (e.g., Anthropic `cache_control`, OpenAI `strict`). |
| **Runtime-agnostic core** | Main `@rudderjs/ai` entry works in browser / React Native / Electron renderer (no Node imports). Node-only file helpers live at `@rudderjs/ai/node`; the `AiProvider` at `@rudderjs/ai/server`. Auto-discovery picks the right subpath via `rudderjs.providerSubpath` in `package.json`. |
| **Standalone + framework** | Works without `@rudderjs/core` (observers on globalThis, no DI required). Gains queue/broadcast/telescope when framework is present. |
| **Telescope AI collector** | Full monitoring UI showing agent executions, tool calls, steps, tokens, duration. Real-time SSE updates (#431, 2026-05-13) — no polling. |
| **Vercel protocol bridge** | `toVercelDataStream()` / `toVercelResponse()` — any frontend consuming Vercel AI SDK protocol works out of the box. |

---

## Remaining Gaps (RudderJS vs Field)

| Gap | Laravel | Vercel | Status | Notes |
|---|:---:|:---:|---|---|
| ~~Reranking~~ | ✅ | ✅ | **DONE** | `AI.rerank()` + Cohere + Jina + Voyage providers |
| ~~File management~~ | ✅ | — | **DONE** | `AI.files()` + OpenAI / Anthropic / Google adapters |
| ~~Embedding fake~~ | ✅ | — | **DONE** | `respondWithEmbedding()` + `assertEmbedded()` |
| ~~Vector stores~~ | ✅ | — | **DONE** | ORM vector storage (B7) + hosted OpenAI/Gemini `fileSearch` (B8/B8.5) + pgvector fallback |
| ~~Bedrock provider~~ | — | ✅ | **DONE** | Anthropic Claude on Bedrock (B4); other families pending demand |
| ~~OpenRouter provider~~ | — | ✅ | **DONE** | Routing/failover aggregator (B5) |
| ~~ElevenLabs provider~~ | ✅ | ✅ | **DONE** | TTS `eleven_multilingual_v2` + STT `scribe_v1` (B9) |
| ~~Voyage provider~~ | — | — | **DONE** | Best-in-class embeddings + reranking (B10) |
| ~~Image / Audio / Transcription failover~~ | — | ✅ | **DONE** | Failover model chains across all modalities (B1) |
| ~~`preventStrayPrompts()`~~ | ✅ | — | **DONE** | Fakes no longer pass silently when nothing was sent (B2) |
| ~~Auto-persist conversation~~ | ✅ | — | **DONE** | `ConversableAgent` auto-threads without explicit `forUser`/`continue` (B3) |
| ~~`broadcastOnQueue()` integration~~ | ✅ | — | **DONE** | `.broadcast(channel)` on queued prompts (B6) |
| ~~Cohere provider~~ | ✅ | ✅ | **DONE** | Reranking + embeddings |
| ~~Jina provider~~ | ✅ | — | **DONE** | Reranking + embeddings (direct HTTP) |
| ~~Prompt caching~~ | — | partial | **DONE** | Unified `cacheable()` API across Anthropic / OpenAI / Google (A1) |
| ~~Computer use~~ | — | ✅ | **DONE** | A7 — abstraction over Anthropic/OpenAI computer-use tools |
| ~~User memory (Mem0)~~ | — | — | **DONE** | A4 — 5 phases, embedding-backed |
| ~~Eval framework~~ | — | — | **DONE** | A5 — `ai:eval` CLI + HTML/JSON reporters + record/replay |
| ~~Budget enforcement~~ | — | — | **DONE** | A6 — `withBudget` middleware + ORM-backed storage |
| ~~Handoffs / sub-agent streaming~~ | — | partial | **DONE** | A2 + A2.5 — multi-agent control transfer + streaming-with-suspend |
| ~~MCP ↔ Agent bridge~~ | — | partial | **DONE** | A3 — bidirectional integration with `@rudderjs/mcp` |
| **Stream backpressure** | — | ✅ | Not planned | — |
| **Stream resume** | — | ✅ | Not planned | SSE reconnect at transport layer is sufficient |
| **Durable agents** | — | ✅ | Not planned (covered) | Queue integration + conversation persistence + budget storage fill this role |
| **Generative UI** | — | ✅ | Not planned | Tool renderer registry — different approach |
| **Image editing** | — | ✅ | Not planned | Niche; user can call provider SDK directly |
| **Video generation** | — | ✅ | Not planned | Niche; user can call provider SDK directly |
| **DevTools (standalone)** | — | ✅ | Not needed | Telescope AI collector fills this role |
| **Together.ai provider** | — | ✅ | Not planned | Add as raw `fetch` adapter when a customer asks |
| **Fal provider (image/video)** | — | ✅ | Not planned | Niche; user can call directly |

### Intentional Non-Goals

| Feature | Why Not |
|---|---|
| **Frontend hooks** (`useChat`, etc.) | RudderJS is a server framework. Frontend consumes Vercel AI protocol via `toVercelResponse()` — bring your own chat UI. |
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
                          + Durable Agent                                + Vercel protocol bridge
                                                                        + client tools
                                                                        + tool progress streaming
                                                                        + asTool streaming/suspend
                                                                        + unified prompt caching
                                                                        + user memory (Mem0)
                                                                        + eval framework
                                                                        + budget enforcement
                                                                        + MCP ↔ Agent bridge
                                                                        + queue + broadcast integration
                                                                        + runtime-agnostic core

Backend-only            Full-stack              Frontend-first          Runtime-agnostic main; Node /server
Eloquent persistence    Platform-optional       Minimal, composable     Framework-optional
Laravel events          OpenTelemetry           Typed events            globalThis observers + Telescope SSE
```

**RudderJS's position:** Laravel's ergonomics (classes, DI, facades, testing fakes, queue) in TypeScript, with Vercel's streaming execution model, plus a layer of differentiators neither has: unified prompt caching across all three major providers, sub-agent streaming with mid-execution suspend, user memory + eval + budget enforcement as first-class APIs, and a runtime-agnostic core entry that works in browser / React Native / Electron without conditional imports. The Vercel AI protocol bridge means any Vercel-compatible frontend works without changes.
