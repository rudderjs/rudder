# AI

`@rudderjs/ai` is a provider-agnostic agent framework. Define an agent once, swap between Anthropic, OpenAI, Google, Ollama, Groq, DeepSeek, xAI, Mistral, and others by changing one config string. The framework handles tool calling, streaming, middleware hooks, structured output, multi-modal attachments, conversation persistence, and a test fake.

```ts
import { agent } from '@rudderjs/ai'

const response = await agent('You are a helpful assistant.')
  .prompt('Summarize the transformer architecture in one sentence.')

console.log(response.text)
```

This guide covers agents, tools, streaming, and testing. For image generation, TTS/STT, embeddings, reranking, and the Vercel AI SDK adapter, see the [`@rudderjs/ai` README](https://github.com/rudderjs/rudder/tree/main/packages/ai).

## Setup

```bash
pnpm add @rudderjs/ai
pnpm add @anthropic-ai/sdk      # Anthropic
pnpm add openai                  # OpenAI
pnpm add @google/genai           # Google
# Ollama, Groq, DeepSeek, xAI, Mistral — no extra SDK
```

Provider SDKs are optional peers — install only what you use. Each adapter lazy-loads its SDK on first call.

```ts
// config/ai.ts
import type { AiConfig } from '@rudderjs/ai'

export default {
  default: 'anthropic/claude-sonnet-4-6',
  providers: {
    anthropic: { driver: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
    openai:    { driver: 'openai',    apiKey: process.env.OPENAI_API_KEY! },
    ollama:    { driver: 'ollama',    baseUrl: 'http://localhost:11434' },
  },
} satisfies AiConfig
```

Models are always `provider/model`. A bare model name throws.

The provider is auto-discovered.

## Runtime compatibility

`@rudderjs/ai` works in any `fetch`-capable JS runtime — Node, browser, Electron (main and renderer), React Native. The main entry has zero `node:*` static imports.

| Import | Runtimes | What's inside |
|---|---|---|
| `@rudderjs/ai` | Node, browser, RN, Electron | Agents, tools, streaming, providers, attachments, structured output |
| `@rudderjs/ai/node` | Node only | `documentFromPath()`, `imageFromPath()`, `transcribeFromPath()` filesystem helpers |
| `@rudderjs/ai/server` | Node only | `AiProvider` (the framework `ServiceProvider`, auto-discovered) |

In a client runtime use byte-based factories instead of paths:

```ts
import { Image } from '@rudderjs/ai'

const img = Image.fromBase64(cameraBase64, 'image/jpeg')
const url = await Image.fromUrl('https://example.com/photo.jpg')
```

Calling LLM providers directly from a browser or RN client leaks your API key — use a server-side proxy in production. The main client-side use case is BYOK desktop apps.

## Three agent shapes

Pick whichever reads best at the call site:

```ts
import { agent, AI, Agent, stepCountIs } from '@rudderjs/ai'

// Inline, one-off
const r1 = await agent('You summarize text.').prompt('Summarize this...')

// Facade with the default model
const r2 = await AI.prompt('Hello world')

// Configured anonymous agent — tools + options together
const r3 = await agent({
  instructions: 'You help find users.',
  model: 'anthropic/claude-sonnet-4-6',
  tools: [searchTool],
}).prompt('Find all admins')

// Reusable typed class
class SearchAgent extends Agent {
  instructions() { return 'You help find users.' }
  model()        { return 'anthropic/claude-sonnet-4-6' }
  tools()        { return [searchTool] }
  stopWhen()     { return stepCountIs(5) }
}
const r4 = await new SearchAgent().prompt('Find all admins')
```

Generate a typed agent class with `pnpm rudder make:agent Search`.

## Tools

Tools let the agent call your code. Define a tool with `toolDefinition(...)`, declare its input schema with Zod, and attach a `.server()` handler:

```ts
import { toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'
import { User } from '../app/Models/User.js'

const searchTool = toolDefinition({
  name:        'search_users',
  description: 'Search users by name or email',
  inputSchema: z.object({
    query: z.string().describe('Name or email substring'),
    limit: z.number().int().min(1).max(50).default(10),
  }),
}).server(async ({ query, limit }) => {
  return User
    .where('name', 'LIKE', `%${query}%`)
    .orWhere('email', 'LIKE', `%${query}%`)
    .limit(limit)
    .get()
})
```

The agent decides when to call tools based on the prompt. Tool calls and results both flow through the response — inspect `response.steps` for the full trace, including each call's `duration` (wall-clock ms in `execute()`).

**Argument validation.** The agent validates each tool call's arguments against `inputSchema` before invoking `.server(...)`, so your handler always receives the parsed value (zod transforms, defaults, and coercion all apply). When validation fails, the agent feeds an `InvalidToolArgumentsError` back to the model as the tool result so it can correct itself on the next step — your handler never runs with malformed input.

**Parallel execution within a step.** When the model emits more than one tool call in a single step, their `.server()` handlers run concurrently by default. Streamed chunk order is still preserved — tool A's `tool-call → tool-update* → tool-result` always precedes B's — so consumers see deterministic sequences regardless of which tool finishes first. Approval gates and `onBeforeToolCall` middleware decisions still resolve serially in tool-call order before any handler runs. Opt out when tools share non-idempotent state:

```ts
await agent('…').prompt('go', { parallelTools: false })
```

Or per agent:

```ts
class CounterAgent extends Agent {
  parallelTools() { return false }
  // …
}
```

**Client tools** — omit `.server()` and the loop pauses, surfacing the call as `pendingClientToolCalls` on the response so the browser can execute it and resume. See the [package README](https://github.com/rudderjs/rudder/tree/main/packages/ai) for the resume protocol.

## Hosted vector stores & RAG

`fileSearch({ stores })` is a first-class agent tool for retrieval-augmented generation backed by a provider-hosted vector store. The provider runs ingestion, chunking, embedding, and search server-side; the model invokes the native tool block (OpenAI's `file_search` or Gemini's `fileSearch`) and the results land inline in the assistant reply — no tool round-trip, no `execute` to write.

```ts
import { Agent, VectorStores, fileSearch } from '@rudderjs/ai'

// 1. Manage the store
const kb = await VectorStores.create('Knowledge Base')          // OpenAI by default
await kb.add({ filePath: './report.pdf', attributes: { author: 'Alice', year: 2026 } })

// 2. Wire it into an agent
class SupportAgent extends Agent {
  model() { return 'openai/gpt-4o' }
  tools() {
    return [
      fileSearch({
        stores:     [kb.id],
        where:      { author: 'Alice', year: 2026 },   // server-side metadata filter
        maxResults: 10,
      }),
    ]
  }
}
```

Both **OpenAI** (`vectorStores.*`) and **Gemini** (`fileSearchStores`) are supported — same `VectorStores` façade, same `fileSearch({ stores })` surface. Pass `{ provider: 'google' }` to `VectorStores.create(...)` for Gemini.

For self-hosted RAG over a local Postgres + pgvector model, `fileSearch({ ..., fallback })` delegates non-hosted providers to a `similaritySearch` over an ORM model you own — same agent prompt across hosted and self-hosted.

See [Vector Stores](./vector-stores) for the full surface, provider-differences table, and testing patterns.

## Streaming

`agent.stream(...)` returns `{ stream, response }` — a chunk iterator plus a promise that resolves to the full `AgentResponse` after the loop finishes:

```ts
const { stream, response } = agent('You are a helpful assistant.').stream('Tell me a story.')

for await (const chunk of stream) {
  if (chunk.type === 'text-delta')  process.stdout.write(chunk.text ?? '')
  if (chunk.type === 'tool-call')   console.log('Tool called:', chunk.toolCall)
  if (chunk.type === 'tool-update') console.log('Progress:',    chunk.update)
  if (chunk.type === 'tool-result') console.log('Result:',      chunk.result)
}

const final = await response   // resolves after the stream has been consumed
```

Chunk types: `text-delta`, `tool-call`, `tool-update` (per-yield progress from streaming tools), `tool-result`, `pending-client-tools`, `pending-approval`, `usage`, `finish`.

For Vercel AI SDK / `useChat()` interop, convert via `toVercelResponse(stream)` from `@rudderjs/ai`.

## Cancellation

Pass an `AbortSignal` to cancel an in-flight run. The signal is honored at iteration boundaries and forwarded to the provider adapter so the underlying network request is also cancelled. When the signal aborts, `prompt()` rejects (and `stream()`'s `response` promise rejects) with the signal's reason:

```ts
const controller = new AbortController()
setTimeout(() => controller.abort(), 5_000)

try {
  await agent('…').prompt('long task', { signal: controller.signal })
} catch (err) {
  // DOMException: The operation was aborted (or TimeoutError for AbortSignal.timeout())
}

// Or the standard timeout helper:
await agent('…').prompt('…', { signal: AbortSignal.timeout(10_000) })
```

## Multi-step agents

By default an agent does one round-trip: prompt → tool calls → final answer. For multi-step reasoning, set a stop condition:

```ts
import { agent, stepCountIs } from '@rudderjs/ai'

await agent({
  instructions: 'You research and summarize topics.',
  tools: [searchWeb, fetchPage],
  stopWhen: stepCountIs(10),       // up to 10 tool-calling rounds
}).prompt('Research the transformer architecture.')
```

The built-in stop-condition combinators are `stepCountIs(n)` and `hasToolCall(name)`. For anything else, pass a plain `StopCondition` predicate — `({ steps }) => boolean` — to `stopWhen`.

## Sub-agents

A tool's handler can itself invoke another agent. Streaming progress and approval state propagate upstream so the parent agent's UI stays in sync.

The shortest path is `agent.asTool({ name, description })` — wrap an agent as a tool the parent can call. The subagent runs its own loop end-to-end (its own model, tools, middleware) and returns a single result.

```ts
const research = new ResearchAgent().asTool({
  name:        'research',
  description: 'Research a topic in depth.',
})

await agent({ tools: [research], stopWhen: stepCountIs(5) })
  .prompt('Summarize the transformer paper.')
```

Defaults are tuned for the zero-config case: `inputSchema` is `{ prompt: string }` and the parent model only sees `response.text` on its next step. The UI still receives the full `AgentResponse` via the `tool-result` chunk, so dashboards can render rich subagent transcripts without bloating the parent's context.

For a typed input schema, pass `inputSchema` + `prompt`:

```ts
new ResearchAgent().asTool({
  name:        'research',
  description: 'Research a topic in depth.',
  inputSchema: z.object({ topic: z.string(), depth: z.enum(['quick', 'deep']) }),
  prompt:      ({ topic, depth }) => `Research ${topic} at ${depth} depth.`,
  modelOutput: (r) => `${r.steps.length} step(s); ${r.text.slice(0, 280)}…`,
})
```

### Streaming sub-agent progress

Pass `streaming: true` to surface inner-agent progress as `tool-update` chunks on the parent's stream. The default projection emits `agent_start` once, `tool_call` per inner tool call, and `agent_done` once when the sub-agent finishes:

```ts
const research = new ResearchAgent().asTool({
  name:        'research',
  description: 'Research a topic in depth.',
  streaming:   true,
})

const { stream } = agent({ tools: [research] }).stream('summarize that paper')
for await (const chunk of stream) {
  if (chunk.type === 'tool-update' && chunk.update?.kind === 'tool_call') {
    console.log(`subagent calling ${chunk.update.tool}…`)
  }
}
```

For different cadence (e.g. surfacing inner `text-delta` as preview text or per-step usage), pass a projector:

```ts
streaming: (chunk) => chunk.type === 'finish'
  ? { kind: 'agent_step', step: ++n, tokens: chunk.usage?.totalTokens ?? 0 }
  : null
```

### Suspend / resume — sub-agents that pause on client tools or approval

A sub-agent's loop pauses in two cases that the parent loop has to surface upward: when the model emits a *client* tool call (one with no `execute` — handled by the browser) and when a sub-agent's tool with `needsApproval: true` fires. Pass `suspendable: { runStore }` to opt into the propagation protocol — `asTool` handles both pauses symmetrically:

```ts
import { CachedSubAgentRunStore } from '@rudderjs/ai'

const research = new ResearchAgent().asTool({
  name:        'research',
  description: 'Research with browser-side tools and approval-gated actions.',
  streaming:   true,
  suspendable: { runStore: new CachedSubAgentRunStore() },
})
```

When the sub-agent pauses, `asTool` snapshots its message history and yields a suspend update plus a control chunk that halts the parent loop. The snapshot's `pauseKind` discriminator tells the host which resume contract applies:

| Inner `finishReason` | `SubAgentUpdate` emitted | Snapshot `pauseKind` | Parent halts with |
|---|---|---|---|
| `'client_tool_calls'` | `subagent_paused` | `'client_tool'` | `pendingClientToolCalls` |
| `'tool_approval_required'` | `subagent_paused_approval` (and `agent_pending_approval` informationally during the inner stream) | `'approval'` | `pendingApprovalToolCall` |

The host's continuation endpoint resumes via:

```ts
import { Agent } from '@rudderjs/ai'

// Client-tool pause — pass tool results from the browser
const r = await Agent.resumeAsTool(subRunId, browserResults, {
  runStore,
  agent: rebuiltSubAgent,   // host rebuilds the sub-agent context per resume
})

// Approval pause — pass the user's decision
const r2 = await Agent.resumeAsTool(subRunId, [], {
  runStore,
  agent: rebuiltSubAgent,
  approvedToolCallIds: ['inner-call-id'],   // or rejectedToolCallIds
})

if (r.kind === 'completed') {
  // feed r.response.text back into the parent's run_agent tool result
} else {
  // r.kind === 'paused' — r.pauseKind tells you which event to emit upstream
  // ('client_tool' | 'approval'); r.toolCall + r.isClientTool are populated
  // for approval pauses so renderers can show a fresh approval card.
}
```

A resume can pause again on a different kind than it started on — e.g. an approval that, once granted, leads the inner agent to emit a client tool call. The `pauseKind` field on `'paused'` returns lets the host route correctly without inspecting the snapshot.

`InMemorySubAgentRunStore` works for tests / single-process dev; `CachedSubAgentRunStore` plugs into `@rudderjs/cache` for cross-process / cross-restart persistence. Suspend without streaming throws at builder time — silent suspend is a UX trap.

#### Resuming several sub-agents at once

When an orchestrator dispatches several sub-agents in one parent turn and more than one pauses, `Agent.resumeManyAsTool(requests, { runStore })` resumes them as a batch and aggregates their pending tool calls into a single client round-trip, instead of looping over `resumeAsTool` by hand:

```ts
let batch = await Agent.resumeManyAsTool(
  paused.map(p => ({
    subRunId:          p.subRunId,
    agent:             rebuildSubAgent(p),
    clientToolResults: resultsBySubRun[p.subRunId],   // or approvedToolCallIds / rejectedToolCallIds
    key:               p.subRunId,                    // echoed back for correlation
  })),
  { runStore },
)

// batch.completed / batch.paused / batch.errors partition the outcomes.
// batch.pendingToolCallIds is the combined set to gather the next round for.
// Re-call with each paused item's NEW subRunId until batch.allCompleted.
```

Each request carries its own `agent` (the sub-agents may be different classes). Options: `onError: 'capture'` (default — a bad item becomes a `{ kind: 'error' }` outcome and the rest still resume) or `'throw'` (reject the whole batch); `concurrency: 'parallel'` (default) or `'serial'` (deterministic side-effect order).

### Hand-rolled sub-agent tools

For full control — custom progress shape, sub-agent token-deltas as `tool-update` chunks, anything outside the `asTool` envelope — write the wrapping tool by hand:

```ts
const research = toolDefinition({
  name:        'research',
  description: 'Research a topic in depth',
  inputSchema: z.object({ topic: z.string() }),
}).server(async ({ topic }) => {
  return await new ResearchAgent().prompt(topic)
})
```

## MCP integration

`@rudderjs/ai/mcp` bridges agents and Model Context Protocol servers in both directions. Optional peer: `@modelcontextprotocol/sdk`.

```ts
import { mcpClientTools, mcpServerFromAgent } from '@rudderjs/ai/mcp'
```

### Consume MCP tools in an agent — `mcpClientTools(transport, opts?)`

Connect to a remote MCP server and surface its tools to an agent. Three transport shapes:

```ts
// HTTP transport
const tools = await mcpClientTools('https://api.example.com/mcp')

// Local subprocess (stdio)
const tools = await mcpClientTools({ command: 'npx', args: ['some-mcp-server'] })

// Already-connected SDK Client (caller owns lifecycle)
const tools = await mcpClientTools(myClient)

class ResearchAgent extends Agent {
  instructions() { return 'You can call remote MCP tools.' }
  tools() { return tools }
}
```

The remote server's JSON Schema flows directly to providers via the `jsonSchema` passthrough on `ToolDefinitionOptions` — no zod round-trip in either direction. When this connector owns the underlying client (URL or stdio transport), the returned array carries a non-enumerable `close()` for shutdown:

```ts
const tools = await mcpClientTools('https://api.example.com/mcp')
// ... use tools in agent ...
await tools.close?.()
```

Options: `filter` (drop tools by name), `namePrefix` (avoid collisions across multiple servers), `streaming` (forward MCP `notifications/progress` as `tool-update` chunks; default `true`).

### Expose an Agent as an MCP server — `mcpServerFromAgent(AgentClass, opts?)`

Wrap an `Agent` so external MCP clients (Claude Desktop, Cursor, etc.) can call it. Returns an `McpServer` from `@modelcontextprotocol/sdk` — connect with any SDK transport.

```ts
import { mcpServerFromAgent } from '@rudderjs/ai/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = await mcpServerFromAgent(ResearchAgent)
await server.connect(new StdioServerTransport())
```

Three exposure modes via `opts.expose`:

- `'tools'` *(default)* — one MCP tool per `agent.tools()` entry; the wrapping agent isn't called, individual tools execute directly
- `'agent'` — one MCP tool that runs the whole agent (`prompt(text) → response.text`); ship one agent, callable from any MCP-aware client
- `'both'` — individual tools and the agent prompt-tool side by side

Other options: `name`, `version`, `instructions` (defaults to `agent.instructions()`), `agentToolName` (renames the prompt-tool when `expose: 'agent' | 'both'`).

Approval gates (`needsApproval: true`) are dropped on the MCP side — there's no MCP-protocol way to forward "this tool needs human approval" to a remote client. The gate fires only inside the wrapping agent, not for external MCP callers.

## Chat mentions (`@slug` agent routing)

In a chat UI where one orchestrator routes to several agents, let users `@<slug>` an agent to invoke it explicitly, overriding the orchestrator's own judgment. `@rudderjs/ai/chat-mentions` ships the two reusable pieces:

```ts
import { parseMentions, buildMentionRoutingRule } from '@rudderjs/ai/chat-mentions'

const { slugs, cleaned } = parseMentions(userMessage, knownAgentSlugs)
// '@seo audit this' → { slugs: ['seo'], cleaned: 'audit this' }

const rule = buildMentionRoutingRule(slugs)   // null when no mentions
if (rule) systemPrompt += `\n\n${rule}`
// then run the orchestrator with `cleaned` as the user input
```

`parseMentions` validates tokens against your known slugs (unknown `@mentions` stay as plain text), dedupes in first-seen order, and strips the matched tokens so the model sees only the cleaned intent. It does not treat `email@host` as a mention. `buildMentionRoutingRule` renders a system-prompt rule forcing the orchestrator to dispatch the mentioned agents in order; pass `{ toolName, argKey }` if your dispatch tool is not the default `run_agent({ agentSlug })`.

## Queued prompts

Push the agent run onto the queue for background execution. Returns a builder so you can configure the queue, attach success/failure callbacks, and (optionally) stream progress to a broadcast channel as it runs.

Requires `@rudderjs/queue` (and `@rudderjs/broadcast` if you call `.broadcast()`).

```ts
// Fire-and-forget background run
await new SupportAgent()
  .queue('Help with refund request')
  .onQueue('ai')
  .send()

// With success/failure callbacks
await new ResearchAgent()
  .queue('Research GPT-5 architecture')
  .then(response => console.log('Done:', response.text))
  .catch(error  => console.error('Failed:', error))
  .send()
```

### Stream progress to a broadcast channel — `.broadcast(channel)`

Background AI work + live UI without polling. Each stream chunk is broadcast to the channel as the job runs; the final response is broadcast as a `done` event.

```ts
await new SupportAgent()
  .queue('Help with refund request')
  .broadcast(`user.${userId}.support`)
  .send()
```

Subscribers on `user.${userId}.support` receive:

- `{ event: 'chunk', data: <StreamChunk> }` — one per stream chunk (text-delta, tool-call, tool-result, ...)
- `{ event: 'done',  data: <AgentResponse> }` — final result, after the agent loop ends
- `{ event: 'error', data: { message } }` — on failure

The chunk shape matches the framework's normal `StreamChunk` types — the same `text-delta` / `tool-call` / `tool-result` shapes you'd iterate from `agent.stream()`. Frontends can subscribe to the channel and reuse their existing chunk-handling code.

Pass `eventPrefix` to namespace events when the channel carries other unrelated messages:

```ts
.broadcast('shared-channel', { eventPrefix: 'agent.' })
// emits 'agent.chunk', 'agent.done', 'agent.error'
```

**Process model.** `@rudderjs/broadcast`'s `broadcast()` writes to the WS server in the same process. In the typical Rudder dev setup (single process running both web + `queue:work`) this works out of the box. Production deployments that run the queue worker as a separate process from the broadcast WS server will need a pub/sub bridge (Redis, Reverb, etc.) — outside the scope of v1.

## Prompt caching

Mark stable parts of the prompt as cacheable. Provider adapters translate the markers to native cache primitives — Anthropic adds `cache_control: { type: 'ephemeral' }` to the last content block of each marked region, OpenAI uses `prompt_cache_key` for routing affinity, and Google translates to `cachedContent` resources via a pluggable registry. Cache hits typically save 50–90% on input tokens.

```ts
class SupportAgent extends Agent {
  instructions() { return LONG_SYSTEM_PROMPT }
  tools()        { return [...] }

  cacheable() {
    return { instructions: true, tools: true }
  }
}
```

`messages: N` caches the first N messages — useful for multi-turn conversations where early context is stable:

```ts
class ChatAgent extends Agent {
  cacheable() { return { messages: 4 } }   // cache up to message[3]
}
```

Per-call override:

```ts
await agent.prompt('one-off',  { cache: false })          // disable for this call
await agent.prompt('different', { cache: { tools: true } }) // replace agent default
```

Google's `cachedContent` resources are stateful and have a configurable TTL — set it via the `ttl` field (default `'1h'`, max ~24h depending on the model). Anthropic and OpenAI ignore `ttl` because their cache layers don't expose a per-call lifetime knob:

```ts
class SupportAgent extends Agent {
  cacheable() { return { instructions: true, tools: true, ttl: '6h' } }
}
```

When `@rudderjs/cache` is installed, the Google registry uses the registered adapter for cross-process / cross-restart persistence — install it for any multi-worker deployment to avoid creating duplicate cache resources. Without it, the registry uses an in-process `Map` and warns once on first use.

Adapters that don't support caching ignore the markers — the request still runs, uncached.

## Conversation persistence

Register a `ConversationStore`, then call `.forUser(userId)` to start a new conversation or `.continue(conversationId)` to resume one:

```ts
import { setConversationStore, MemoryConversationStore } from '@rudderjs/ai'

setConversationStore(new MemoryConversationStore())   // dev / tests

const first  = await new AssistantAgent().forUser('user-42').prompt('My name is Alice.')
const second = await new AssistantAgent().continue(first.conversationId!).prompt("What's my name?")
// second.text → 'Your name is Alice.'
```

`MemoryConversationStore` is fine for tests, but it is in-process and loses every thread on restart. For production use the first-party ORM-backed store, which persists threads through the registered `@rudderjs/orm` adapter (native, Prisma, or Drizzle) so they survive restarts and are shared across web processes and queue workers:

```ts
import { setConversationStore } from '@rudderjs/ai'
import { OrmConversationStore } from '@rudderjs/ai/conversation-orm'

setConversationStore(new OrmConversationStore())
```

It stores two tables (`AiConversation` + `AiConversationMessage`). Copy the schema from the exported `conversationOrmPrismaSchema` into your Prisma schema, add an equivalent native migration, or define + register the matching Drizzle tables. (Need a different backend, like Redis or an external service? Implement the `ConversationStore` interface directly; it is five methods.)

### Auto-persist (`conversational()`)

For chat-style agents, threading `forUser()` through every call site is a footgun — forget it once and the conversation silently doesn't persist. Override `conversational()` on the agent class to auto-load + auto-save without each caller passing the user id:

```ts
class ChatAgent extends Agent {
  conversational() {
    return { user: Auth.user()?.id }   // null user → falsy → opt-out
  }
}

await new ChatAgent().prompt('Hi')          // auto-loads thread, runs, auto-saves
await new ChatAgent().prompt('Still you?')  // resumes the same thread
```

Each `(user, agent class)` pair gets its own thread, so a user can talk to a `ChatAgent` and a `SupportAgent` without their histories merging. Override the segregation key with `agent: 'custom'` if you ever rename the class.

Async hook returns are awaited — useful when the user identity comes from an async DI binding:

```ts
conversational() { return Promise.resolve({ user: await loadUserId() }) }
```

For long-running threads, cap loaded history to the last N messages:

```ts
conversational() { return { user: ctx.user.id, historyLimit: 50 } }
```

Per-call override and explicit-form precedence (high → low):

1. `agent.forUser(id).prompt()` / `agent.continue(id).prompt()` — explicit always wins.
2. `agent.prompt(input, { conversation: false | { user, id?, historyLimit? } })` — per-call.
3. `agent.conversational()` — class declaration.

`MemoryConversationStore` works out of the box; Prisma / Redis stores plug in by implementing `ConversationStore`. Stores that surface the `agent` meta in `list()` results get the per-class thread separation; stores that ignore it fall back to "always create a new thread", which is the conservative behavior.

### Validating continuations (`validate`)

A continuation after a client-tool or approval round-trip carries the prior messages back from the browser, so the server is trusting client-supplied history. Without a guard a caller can rewrite that history (continue another user's thread, an IDOR), forge a `tool` result for a tool the server never ran, or claim an approval that was never pending.

Pass a `validate` hook through the prompt options. It runs against the server-persisted history just before the agent loop, and throwing rejects the request. `defaultContinuationValidator()` is the built-in gate (prefix equality + tool-result-forgery + approval-forgery):

```ts
import { defaultContinuationValidator } from '@rudderjs/ai'

await agent
  .continue(conversationId)
  .prompt(input, {
    messages,                                  // client-supplied continuation
    validate: defaultContinuationValidator(),  // throws ContinuationValidationError on forgery
  })
```

The same hook fires on the auto-persist path (`conversational()`) and on the streaming variant. For custom policy, the lower-level `validateContinuation(persisted, incoming, opts?)` returns a `{ ok, code, reason, index }` verdict you can branch on instead of throwing. Stateless calls (no persistence) never invoke it.

## User memory

Conversation persistence remembers messages. **User memory** persists *facts* — things about a user that should travel across conversations, separate from any single thread. Useful when the agent needs to remember "Alice's project is named Foo" in a brand-new session without replaying the prior history.

Three backends ship today, all behind the same `UserMemory` interface:

| Backend | Subpath | When to use |
|---|---|---|
| `MemoryUserMemory` | `@rudderjs/ai` (main) | Tests, dev, ephemeral state |
| `OrmUserMemory` | `@rudderjs/ai/memory-orm` | Production with `@rudderjs/orm` registered (Prisma/Drizzle) |
| `EmbeddingUserMemory` | `@rudderjs/ai/memory-embedding` | Production + semantic recall via cosine similarity |

Wire one in `config/ai.ts`:

```ts
// config/ai.ts
import type { AiConfig } from '@rudderjs/ai'
import { OrmUserMemory } from '@rudderjs/ai/memory-orm'
import { EmbeddingUserMemory } from '@rudderjs/ai/memory-embedding'

export default {
  default: 'anthropic/claude-sonnet-4-6',
  providers: { /* ... */ },
  memory: new EmbeddingUserMemory({
    inner: new OrmUserMemory(),
    model: 'openai/text-embedding-3-small',
    threshold: 0.5,
  }),
} satisfies AiConfig
```

`AiProvider` binds the configured store to the `ai.memory` DI key and a process-wide `setUserMemory()` registry that the auto-inject and auto-extract middleware look up.

### The `UserMemory` interface

```ts
interface UserMemory {
  remember(userId: string, fact: string,  opts?: { tags?: string[]; score?: number }): Promise<MemoryEntry>
  recall  (userId: string, query: string, opts?: { limit?: number;  tags?: string[] }): Promise<MemoryEntry[]>
  forget  (userId: string, factId: string                                            ): Promise<void>
  list    (userId: string,                opts?: { tags?: string[]; limit?: number  }): Promise<MemoryEntry[]>
  forgetAll?(userId: string): Promise<void>           // optional GDPR cascade
}
```

Manual API — drop-in for any agent flow:

```ts
const mem = app().make<UserMemory>('ai.memory')
await mem.remember('user_123', 'Project name is Foo', { tags: ['project'] })
const facts = await mem.recall('user_123', 'project')
//=> [{ fact: 'Project name is Foo', tags: ['project'], score: 0.95, ... }]
```

### Auto-inject + auto-extract via `Agent.remembers()`

For the common case — chat agent that should both pull relevant facts into its system prompt AND distill new facts from each turn — declare `remembers()` on the class. The framework installs the right middleware automatically:

```ts
class SupportAgent extends Agent {
  remembers() {
    return {
      user:               ctx.user.id,
      inject:             'auto',                       // recall + prepend per turn
      extract:            'auto',                       // distill new facts per turn
      extractWith:        'anthropic/claude-haiku-4-5', // small model for distillation
      tags:               ['support'],                  // recall + extract scope
      injectLimit:        5,                            // cap injected facts
      injectTokenBudget:  400,                          // hard token cap; lowest-score drops first
    }
  }
}
```

**Auto-inject** prepends matching facts as a fenced `<user-memory>` block to the system message:

```text
You are a support agent.

<user-memory>
- Project Foo deploys to fly.io us-east
- prefers TypeScript strict mode
</user-memory>
```

The block is built by querying `mem.recall(spec.user, latestUserText, { limit, tags })` once per turn (the `onStart` middleware), then trimming by `injectTokenBudget` if set. Token budget drops the lowest-score facts first.

**Auto-extract** runs after each successful turn — the `onFinish` middleware pulls the latest `[user, assistant]` pair from `ctx.messages`, calls a small model (`extractWith`) with a JSON-mode prompt asking for `{ facts: [{ fact, score, tags? }] }`, filters by confidence threshold (default 0.7), and writes the survivors via `mem.remember()`.

Per-call escape hatches and precedence (high → low):

1. `agent.prompt(input, { memory: false })` — disable for this call.
2. `agent.prompt(input, { memory: { user, inject?, extract?, ... } })` — override the spec for this call.
3. `agent.remembers()` — class declaration.

Failures inside auto-extract (network, JSON parse, schema mismatch, store write) are routed through `MemoryExtractOptions.onError` and otherwise swallowed — the parent prompt never breaks because of memory work.

**Continuation calls** (when `options.messages` is set, e.g. resuming after a client-tool round-trip) skip both inject and extract so the system prompt isn't double-augmented and facts aren't double-written.

### Cosine-recall mode (`EmbeddingUserMemory`)

`EmbeddingUserMemory` composes any `UserMemory` (typically `OrmUserMemory`) with the registered embedding provider:

- `remember()` embeds the fact via `AI.embed(spec.model)` and writes the Float32-packed vector into the row's `embedding` column (added to the schema in Phase 4 as nullable).
- `recall()` embeds the query and ranks all of the user's facts by cosine similarity.

For semantically-similar but lexically-distinct queries — "Where do I deploy?" matching "Project Foo lives at fly.io" — this is the right backend.

**v1 is pure-JS cosine over the user's full set** (acceptable up to a few thousand facts/user). Larger workloads will land a pgvector-backed variant under B7.

**GDPR right-to-be-forgotten cascades automatically** — the embedding lives in the same row as the fact, so `forget()` / `forgetAll()` delete both. No second store to keep in sync.

**Backward compat:** rows whose `embedding` is null fall back to token-overlap on `fact` (`nullEmbeddingFallback: 'token-overlap'` is the default). Upgrading from `OrmUserMemory` to `EmbeddingUserMemory` doesn't lose recall on existing rows; new `remember()` calls populate the column going forward. Override to `'skip'` if you want strict embedding-only semantics.

### Schema reference (`OrmUserMemory` / `EmbeddingUserMemory`)

Add to your Prisma schema (or import the reference string `userMemoryPrismaSchema` from `@rudderjs/ai/memory-orm`):

```prisma
model UserMemory {
  id        String   @id @default(cuid())
  userId    String
  fact      String
  /// JSON-encoded `string[]` of tags, or null
  tags      String?
  /// Confidence score in [0, 1] — extract sets this from the model's self-rating
  score     Float?
  /// Float32-packed vector (Phase 5); null when stored without the embedding composer
  embedding Bytes?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

Tags persist as a JSON-encoded `String?` column (rather than native `String[]`) so the same schema works on both Postgres and SQLite. Tag-array filtering happens JS-side after fetch; pushing tag arrays into the WHERE is adapter-specific and lands in a follow-up.

### Pitfalls

- **Memory poisoning.** Auto-extract trusts the user's own conversation as input — a malicious user can plant adversarial "facts." The default 0.7 confidence threshold is the v1 defense; tighten for high-risk domains. Pair with `MemoryExtractOptions.onExtracted(entries)` for an audit log when shipping to production.
- **Embedding model drift.** `EmbeddingUserMemory` writes vectors using `spec.model`; changing models without re-embedding leaves the existing rows ranked under the old vector space. Either re-embed all rows in a maintenance window or use `nullEmbeddingFallback: 'skip'` and migrate gradually.
- **GDPR cascade only covers the in-row embedding.** If you wire your own external vector store (Pinecone, Weaviate), `forget()` only deletes the SQL row — you must implement the cascade to your second store yourself. The bundled `EmbeddingUserMemory` is trivially compliant because the vector is in the same row.

## Middleware

Middleware is an `AiMiddleware` interface — implement only the lifecycle hooks you care about. Hooks: `onConfig`, `onStart`, `onIteration`, `onChunk`, `onBeforeToolCall`, `onAfterToolCall`, `onToolPhaseComplete`, `onUsage`, `onFinish`, `onAbort`, `onError`.

```ts
import type { AiMiddleware } from '@rudderjs/ai'

const logging: AiMiddleware = {
  name: 'logging',
  onStart(ctx)        { console.log(`[AI] ${ctx.model} started`) },
  onUsage(_ctx, u)    { console.log(`[AI] ${u.totalTokens} tokens`) },
  onBeforeToolCall(_ctx, name) {
    if (name === 'dangerous_tool') return { type: 'skip', result: 'Tool disabled' }
    return undefined
  },
  onChunk(_ctx, chunk) { return chunk },               // transform, or return null to drop
}

await agent({ instructions: 'You are helpful.', middleware: [logging] }).prompt('Hello')
```

`onBeforeToolCall` can return `{ type: 'skip', result }` to short-circuit a tool, `{ type: 'transformArgs', args }` to rewrite arguments, or `{ type: 'abort', reason }` to stop the loop.

## Observability

Subscribe to agent events via the observer registry — this is how `@rudderjs/telescope`'s AiCollector records runs into the dashboard:

```ts
import { aiObservers } from '@rudderjs/ai/observers'

const unsubscribe = aiObservers.subscribe(event => {
  if (event.kind === 'agent.step.completed') {
    console.log(`step ${event.iteration}: ${event.tokens.total} cumulative tokens`)
  }
  if (event.kind === 'agent.completed') {
    console.log(`done in ${event.duration}ms, ${event.steps.length} steps`)
  }
})
```

Event kinds:

- **`agent.step.completed`** — fires after each loop iteration with that step's tools called, finish reason, and cumulative usage. Useful for streaming progress to UIs without waiting for the full run.
- **`agent.completed`** — fires once after a successful run with the full step history and final usage.
- **`agent.failed`** — fires once with `error` set when the run throws or aborts.

Each step's `toolCalls[]` carries a `duration` field (wall-clock ms in `.server()`) so you can attribute latency to specific tools.

## Testing

`AiFake.fake()` swaps the registered provider with a programmable mock — no API key, no network. The fake also restores the real provider on `.restore()` so tests don't leak between cases.

```ts
import { AiFake } from '@rudderjs/ai'

const fake = AiFake.fake()
fake.respondWith('Mocked response')

await new MyAgent().prompt('Hello')
fake.restore()
```

For multi-step loops (the model returns tool calls, then text, then more tool calls), script each step:

```ts
fake.respondWithSequence([
  { toolCalls: [{ id: 't1', name: 'lookup', arguments: { id: 42 } }] },
  { text: 'The answer is 42.' },
])
```

`failOnStep(stepIndex, error)` throws on a specific iteration to exercise failover and error paths:

```ts
fake.respondWithSequence([
  { toolCalls: [{ id: 't1', name: 'lookup', arguments: {} }] },
  { text: 'recovered' },
])
fake.failOnStep(0, new Error('Rate limited'))   // first call throws; second succeeds
```

### Evals against real models

`AiFake` proves your agent's wiring works; **evals** prove it does the right thing on real models. Define a suite of input cases + assertions and run with `pnpm rudder ai:eval`:

```ts
// evals/support-agent.eval.ts
import { evalSuite, llmJudge, exactMatch, regex } from '@rudderjs/ai/eval'
import { SupportAgent } from '../app/Agents/SupportAgent.js'

export default evalSuite('SupportAgent', {
  agent: () => new SupportAgent(),
  cases: [
    { name: 'password reset', input: 'How do I reset my password?',
      assert: llmJudge('mentions a password reset link or email') },
    { name: 'price', input: 'How much?',
      assert: exactMatch('$99/month') },
    { name: 'support email', input: 'Contact?',
      assert: regex(/support@example\.com/) },
  ],
})
```

```bash
pnpm rudder ai:eval                    # all suites under evals/**/*.eval.ts
pnpm rudder ai:eval support            # name filter (case-insensitive substring)
pnpm rudder ai:eval --bail             # stop on first failing suite
pnpm rudder ai:eval --json             # CI-friendly envelope to stdout
pnpm rudder ai:eval --record support   # run live, save fixtures
pnpm rudder ai:eval --replay support   # zero API calls, deterministic
pnpm rudder ai:eval --html report.html # self-contained HTML report
```

Exits 0 when every case passes, 1 on any failure. `--json` emits `{ suites: [{ suite, passed, failed, cases: [{ name, status, pass, score?, reason?, tokens, cost, duration }] }] }` for CI gates. Override the discovery pattern via `config('ai').eval.pattern` (default `'evals/**/*.eval.ts'`).

Built-in metrics:

- `exactMatch(string)` / `regex(RegExp)` — surface checks on `response.text`.
- `llmJudge(criterion, opts?)` — small-model judge for fuzzy "did the answer mention X?" assertions.
- `jsonShape(zodSchema)` — strict structural assertion. Strips ` ``` ` fences and runs zod `safeParse`; failure surfaces the issue path.
- `semanticMatch(reference, opts?)` — embeds reference + response, cosine vs `opts.threshold` (default `0.85`). Requires a provider with `createEmbedding()`.
- `tokenCost(threshold)` — passes when `response.usage.totalTokens <= threshold`; detects prompt-size regressions.
- `compose(...metrics)` — runs metrics in order with first-failure short-circuit. `compose(jsonShape(Schema), tokenCost(800))` enforces "valid JSON AND under budget."

User metrics implement `(response, ctx) => MetricResult`. See `@rudderjs/ai/eval` for full surface — `evalSuite()`, `runSuite()`, `reportConsole()`, `reportJson()`, `stepsFromResponse()`.

**Record + replay:** `--record` runs each case against the real provider and writes assistant turns (text + tool calls) to `evals/__fixtures__/<suite>/<case>.json`. Commit those alongside the suite so model-output diffs show up in code review. `--replay` swaps the runtime with `AiFake` and feeds each case its recorded fixture — same agent code path, deterministic responses, zero API cost. Cases without a fixture fall through to a normal run with a stderr warning.

Telescope subscribes to the `agent.eval.completed` observer event (emitted by `runSuite` after every case, including skipped ones) and aggregates pass-rate per `(suite, case)` over time.

**HTML report:** `--html <path>` writes a self-contained HTML document — inline CSS + minimal vanilla JS for case-row expand, no external assets — pasteable into PR comments, openable offline. Coexists with `--json` (JSON to stdout, HTML to disk). Annotate suites with optional metadata (`{ owner?, lastReviewed?, ticket? }` plus any custom keys) to surface ownership in the report header.

## Pitfalls

- **Bare model names.** `model: 'claude-sonnet-4-6'` throws — must be `provider/model`.
- **Tool handlers throwing.** The agent gets the error message back as the tool result. Catch known errors inside the handler and return a structured failure shape.
- **Streaming `response` not resolving.** `await response` only resolves after the `stream` iterator has been fully consumed. Always iterate the stream first, even if you only care about the final result.
- **`forUser()` / `continue()` throw.** Conversation methods need a registered store — call `setConversationStore(...)` (or wire one through `AiConfig.conversations`) before they're called.
- **Provider SDK missing.** Provider adapters lazy-load their SDK on first call. If you see a missing-module error from `@anthropic-ai/sdk` / `openai` / `@google/genai`, install only the one(s) you actually use.
