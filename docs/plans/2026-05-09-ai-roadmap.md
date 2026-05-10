# @rudderjs/ai — Roadmap

**Status:** roadmap only — per-feature plans get written when each item is picked up.
**Date:** 2026-05-09 (initial), updated 2026-05-09 with Laravel AI SDK 13.x parity gaps.
**Scope:** Two ranked tracks — *forward-looking additions* (going beyond Vercel/Prism/OpenAI Agents) and *Laravel parity gaps* (Laravel AI SDK 13.x features we're missing).

The shape of this doc is intentional: a ranked, scoped backlog with design sketches that's enough to start any single item without a fresh discovery pass, but stops short of full implementation specs.

> **Companion doc:** `2026-05-09-mcp-roadmap.md` covers `@rudderjs/mcp` parity gaps from the same Laravel comparison.

---

## Recommended sequence

### Track A — Forward-looking additions

| # | Item | Scope | Why this slot |
|---|---|---|---|
| A1 | Prompt caching ✓ | S (~1 wk) | Pays for itself day one. Smallest scope, biggest immediate $ ROI. *Shipped 2026-05-09 (Anthropic / OpenAI / Google in 3 sub-PRs).* |
| A2 | Handoffs ✓ | S (~3–5 d) | Small, complements `asTool`. Closes the multi-agent picture. *Shipped 2026-05-10.* |
| A2.5 | `asTool()` streaming + sub-agent suspend/resume | S (~2.5 d) | Richer call-and-return shape; absorbs ~700 LOC of bespoke plumbing from `@pilotiq-pro/ai`. See `2026-05-09-asTool-streaming-and-suspend.md`. |
| A3 | MCP ↔ Agent bridge ✓ | S (~3–4 d) | Closes the loop between our two AI packages. Small surface. *Shipped 2026-05-10.* |
| A4 | User memory (Mem0-style) ✓ | M (~2 wk) | Personalized agents — clear customer ask once A1–A3 land. *Shipped 2026-05-10 (5 phases: in-memory → auto-inject → auto-extract → ORM backend → embedding backend).* |
| A5 | Eval framework ✓ | L (~2–3 wk) | Most valuable long-term, but needs real surface area to test. *Shipped 2026-05-10 (5 phases: framework → CLI/JSON → metrics → record/replay → HTML report).* |
| A6 | Cost / budget enforcement | M (~1 wk) | Production-only need; defer until customers are in prod. |
| A7 | Computer-use abstraction | L (~2 wk) | Narrowest use case + heaviest infra; last. |

### Track B — Laravel parity gaps

| # | Item | Scope | Why this slot |
|---|---|---|---|
| B1 | Provider failover for `Image` / `Audio` / `Transcription` | XS (~½ d) | Trivial extension; agents already have it. |
| B2 | `AiFake.preventStrayPrompts()` | XS (~½ d) | Fakes silently pass when nothing was sent — a real test-correctness gap. |
| B3 | Auto-persist conversation behavior | S (~3 d) | Devs forget to call `forUser` / `continue`. Auto-thread is the Laravel default. |
| B4 | Bedrock provider ✓ | S (~3 d) | Enterprise. AWS customers won't adopt without it. *Shipped 2026-05-10 (Anthropic Claude on Bedrock; other families pending demand).* |
| B5 | OpenRouter provider ✓ | S (~3 d) | Routing/failover layer popular for cost optimization. *Shipped 2026-05-10.* |
| B6 | `broadcastOnQueue()` integration | S (~2 d) | Background AI → live UI without polling. We have `@rudderjs/broadcast` + `queue()` separately; just glue. |
| B7 | Vector storage in ORM + `SimilaritySearch` tool | M (~1 wk) | Lives in `@rudderjs/orm`, not `ai`. Real RAG ergonomics. |
| B8 | Hosted vector stores + `FileSearch` provider tool | M (~1 wk) | Wraps OpenAI/Gemini hosted stores. |
| B9 | ElevenLabs provider | S (~2 d) | Premium TTS/STT. |
| B10 | VoyageAI provider | S (~2 d) | Best-in-class embeddings + reranking. |

**Dependencies:**
- A5 (evals) benefits from A1 (caching) to keep eval costs down.
- A4 (memory) benefits from A5 to validate fact-extraction quality, but doesn't block on it.
- B7 (vector ORM) blocks B8 conceptually — pick one up at a time.
- All others are independent.

**Suggested global order (interleaved):** B1 → B2 → A1 → B3 → B4/B5 → A2 → A3 → B6 → A4 → B7 → B8 → A5 → A6 → A7 → B9/B10. P0 cleanups first, then alternate forward-looking with parity work to keep momentum.

---

## Track A — Forward-looking additions

## A1. Prompt caching as a first-class API — ✓ shipped 2026-05-09

**Problem.** Anthropic, OpenAI, and Google all offer 50–90% discounts for cached prompts (system messages, tool definitions, few-shot examples, large context). The SDK-level ergonomics today are awful — every provider exposes it differently:
- **Anthropic:** explicit `cache_control: { type: 'ephemeral' }` on content blocks.
- **OpenAI:** automatic for prompts > 1024 tokens, with `prompt_cache_key` for routing affinity.
- **Google:** explicit `cachedContent` resources you create + reference by id.

**Design.** Add a unified declaration on `Agent`:

```ts
class SupportAgent extends Agent {
  instructions() { return /* long system prompt */ }
  tools() { return [/* big tool list */] }

  cacheable() {
    return ['instructions', 'tools', { messages: 'oldest-2' }] as const
  }
}
```

Per-call override: `agent.prompt(input, { cache: false })`.

Provider adapters translate the declaration to native primitives. For Google's resource-based cache, the registry maintains a hash → cache-id table behind the scenes.

**Stretch:** auto-detect — if `instructions().length > N`, cache it. Off by default; opt in via `Agent.autoCacheable: true`.

**Out of scope:** prompt cache stats / hit-rate observability. Telescope can add that as a follow-up.

**Effort:** ~1 week. Adapter changes: anthropic, openai, google. Tests for each.

---

## A2. Handoffs — ✓ shipped 2026-05-10

**Problem.** `asTool()` is "call a subagent and get a result back." Sometimes you want **control transfer** — the parent agent steps out, the child agent owns the rest of the conversation. Triage → specialist (intake bot → sales bot → support bot) is the canonical case.

**Shipped.** `handoff(AgentClass, { when?, name?, description?, inputSchema? })` factory in `packages/ai/src/handoff.ts`. The returned tool is tagged with `Symbol.for('rudderjs.ai.handoff')`; the agent loop detects it in `runToolPhaseSerial` and short-circuits — no `execute()` runs. Default schema `{ message: string }`; the model writes a transition prompt that becomes the child's first user message. The full prior conversation log carries forward (parent's system message stripped; the child prepends its own `instructions()`).

A `'handoff'` `StreamChunk` is emitted right before control transfers. `AgentResponse.handoffPath` records the chain of class names traversed (e.g. `['Triage', 'Sales']`). Multi-hop is supported; `MAX_HANDOFFS = 5` bounds runaway cycles. Sibling tool calls in the same step as a handoff are skipped with synthetic "skipped: handed off" tool results so the message log stays well-formed for replay. Handoffs always force serial dispatch (override of `parallelTools`).

**Decisions locked in:**
- Full history forwarded (no summarization) — matches the open-question default.
- Between-step transitions only — a handoff tool call ends the current step and the parent loop.
- Multi-hop: child agents with their own handoff tools work without special handling — driven by an iterative driver in `runAgentLoop` / `runAgentLoopStreaming`.
- New `FinishReason` enum value was deliberately *not* added — observers see the parent's last step finish as `'tool_calls'` (unchanged) and the merged response's `finishReason` is the child's. Adding `'handed_off'` would cost surface area without clear benefit; can be added later if observers want it.

**Out of scope (potential follow-ups):**
- Custom history-shaping hooks (summarize-before-handoff, drop-tool-results, etc.).
- Handoffs across the `parallelTools: true` path — currently always serial.
- Cross-process handoffs (handing off mid-conversation across services).

---

## A3. MCP ↔ Agent bridge — ✓ shipped 2026-05-10

**Problem.** `@rudderjs/mcp` exists. `@rudderjs/ai` exists. Two obvious connectors are missing:

```ts
// (a) Connect to an MCP server, expose its tools to an agent
const tools = await mcpClientTools('https://api.example.com/mcp')
class MyAgent extends Agent { tools() { return tools } }

// (b) Expose an agent's tools as an MCP server
const server = mcpServerFromAgent(myAgent)
server.listen({ port: 3001 })
```

**Effort:** ~3–4 days. Mostly glue code; both packages already have the right primitives.

**Cross-package:** lives in `@rudderjs/ai` with a peer dep on `@rudderjs/mcp` (or vice-versa). To decide when picked up.

---

## A4. User memory beyond conversation history — ✓ shipped 2026-05-10

**Problem.** `forUser(userId)` persists message history. It does **not** persist *facts*. If Alice tells the bot her project is named "Foo" in conversation #1, the bot won't know that in conversation #2 unless the entire history is replayed (expensive, lossy, sometimes prohibited by retention policies).

**Design.** A second persistence interface alongside `ConversationStore`:

```ts
interface UserMemory {
  remember(userId: string, fact: string,            opts?: { tags?: string[] }): Promise<MemoryEntry>
  recall  (userId: string, query: string,           opts?: { limit?: number   }): Promise<MemoryEntry[]>
  forget  (userId: string, factId: string                                       ): Promise<void>
  list    (userId: string                                                       ): Promise<MemoryEntry[]>
}
```

Three reference implementations:
- `MemoryUserMemory` — process-local (tests/dev).
- `OrmUserMemory` — Prisma/Drizzle table, full-text search.
- `EmbeddingUserMemory` — vector store, cosine recall. Pairs with our existing embedding API.

**Auto-injection:** `withMemory({ inject: 'auto' })` runs `recall()` on every prompt and prepends matching facts to the system message.

**Auto-extraction:** post-conversation middleware that distills facts via a small model:

```ts
withMemory({
  extract: 'auto',                  // uses a small model
  extractWith: 'anthropic/claude-haiku-4-5',
})
```

**Pitfalls to flag in design phase:**
- Privacy / GDPR right-to-be-forgotten — `forget()` needs to reach embeddings too.
- Memory poisoning — a malicious user can plant adversarial "facts." Auto-extraction needs a confidence threshold and observability.
- Token budget — auto-injection has to cap how many facts get prepended.

**Effort:** ~2 weeks. Interface + 3 backends + auto-inject middleware + auto-extract middleware + tests.

---

## A5. Built-in eval framework — ✓ shipped 2026-05-10

**Problem.** Testing AI is the #1 unsolved production problem. Right now apps have `AiFake` for unit tests but no story for "does the agent actually do the right thing on real models?" Vercel ships `evalite`; Anthropic ships `claude-evals`; OpenAI has `evals`. None are framework-integrated. We can do better.

**Design.**

```ts
// evals/support-agent.eval.ts
import { evalSuite, llmJudge, jsonShape } from '@rudderjs/ai/eval'
import { SupportAgent } from '../app/Agents/SupportAgent.js'

export default evalSuite('SupportAgent', {
  agent: () => new SupportAgent(),
  cases: [
    { input: 'How do I reset my password?',
      assert: llmJudge('mentions the password reset link') },
    { input: 'Refund please',
      assert: jsonShape({ type: 'handoff', target: 'BillingAgent' }) },
  ],
  metrics: ['exactMatch', 'llmJudge', 'tokenCost'],
})
```

CLI: `pnpm rudder ai:eval [pattern]` — runs suites, writes report.

**Built-in metrics (v1):**
- `exactMatch` — string equality.
- `regex` — pattern match.
- `jsonShape` — structural match against a zod schema.
- `semanticMatch` — cosine similarity vs reference.
- `llmJudge` — judge prompt + small model returns pass/fail with reasoning.
- `tokenCost` — passes if usage under threshold.

**Output formats:**
- Console table (default).
- JSON for CI integration.
- HTML report (stretch).

**Integration:**
- Reuses `AiFake` for deterministic replay of recorded sessions.
- Telescope records eval runs separately so dashboards show "agent quality over time."

**Effort:** ~2–3 weeks. Big surface area but the framework matters more than the metrics catalog — ship 3 metrics, accept user-defined ones via interface.

**Out of scope:** golden-dataset versioning, A/B testing runner, paid eval-as-a-service. Keep this in-process and local.

---

## A6. Cost / budget enforcement

**Problem.** Production apps need per-user cost caps. Today users do this manually with `onUsage` middleware + a database row. Should be built in.

**Design.**

```ts
import { withBudget, ModelPricing } from '@rudderjs/ai'

// In bootstrap or per-agent
const budgeted = withBudget({
  budget: ({ user }) => ({ daily: 0.50, monthly: 10 }),  // USD
  pricing: ModelPricing,                                  // built-in catalog
  storage: ormBudgetStorage,                              // persists usage
  onExceeded: ({ user, period }) => { throw new BudgetExceededError(...) },
})

class MyAgent extends Agent {
  middleware() { return [budgeted] }
}
```

- `ModelPricing` ships as a catalog of `{ provider, model } → { inputPer1K, outputPer1K }`. Updates land via changesets when providers change pricing.
- `BudgetStorage` interface so apps swap in Redis / ORM / Pulse counters.

**Pitfalls:**
- Pricing drift. Provider-published pricing changes monthly. Need a clear "this is a snapshot, override if your contract differs" message.
- Discount tiers (volume contracts). Allow per-app pricing override.

**Effort:** ~1 week. Mostly storage + middleware + pricing table.

---

## A7. Computer-use abstraction

**Problem.** Anthropic ships `computer_20241022` (and successors); OpenAI is shipping similar; Google will follow. Users wanting browser automation today have to bind to one provider. A provider-agnostic `ComputerUseTool` would future-proof apps.

**Design.**

```ts
import { computerUseTool } from '@rudderjs/ai'

class BrowserAgent extends Agent {
  tools() {
    return [
      computerUseTool({
        viewport: { width: 1280, height: 800 },
        // Anthropic: maps to native computer-use tool type
        // OpenAI:    wraps as function-call + screenshot loop
      }),
    ]
  }
}
```

- The tool internally drives a headless Chromium (`@playwright/test`'s server, or `puppeteer-core`).
- Provider adapters translate to native primitives where supported, fall back to function-call + screenshot on others.
- Returns same chunk shape regardless of provider.

**Pitfalls:**
- Headless browser infra is *heavy*. Don't bundle it — make the browser driver an interface (`ComputerEnvironment`) and ship two implementations: `playwrightEnvironment()`, `dockerSandboxEnvironment()` (for cloud).
- Sandbox safety — computer-use is the highest-blast-radius tool we'll ship. Default `needsApproval: true`.
- Cost of screenshots (huge token usage). Document the cost model loudly.

**Effort:** ~2 weeks. Tool abstraction + 1 reference environment + safety defaults + tests.

---

## Track B — Laravel parity gaps

Discovered 2026-05-09 by feature-by-feature comparison against [Laravel AI SDK 13.x](https://laravel.com/docs/13.x/ai-sdk). Each item is something Laravel ships that we don't, and that has clear customer/practical value (excluding Laravel-isms like PHP attributes or Stringable mixins).

## B1. Provider failover for `Image` / `Audio` / `Transcription`

**Problem.** `Agent.prompt()` accepts `failover: ['anthropic/...', 'openai/...']` and walks the list on transient errors. `ImageGenerator`, `AudioGenerator`, and `Transcription` don't — a single provider blip breaks the call.

**Design.** Each operation already takes a `provider`/`model` argument. Accept an array form:

```ts
await ImageGenerator.generate('A donut', { providers: ['openai/dall-e-3', 'google/imagen-3'] })
```

Reuse the agent loop's failover logic — extract to `runWithFailover(operation, providers)` in `registry.ts`, share between agent + non-agent paths.

**Effort:** ~½ day. Extract + 3 callsite changes + tests.

---

## B2. `AiFake.preventStrayPrompts()`

**Problem.** Today `AiFake.assertPrompted(...)` checks a positive expectation. There's no negative-side assertion that nothing *unexpected* was sent. A test that forgets to assert anything still passes — silent gap.

**Design.** Mirror Laravel's helper:

```ts
const fake = AiFake.use().preventStrayPrompts()
// any agent.prompt() call without a matching .fakeResponse() throws
```

Behavior: when the fake receives a prompt and no scripted response matches, throw `StrayPromptError` instead of falling back to a default. Companion `assertNeverPrompted()` for explicit assertion.

**Effort:** ~½ day. Add to `fake.ts` + tests.

---

## B3. Auto-persist conversation behavior

**Problem.** `forUser(userId)` and `continue(conversationId)` exist but require explicit calling. Devs forget — and the failure mode (silent loss of conversation history) is the worst kind. Laravel's `RemembersConversations` trait makes this opt-in *once* at the agent class, then auto-loads/auto-stores on every prompt.

**Design.** Mixin or base class option:

```ts
class ChatAgent extends Agent {
  static remembersConversations = true        // class-level opt-in
  // Or, equivalently:
  conversational(): { user: string; id?: string } {
    return { user: ctx().user.id }
  }
}

// Usage: no explicit forUser/continue
const r = await new ChatAgent().prompt('Hi')
//   ↑ auto-loads thread for ctx user, auto-saves the new turn
```

Implementation:
- Hook into `runAgentLoop` between input-message construction and provider call.
- Read `conversational()` (or static flag); if set, fetch history + prepend; on completion, persist.
- Storage continues to go through `ConversationStore` interface (already shipped).

**Pitfalls:**
- Decide whether `forUser()` overrides the auto-behavior or stacks. Suggest: `forUser` always wins.
- ALS for `ctx()` needs to work in non-HTTP runtimes (queue jobs, CLI commands).

**Effort:** ~3 days. Hook + storage call + tests + docs.

---

## B4. Bedrock provider — ✓ shipped 2026-05-10

**Problem.** AWS-shop customers can't adopt RudderJS for AI without Bedrock. Anthropic models on Bedrock are particularly common.

**Shipped.** `packages/ai/src/providers/bedrock.ts`. Lazy-loaded `@aws-sdk/client-bedrock-runtime`. Region from config; auth via the AWS credential chain (env vars, IAM roles, `~/.aws/credentials`) by default — explicit `credentials` accepted but discouraged. Streams via `InvokeModelWithResponseStreamCommand`; non-streaming via `InvokeModelCommand`. Reuses Anthropic conversion helpers (system/messages/tools, prompt-cache markers via `cache_control`) since v1 supports Anthropic Claude on Bedrock only — `meta.*` / `amazon.*` / `cohere.*` / `mistral.*` / `ai21.*` model ids throw at adapter construction with guidance.

Recognized model prefixes: `anthropic.*`, `us.anthropic.*`, `eu.anthropic.*`, `apac.anthropic.*` (the last three are cross-region inference profiles).

**Out of scope:** non-Anthropic Bedrock model families. Add as follow-up PRs when there's customer demand — each family needs its own request/response shape conversion.

---

## B5. OpenRouter provider — ✓ shipped 2026-05-10

**Problem.** OpenRouter is a popular cost-optimization layer — single API, dozens of models, automatic fallback, often cheaper. Users want to point one config key at OpenRouter and access everything.

**Shipped.** `packages/ai/src/providers/openrouter.ts`. Wraps `OpenAIAdapter` with `https://openrouter.ai/api/v1` as the base URL. Optional `siteUrl` / `siteName` config flow through a small `OpenAIConfig.defaultHeaders` extension as `HTTP-Referer` / `X-Title` for OpenRouter analytics.

`AiRegistry.parseModelString()` already splits on the *first* slash, so OpenRouter's two-slash model strings (`openrouter/anthropic/claude-3.5-sonnet`) parse cleanly into provider `openrouter` + model `anthropic/claude-3.5-sonnet`.

**Out of scope:** OpenRouter-specific extensions (provider preferences, route hints). Currently passable via `providerOptions` if needed; first-class API can land later if demand justifies.

---

## B6. `broadcastOnQueue()` integration

**Problem.** Background AI work + live UI = polling today. Laravel ships `broadcastOnQueue($prompt, $channel)` — single call kicks off a queued prompt and streams progress to a channel.

**Design.** Add to `QueuedPromptBuilder`:

```ts
await new SupportAgent()
  .queue('Help with refund request')
  .broadcast(`user.${userId}.support`)        // channel
  .send()
```

Implementation:
- Read `@rudderjs/broadcast` lazily via `resolveOptionalPeer()`.
- The queued job runs `agent.stream(...)`; each chunk is broadcast to the channel.
- Final `AgentResponse` broadcast as a `done` event.

**Effort:** ~2 days. Builder method + queue-job glue + integration test in playground.

---

## B7. Vector storage in ORM + `SimilaritySearch` tool

**Problem.** Every RAG app today rolls its own pgvector glue. Laravel ships `Schema::vector('col', dimensions: 1536)`, `whereVectorSimilarTo`, `selectVectorDistance`, plus `SimilaritySearch::usingModel(Model::class, 'col')` as a drop-in agent tool.

**Design (lives in `@rudderjs/orm`, NOT `@rudderjs/ai`):**

```ts
// schema.prisma — add via migration helper
ALTER EXTENSION pgvector;
ALTER TABLE documents ADD COLUMN embedding vector(1536);
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);

// Model
class Document extends Model {
  static schema = {
    embedding: vector({ dimensions: 1536 }),
  }
}

// Query
const docs = await Document
  .whereVectorSimilarTo('embedding', queryEmbedding, { minSimilarity: 0.4 })
  .limit(10)
  .get()
```

Plus the agent-side tool in `@rudderjs/ai`:

```ts
class KnowledgeAgent extends Agent {
  tools() {
    return [
      similaritySearch({
        model:         Document,
        column:        'embedding',
        minSimilarity: 0.7,
        limit:         10,
        scope:         (q) => q.where('published', true),
      }),
    ]
  }
}
```

**Pitfalls:**
- Postgres-only initially. Document this loudly.
- Prisma vs Drizzle adapters need separate impls — Prisma exposes raw SQL escape hatch; Drizzle has `pgvector`-like helpers.
- Auto-embed query strings: `whereVectorSimilarTo('embedding', 'natural language query')` → calls embedder under the hood. Need an opt-in to avoid surprise API calls.

**Effort:** ~1 week. Cross-package: ORM column type + query builder helpers + AI tool + migration helper + tests.

---

## B8. Hosted vector stores + `FileSearch` provider tool

**Problem.** OpenAI and Gemini both ship hosted vector store APIs. Laravel wraps them in a `Stores` facade and exposes a `FileSearch` provider tool. We have neither.

**Design.**

```ts
// Vector store management
const store = await VectorStores.create('Knowledge Base')
await store.add(Document.fromPath('./report.pdf'), { metadata: { author: 'Alice' } })

// Provider tool
class SupportAgent extends Agent {
  tools() {
    return [
      fileSearch({
        stores: [store.id],
        where:  { author: 'Alice', year: 2026 },
      }),
    ]
  }
}
```

Behind the scenes the tool maps to OpenAI's `file_search` or Gemini's equivalent — provider tools, no execute on our side.

**Effort:** ~1 week. `VectorStores` API + provider-tool definition + 2 provider adapters + tests.

---

## B9. ElevenLabs provider

**Problem.** Premium voice synthesis (TTS) and transcription (STT). Customers shipping voice apps need it.

**Design.** New `packages/ai/src/providers/elevenlabs.ts`. ElevenLabs has its own SDK (`elevenlabs-node` or direct REST). Implements `TextToSpeechAdapter` + `SpeechToTextAdapter`. No text generation.

**Effort:** ~2 days.

---

## B10. VoyageAI provider

**Problem.** Best-in-class embeddings (`voyage-3`, `voyage-large-2`) and reranking (`rerank-2.5`). Cohere is the closest, but VoyageAI consistently wins benchmarks.

**Design.** New `packages/ai/src/providers/voyageai.ts`. Implements `EmbeddingAdapter` + `RerankingAdapter`. No text generation.

**Effort:** ~2 days.

---

## Items considered but rejected (for now)

**Forward-looking:**
- **Realtime / voice agents.** Different transport (WebSocket), different lifecycle. Justifies its own package, not a feature inside `@rudderjs/ai`. Revisit when there's real demand.
- **Workflow orchestration (Mastra-style).** Over-engineered for the apps people are building. `prepareStep`, `stopWhen`, `asTool`, and handoffs cover 90% of real workflows. Keep the surface small.
- **Fine-tuning / training hooks.** Provider-specific, low value, complex. Out of scope.
- **Multi-modal *output* (image gen mid-conversation).** We have `Image.generate()` already. The agent loop doesn't need to emit images — let the user wire that up.
- **Concurrency primitives (parallel agents merge).** `Promise.all([a.prompt(...), b.prompt(...)])` already works. No abstraction needed.

**Laravel-isms not worth porting:**
- **PHP-style attributes (`#[Provider]`, `#[Model]`, `#[Temperature]`).** We use methods on the Agent class. TS decorators would be awkward and bring metadata-emit baggage.
- **Stringable mixins (`Str::of('...').toEmbeddings()`).** No JS pattern equivalent. `Embeddings.generate('...')` is fine.
- **Eloquent collection sugar (`$collection->rerank('field', query)`).** `Reranker.rerank({ documents, query, by: 'field' })` is plenty.
- **`UseCheapestModel` / `UseSmartestModel` attributes.** Niche, easily user-implemented.
- **`vendor:publish` for stub config files.** Not how npm/scaffolders work.

---

## Our advantages over Laravel AI SDK (as of 2026-05-09)

Worth tracking because some of these are real differentiators in marketing.

- **`Agent.asTool()`** — first-class subagents (Laravel has none).
- **`async function*` streaming tools** with `tool-update` chunks for progress.
- **`pauseForClientTools`** control-chunk for browser-side tool execution.
- **`needsApproval` per-tool approval gates** with resume.
- **Runtime-agnostic main entry** — runs in React Native, Electron renderer, browser. Laravel is server-only.
- **Richer middleware surface** — `onConfig`/`onChunk`/`onBeforeToolCall`/`onAfterToolCall`/`onUsage`/`onAbort`/`onError`.
- **Vercel protocol bridge** — `toVercelResponse()` for SDK compat with Vercel AI SDK clients.
- **`AiFake` with deterministic replay** (preventStrayPrompts pending — see B2).

---

## Open questions across all items

1. **Should "prompt caching" + "user memory" + "budget" share a unified `AgentContext` interface?** Right now each is its own middleware. Worth revisiting after A1 ships.
2. **CLI command surface.** Do we want `rudder ai:eval`, `rudder ai:cost`, `rudder ai:memory:list` etc., or one `rudder ai <subcommand>` group? Lean toward subcommand group — keeps top-level help clean.
3. **Cross-package or within `@rudderjs/ai`?** Eval framework and computer-use are big enough to justify their own packages (`@rudderjs/ai-eval`, `@rudderjs/computer-use`). Decide per-feature when picking up.
4. **Vector ORM ownership.** B7 lives in `@rudderjs/orm` — is the AI tool (`similaritySearch`) better in `@rudderjs/ai` (depends on orm) or in `@rudderjs/orm` (depends on ai)? The dep graph is currently ai → no orm dep. Picking ai-side keeps orm small but means the tool is opt-in only when ai is installed. Lean toward ai-side.
