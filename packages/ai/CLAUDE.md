# @rudderjs/ai

AI agent framework — Laravel ergonomics + Vercel/TanStack execution model + RudderJS-specific approval-resume flow.

## Key Files

- `src/agent.ts` — `Agent` base class: `instructions()`, `model()`, `tools()`, `stopWhen()`, `prompt()`, `stream()`, `asTool()` (subagents)
- `src/tool.ts` — `toolDefinition()`, `dynamicTool()`, `ToolBuilder`, pause control
- `src/handoff.ts` — `handoff(AgentClass, opts?)` factory + `isHandoffTool` typeguard for control-transfer between agents
- `src/types.ts` — `StreamChunk`, `FinishReason`, `ToolDefinition`, `AgentConfig`
- `src/providers/` — provider adapters: anthropic, openai, google, ollama, deepseek, xai, groq, mistral, azure, cohere, jina, openrouter, bedrock
- `src/middleware.ts` — Hooks: `runOnConfig`, `runOnChunk`, `runOnBeforeToolCall`, `runOnAfterToolCall`, `runOnUsage`
- `src/facade.ts` — `AI` convenience class for one-shot prompts
- `src/memory.ts` — `UserMemory` interface + `MemoryUserMemory` (in-process backend, token-overlap recall) + `resolveRemembersSpec` (#A4 Phase 1)
- `src/memory-inject.ts` — `withMemoryInject(spec)` middleware: auto-installed when `Agent.remembers().inject === 'auto'`; mutates `ctx.messages[0]` to prepend a `<user-memory>` block (#A4 Phase 2)
- `src/memory-extract.ts` — `withMemoryExtract(spec)` middleware: auto-installed when `Agent.remembers().extract === 'auto'` and `extractWith` is set; runs onFinish, asks the small model to distill durable user facts from the latest `[user, assistant]` turn, filters by confidence threshold (default 0.7), unions spec tags, and writes via `mem.remember()`; failures route through `onError` and never break the parent (#A4 Phase 3)
- `src/memory-orm/index.ts` — `OrmUserMemory` + `UserMemoryRecord` Model + `userMemoryPrismaSchema` reference. Subpath export at `@rudderjs/ai/memory-orm`; lazy peer dep on `@rudderjs/orm` (#A4 Phase 4)
- `src/observers.ts` — Event observers for telescope telemetry (subpath export)
- `src/vercel-protocol.ts` — `toVercelResponse()` for Vercel AI SDK streaming compatibility
- `src/registry.ts` — Provider/model registry
- `src/fake.ts` — `AiFake` for testing without real API calls
- `src/mcp/` — MCP ↔ Agent bridge (`mcpClientTools()`, `mcpServerFromAgent()`); subpath export at `@rudderjs/ai/mcp`

## Runtime Compatibility

`@rudderjs/ai` is runtime-agnostic via subpath exports:

| Entry | Runtimes | Use for |
|---|---|---|
| `@rudderjs/ai` | Node, browser, Electron main+renderer, React Native | Agents, tools, streaming, providers — any `fetch`-capable JS runtime |
| `@rudderjs/ai/node` | Node only | `documentFromPath()`, `imageFromPath()`, `transcribeFromPath()` |
| `@rudderjs/ai/server` | Node only | `AiProvider` (requires `@rudderjs/core`) |
| `@rudderjs/ai/mcp` | Node only (in practice) | `mcpClientTools()` + `mcpServerFromAgent()` (requires `@modelcontextprotocol/sdk`) |
| `@rudderjs/ai/memory-orm` | Node only | `OrmUserMemory` + `UserMemoryRecord` ORM-backed `UserMemory` (requires `@rudderjs/orm`) |

The main entry has **zero `node:` static imports** — enforced by `src/isomorphic-check.test.ts`. `@rudderjs/core` is an optional peer; only `/server` consumers pull it in.

Provider auto-discovery reads `rudderjs.providerSubpath` from `package.json` (`"./server"` here) so `defaultProviders()` imports the class from the right entry.

**Security caveat:** Calling LLM providers directly from a client (browser/RN) leaks your API key. Use server-side proxies for production; BYOK desktop apps (Electron) are the main client-side use case.

## Architecture Rules

- **Lazy SDK loading**: provider adapters import their SDK only on first use — all SDKs are optional peers
- **Streaming tools**: use `async function*` + `.modelOutput()` pattern; NEVER take an SSESend parameter
- **Client tools**: omit `execute` from the tool definition — the loop pauses and returns `pending-client-tools`
- **Approval gates**: `needsApproval: true` stops the loop with `tool_approval_required` finish reason
- **Zod schemas**: tool inputs defined with zod, converted to JSON Schema for each provider
- **Subagents**: `agent.asTool({ name, description })` wraps an agent as a tool a parent agent can call. Defaults: `inputSchema = { prompt: string }`, `modelOutput = response.text` (full `AgentResponse` still surfaces in the `tool-result` chunk for the UI). Pass `inputSchema` + `prompt` for a typed schema. Default subagent runs via `prompt()`. **Streaming + suspend (1.4.0, extended symmetrically for approval pauses):** `streaming: true | (chunk) => SubAgentUpdate | null` surfaces inner progress as `tool-update` chunks (default projector emits `agent_start` / `tool_call` / `agent_done` plus `agent_pending_approval` for inner approval gates); `suspendable: { runStore: SubAgentRunStore }` propagates BOTH inner client-tool pauses AND approval pauses upward through the parent loop. The wrapper persists a snapshot with `pauseKind: 'client_tool' | 'approval'` (defaults to `'client_tool'` when absent for back-compat) and yields the matching control chunk: `pauseForClientTools(pending, subRunId)` or `pauseForApproval(toolCall, isClientTool, subRunId)`. The corresponding `SubAgentUpdate` at the suspend boundary is `subagent_paused` (client-tool) or `subagent_paused_approval` (approval). Host's continuation calls static `Agent.resumeAsTool(subRunId, results, { runStore, agent, approvedToolCallIds?, rejectedToolCallIds? })` — dispatches on `snapshot.pauseKind`; client-tool snapshots take `clientToolResults`, approval snapshots take `approvedToolCallIds` / `rejectedToolCallIds`. Returns `{ kind: 'completed' | 'paused', pauseKind?, toolCall?, ... }`; a resume can pause again on a different kind (e.g. approve → next-step client tool). Suspend without streaming throws at builder time. Run-store impls live in `src/sub-agent-run-store.ts` (`InMemorySubAgentRunStore` for tests, `CachedSubAgentRunStore` lazily wraps `@rudderjs/cache`).
- **Handoffs (1.5.0)**: `handoff(AgentClass, { when?, name?, description?, inputSchema? })` returns a control-transfer tool. Distinct from `asTool`: the parent's loop ends and the child agent owns the rest of the conversation. Default name `handoffTo${AgentClass.name}`, default schema `{ message: string }` (the model writes the transition prompt). Implementation lives in `src/handoff.ts`; the loop detects handoff tools by `Symbol.for('rudderjs.ai.handoff')` and short-circuits in `runToolPhaseSerial`. A `'handoff'` `StreamChunk` is emitted before control transfers; `AgentResponse.handoffPath` records the chain of class names traversed (e.g. `['Triage', 'Sales']`). Multi-hop is supported and bounded by `MAX_HANDOFFS = 5` — exceeding throws to surface cycles. Sibling tool calls in the same step as a handoff are skipped with a synthetic "skipped: handed off" tool result so the message log stays well-formed for replay. Handoffs always run in serial mode (force-overrides `parallelTools`).
- **Failover**: agents declare via `failover()` (string array). Media generators (Image / Audio / Transcription) declare via fluent `.failover(...models)`. Both reuse `tryWithFailover()` from `registry.ts` — try in order, swallow individual errors, surface only the last. Non-agent path has no abort handling (single-shot calls).
- **Prompt caching**: `Agent.cacheable() { return { instructions, tools, messages: N, ttl? } }`. The agent loop resolves into `CacheableMarkers` on `ProviderRequestOptions.cache`. Per-call override via `prompt(input, { cache: false | {...} })`. Anthropic adapter translates to `cache_control: { type: 'ephemeral' }` on the last block of each marked region. OpenAI adapter sets `prompt_cache_key` from a cyrb53 hash of the marked regions for routing affinity (caching itself is automatic above 1024 tokens). Google adapter manages `cachedContent` resources via `GoogleCacheRegistry` — auto-wired to `@rudderjs/cache` when bound, in-memory `Map` fallback otherwise; `ttl` field controls per-resource lifetime (default `'1h'`, Google-only). The shared cyrb53 helper lives at `src/util/hash.ts`.
- **Strict-mode fakes**: `AiFake.fake().preventStrayPrompts()` makes any prompt without a matching `respondWithSequence` entry throw. Catches tests that silently fall back to the ambient `respondWith` default.
- **Auto-persist conversations**: `Agent.conversational() { return { user, id?, agent?, historyLimit? } | false }` opts the class into auto-load + auto-save. Default returns `false` (stateless). Async returns supported. `runWithPersistence` (in `src/conversation-persistence.ts`) is the shared load/append helper used by both the class declaration path and `ConversableAgent` (the explicit `forUser`/`continue` form). Precedence (high → low): explicit `forUser`/`continue` > per-call `options.conversation` > class declaration. Threads are segregated by `(user, agent class name)` by default; override via `agent: 'custom'` on the spec.
- **MCP bridge (1.6.0)**: `@rudderjs/ai/mcp` ships two connectors. `mcpClientTools(transport, opts?)` consumes a remote MCP server's tools as agent tools — accepts a URL string, `{ command, args }` for stdio subprocess, or an already-connected SDK Client (caller owns lifecycle). Returns `Tool[]` with a non-enumerable `close()` when this call owns the client. Remote JSON Schema flows through verbatim via the `jsonSchema` passthrough on `ToolDefinitionOptions` (no zod round-trip). `mcpServerFromAgent(AgentClass, opts?)` returns an SDK `McpServer` — three exposure modes: `'tools'` (default; one MCP tool per `agent.tools()`), `'agent'` (one prompt-tool that runs the whole agent — the differentiator move), or `'both'`. Approval gates aren't forwarded — the MCP protocol has no primitive for it.
- **Queued prompts + broadcast (1.7.0)**: `agent.queue(input)` returns `QueuedPromptBuilder` for background execution via `@rudderjs/queue`. `.broadcast(channel, opts?)` switches the queued job from `prompt()` to `stream()` and pushes each `StreamChunk` to the channel via `@rudderjs/broadcast`. Events: `chunk` (per stream chunk), `done` (final `AgentResponse`), `error` (`{ message }` on failure). Optional `eventPrefix` namespaces the events. Both peer deps loaded lazily via dynamic import. Process-model caveat: `broadcast()` writes to in-process WS state — same-process web + `queue:work` works out of the box; cross-process needs a future pub/sub bridge (Redis/Reverb). Test seam: `_setQueueJobLoadersForTests({ dispatch?, broadcast? })` in `src/queue-job.ts` swaps both loaders for fakes — never import outside tests.
- **User memory (#A4 Phase 1+2+3)**: `Agent.remembers() { return { user, inject?, extract?, extractWith?, tags?, injectLimit?, injectTokenBudget? } | false }` opts an agent into per-user fact storage that survives across conversations. Default `false`. Per-call override via `prompt(input, { memory: false | {...} })` — same precedence chain as `conversational()`. Backend lives behind `UserMemory` (`remember`/`recall`/`forget`/`list`/optional `forgetAll`); ship `MemoryUserMemory` in main entry, ORM/embedding backends land at subpath exports in Phase 4/5. Wire a backend via `AiConfig.memory` (binds to the `ai.memory` DI key + module-level `setUserMemory()`). **Phase 2 adds the auto-inject runtime:** `withMemoryInject(spec)` (lives in `src/memory-inject.ts`) is auto-installed by `Agent.prompt`/`Agent.stream` when `inject: 'auto'` — runs as an `onStart` middleware, calls `recall(spec.user, latestUserText, { limit: spec.injectLimit, tags: spec.tags })`, and prepends matched facts to `ctx.messages[0]` as a `<user-memory>` block. Token budget enforcement via `spec.injectTokenBudget` (drops lowest-score facts first; ~4 chars/token approximation, override via `MemoryInjectOptions.estimateTokens`). **Phase 3 adds the auto-extract runtime:** `withMemoryExtract(spec)` (lives in `src/memory-extract.ts`) is auto-installed when `extract: 'auto'` AND `extractWith` is set — runs in `onFinish` (only on successful runs), pulls the latest `[user, assistant]` turn from `ctx.messages`, calls a one-shot anonymous agent on the small model (`extractWith`) with an `Output.object({ schema })` prompt, filters by `MemoryExtractOptions.threshold` (default 0.7), unions `spec.tags` into each entry, and writes via `mem.remember()`. Failures (network, JSON parse, schema, write) route through `onError` and are otherwise swallowed — the parent run never breaks. Continuation calls (`options.messages` set) skip BOTH inject AND extract so neither double-fires across tool round-trips. Auto-cascade plumbing uses a private `Symbol.for('rudderjs.ai.extraMiddlewares')` slot on the options object — `getMiddleware(a, options)` appends extras after `agent.middleware()`. **Poisoning pitfall (Phase 3):** auto-extract trusts the user's own conversation as input — pair with `MemoryExtractOptions.onExtracted` for an audit log when shipping to production; tighten the threshold past 0.7 if your domain is high-risk. **Phase 4 adds `OrmUserMemory`** at `@rudderjs/ai/memory-orm` — production-grade backend that persists rows via the registered `@rudderjs/orm` adapter (Prisma today; Drizzle when its tables are wired). Schema reference is exported as `userMemoryPrismaSchema` (also lives at `playground/prisma/schema/ai.prisma`). Tags are JSON-encoded into a `String?` column; tag-filter recall happens JS-side after fetch (pushing tag arrays into the WHERE is adapter-specific and lands in a follow-up). Recall is OR-of-LIKE on the `fact` column matching `MemoryUserMemory`'s token-overlap semantics. The schema ships an intentionally-nullable `embedding Bytes?` column so Phase 5's `EmbeddingUserMemory` lands as additive — no migration needed.

## Stream Chunk Types

`text-delta` | `tool-call` | `tool-result` | `tool-update` (progress) | `pending-client-tools` | `pending-approval` | `handoff`

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
pnpm test       # tsx --test
```

## Pitfalls

- Provider SDKs are optional — install only the ones you use (`@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime` for Bedrock)
- **OpenRouter** uses the `openai` SDK with a different base URL — installs nothing extra. Optional `siteUrl` / `siteName` config flow through `OpenAIConfig.defaultHeaders` as `HTTP-Referer` / `X-Title` for OpenRouter analytics.
- **Bedrock v1 supports Anthropic Claude models only** — passing `meta.*` / `amazon.*` / `cohere.*` / `mistral.*` / `ai21.*` model ids throws at adapter construction time with guidance. Other families can be added in follow-up PRs. The `isAnthropicOnBedrock()` helper also matches cross-region inference profiles (`us.anthropic.*`, `eu.anthropic.*`, `apac.anthropic.*`).
- **Bedrock auth uses the AWS credential chain** — env vars, IAM roles on EC2/ECS/Lambda, `~/.aws/credentials`. Don't pass static keys in app code; only set `BedrockConfig.credentials` for niche multi-account explicit-creds cases.
- `exactOptionalPropertyTypes` in tsconfig causes issues if you pass `undefined` for optional tool params
- The `observers.ts` subpath export is for telescope integration — don't import it in normal app code
