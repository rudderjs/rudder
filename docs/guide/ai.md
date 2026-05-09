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
  default: 'anthropic/claude-sonnet-4-5',
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
const url = Image.fromUrl('https://example.com/photo.jpg')
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
  model: 'anthropic/claude-sonnet-4-5',
  tools: [searchTool],
}).prompt('Find all admins')

// Reusable typed class
class SearchAgent extends Agent {
  instructions() { return 'You help find users.' }
  model()        { return 'anthropic/claude-sonnet-4-5' }
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

Other stop conditions: `until(predicate)`, `tokenLimit(n)`, `noTokensUsed(n)`.

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

`MemoryConversationStore` is fine for tests. For production, implement `ConversationStore` against your database — Prisma and Redis adapters are the typical choices.

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

## Pitfalls

- **Bare model names.** `model: 'claude-sonnet-4-5'` throws — must be `provider/model`.
- **Tool handlers throwing.** The agent gets the error message back as the tool result. Catch known errors inside the handler and return a structured failure shape.
- **Streaming `response` not resolving.** `await response` only resolves after the `stream` iterator has been fully consumed. Always iterate the stream first, even if you only care about the final result.
- **`forUser()` / `continue()` throw.** Conversation methods need a registered store — call `setConversationStore(...)` (or wire one through `AiConfig.conversations`) before they're called.
- **Provider SDK missing.** Provider adapters lazy-load their SDK on first call. If you see a missing-module error from `@anthropic-ai/sdk` / `openai` / `@google/genai`, install only the one(s) you actually use.
