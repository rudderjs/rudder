# @rudderjs/ai

AI engine for RudderJS — providers, agents, tools, streaming, middleware, structured output, conversation memory, and testing fakes.

## Installation

```bash
pnpm add @rudderjs/ai
```

Install the provider SDK(s) you need:

```bash
pnpm add @anthropic-ai/sdk             # Anthropic (Claude)
pnpm add openai                         # OpenAI (GPT) — also used for OpenRouter / Mistral / DeepSeek / Groq / xAI / Ollama
pnpm add @google/genai                  # Google (Gemini)
pnpm add cohere-ai                      # Cohere (reranking + embeddings)
pnpm add @aws-sdk/client-bedrock-runtime # AWS Bedrock
# Jina — no extra package needed
```

## Runtime Compatibility

`@rudderjs/ai` is runtime-agnostic via subpath exports:

| Entry | Runtimes | Use for |
|---|---|---|
| `@rudderjs/ai` | Node, browser, Electron main+renderer, React Native | Agents, tools, streaming, providers — any `fetch`-capable JS runtime |
| `@rudderjs/ai/node` | Node only | `documentFromPath()`, `imageFromPath()`, `transcribeFromPath()` (filesystem helpers) |
| `@rudderjs/ai/server` | Node only | `AiProvider` (the RudderJS `ServiceProvider` — auto-discovered, you rarely import it) |

The main entry has zero `node:*` static imports, so you can call agents and tools directly from a React Native screen, an Electron renderer, or a browser. `@rudderjs/core` is an optional peer — only `/server` consumers pull it in.

**Security:** Calling LLM providers directly from a client leaks your API key. Use a server-side proxy in production. The main client-side use case is BYOK desktop apps (Electron) where the user supplies their own key.

## Setup

```ts
// config/ai.ts
export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: {
    anthropic: { driver: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
    openai:    { driver: 'openai',    apiKey: process.env.OPENAI_API_KEY! },
    google:    { driver: 'google',    apiKey: process.env.GOOGLE_API_KEY! },
    ollama:    { driver: 'ollama',    baseUrl: 'http://localhost:11434' },
    cohere:    { driver: 'cohere',    apiKey: process.env.COHERE_API_KEY! },
    jina:      { driver: 'jina',      apiKey: process.env.JINA_API_KEY! },
    openrouter: {
      driver:   'openrouter',
      apiKey:   process.env.OPENROUTER_API_KEY!,
      siteUrl:  process.env.APP_URL,    // optional — sent as HTTP-Referer
      siteName: 'My App',                // optional — sent as X-Title
    },
    bedrock: {
      driver: 'bedrock',
      region: process.env.AWS_REGION ?? 'us-east-1',
      // credentials are read from the AWS chain (env, IAM, ~/.aws/credentials)
    },
  },
}

// bootstrap/providers.ts
import { AiProvider } from '@rudderjs/ai/server'
export default [AiProvider]
```

## Usage

### Agent Class

```ts
import { Agent, toolDefinition, stepCountIs } from '@rudderjs/ai'
import type { HasTools } from '@rudderjs/ai'
import { z } from 'zod'

const searchTool = toolDefinition({
  name: 'search_users',
  description: 'Search users by name',
  inputSchema: z.object({ query: z.string() }),
}).server(async ({ query }) => {
  return db.users.findMany({ where: { name: { contains: query } } })
})

class SearchAgent extends Agent implements HasTools {
  instructions() { return 'You help find users in the system.' }
  model() { return 'anthropic/claude-sonnet-4-5' }
  tools() { return [searchTool] }
  stopWhen() { return stepCountIs(5) }
}

const response = await new SearchAgent().prompt('Find all admins')
console.log(response.text)
```

### Anonymous Agent

```ts
import { agent, AI } from '@rudderjs/ai'

const response = await agent('You summarize text.').prompt('Summarize this...')

// Or via facade
const response = await AI.prompt('Hello world')
```

### Tools (Server + Client)

A `Tool` is just `{ definition, execute? }`. The presence or absence of
`execute` is the only discriminator: with it, the tool runs server-side;
without it, it's a client tool that the browser executes via
`@rudderjs/panels`'s `clientTools` registry.

```ts
import { toolDefinition, dynamicTool } from '@rudderjs/ai'
import { z } from 'zod'

// Server tool — executes on backend
const weatherTool = toolDefinition({
  name: 'get_weather',
  description: 'Get weather for a location',
  inputSchema: z.object({ location: z.string() }),
  needsApproval: true,  // pauses the agent loop until the user approves
  lazy: true,           // not sent to LLM upfront
}).server(async ({ location }) => ({ temp: 72, unit: 'F' }))

// Client tool — no `.server()`, so the browser executes it
const readFormState = toolDefinition({
  name: 'read_form_state',
  description: 'Read the user\'s current local form values',
  inputSchema: z.object({ fields: z.array(z.string()).optional() }),
})

// Dynamic tool — schemas built at runtime from user data
const customTool = dynamicTool({
  name: 'custom_op',
  description: 'Built at runtime',
  inputSchema: z.object({ q: z.string() }),
}).server(async (input) => JSON.stringify(input))
```

### Client tool round-trip and approval gates

When the model calls a client tool (no `execute`) or a tool with
`needsApproval: true`, the agent loop **stops** instead of failing — and
exposes the pending state on `AgentResponse`:

```ts
const result = await agent({ tools: [readFormState, weatherTool] })
  .prompt('what is in the form?', {
    toolCallStreamingMode: 'stop-on-client-tool',
  })

if (result.finishReason === 'client_tool_calls') {
  // result.pendingClientToolCalls — execute these in the browser, then
  // re-POST with `messages: [...history, assistantMsg, ...toolResultMsgs]`
}
if (result.finishReason === 'tool_approval_required') {
  // result.pendingApprovalToolCall — show approval UI, then re-POST with
  // `approvedToolCallIds: [id]` or `rejectedToolCallIds: [id]`
}
```

The **continuation** uses `options.messages` instead of `history` + `input`:

```ts
await agent({ tools: [...] }).prompt('', {
  messages: [...priorConversation, assistantWithToolCalls, toolResult],
  approvedToolCallIds: ['tc_id'],   // or rejectedToolCallIds
})
```

When continuing after an approval round-trip, the loop transparently
**resumes the pending tool call server-side** before re-entering the model
loop — the resulting `tool` messages are exposed via
`result.resumedToolMessages` so callers can persist them. This guarantees
the conversation store never holds an unfulfilled `tool_use` block.

`@rudderjs/panels` does all the wiring (validating message prefixes against
the persisted store, executing client tools via the `clientTools` registry,
showing the inline approval card) — see its README for the end-to-end flow.

### Tailoring what the model sees with `.modelOutput()`

A server tool returns its full structured result to the **UI** (via telemetry, stream chunks, observers). By default the model sees that same JSON on its next step — but big JSON eats context for no reason when the model only needs a summary. Use `.modelOutput(fn)` to map result → model-facing string while leaving the UI's view untouched:

```ts
const searchTool = toolDefinition({
  name: 'search_docs',
  description: 'Full-text search across the docs',
  inputSchema: z.object({ query: z.string() }),
})
  .server(async ({ query }) => ({
    results: await docs.search(query),   // [{ title, url, snippet }, ...]
    total:   await docs.count(query),
  }))
  .modelOutput((r) => `Found ${r.total} results. Top: ${r.results.slice(0, 3).map(x => x.title).join(', ')}`)
```

The UI still receives `{ results, total }` in the tool-result chunk — useful for rendering a rich results card — but the model only sees the summary string on its next step. Smaller context, same UX.

### Subagents — `agent.asTool()`

Wrap one agent as a tool another agent can call. The parent delegates work; the subagent runs its own loop end-to-end (its own model, tools, middleware) and returns a single result.

```ts
class Researcher extends Agent implements HasTools {
  instructions() { return 'You research topics and return concise summaries.' }
  model() { return 'anthropic/claude-sonnet-4-6' }
  tools() { return [searchTool, readUrlTool] }
}

class Planner extends Agent implements HasTools {
  instructions() { return 'You break work into steps. Use `research` for facts.' }
  model() { return 'anthropic/claude-opus-4-7' }
  tools() {
    return [
      new Researcher().asTool({
        name:        'research',
        description: 'Research a topic in depth and return a summary.',
      }),
    ]
  }
}

await new Planner().prompt('Plan a launch for our new ORM feature.')
```

Defaults are tuned for the zero-config case:

- `inputSchema` defaults to `{ prompt: string }` and the subagent runs with `input.prompt`.
- The parent model only sees `response.text` on its next step (override with `modelOutput`); the UI still receives the full `AgentResponse` via the `tool-result` chunk.

For a typed input schema, pass an explicit `inputSchema` and a `prompt` mapper:

```ts
new Researcher().asTool({
  name:        'research',
  description: 'Research a topic in depth.',
  inputSchema: z.object({ topic: z.string(), depth: z.enum(['quick', 'deep']) }),
  prompt:      ({ topic, depth }) => `Research ${topic} at ${depth} depth.`,
  modelOutput: (r) => `${r.steps.length} step(s); ${r.text.slice(0, 280)}…`,
})
```

The wrapped subagent runs via `prompt()` (non-streaming) by default — to surface inner-agent progress as `tool-update` chunks in the parent stream, pass `streaming: true` (or a custom `(chunk) => SubAgentUpdate | null` projector). Pass `suspendable: { runStore }` to opt into the propagation protocol when the sub-agent pauses on a **client tool call** (`finishReason: 'client_tool_calls'`) or an **approval gate** (`finishReason: 'tool_approval_required'`) — the parent loop halts, the snapshot persists in the run store with a `pauseKind: 'client_tool' | 'approval'` discriminator, and the host resumes via `Agent.resumeAsTool(subRunId, results, { runStore, agent, approvedToolCallIds? })`. See `docs/guide/ai.md` for the full flow. `InMemorySubAgentRunStore` works for tests; `CachedSubAgentRunStore` plugs into `@rudderjs/cache` for cross-process persistence. Suspend without streaming throws at builder time.

### Handoffs — `handoff()`

Sometimes a parent agent shouldn't *call* a specialist and incorporate its result — it should *step out* and let the specialist own the rest of the conversation. That's a handoff.

```ts
import { Agent, handoff } from '@rudderjs/ai'

class SalesAgent extends Agent {
  instructions() { return 'You handle pricing, plans, and upgrades.' }
}
class SupportAgent extends Agent {
  instructions() { return 'You triage bugs and walk users through fixes.' }
}

class TriageAgent extends Agent {
  instructions() { return 'Greet the user, then route them to the right specialist.' }
  tools() {
    return [
      handoff(SalesAgent,   { when: 'pricing or sales questions' }),
      handoff(SupportAgent, { when: 'bug reports or technical issues' }),
    ]
  }
}

const r = await new TriageAgent().prompt('What does the Pro plan cost?')
console.log(r.text)         // "The Pro plan is $49/month..."  (from SalesAgent)
console.log(r.handoffPath)  // ['TriageAgent', 'SalesAgent']
```

How it differs from `asTool`:

|  | `asTool` (call-and-return) | `handoff` (control transfer) |
|---|---|---|
| Parent loop | continues after subagent finishes | ends |
| Conversation owner | parent | child |
| Final `text` | parent's | last child in the chain |
| `r.steps` | parent steps + a single tool-result step for the subagent | parent steps + each agent's steps merged in order |
| Use case | "look something up and use it" | "transfer to the right specialist" |

Default: the model writes a transition message (`{ message: string }`) that becomes the child's first user message. The full prior conversation flows through to the child — but the child uses its own `instructions()` as the system message. Multi-hop is supported (Triage → Sales → Billing); cycles are bounded by `MAX_HANDOFFS = 5` and surface a clear error.

```ts
// Custom name + payload
handoff(SalesAgent, {
  name:        'pivotToSales',
  description: 'Transfer the user to a sales specialist.',
  inputSchema: z.object({ urgency: z.enum(['low', 'high']), context: z.string() }),
})
```

In `agent.stream()`, a `'handoff'` `StreamChunk` is emitted right before control transfers, with `{ from, to, message? }` for UIs to render a transition indicator before the next agent's chunks arrive.

### Tool execution context

Server-tool executes can optionally accept a second `ctx: ToolCallContext`
argument carrying loop-level metadata — currently `{ toolCallId }`. The
parameter is optional, so existing one-arg tools keep working unchanged.

```ts
import { toolDefinition, type ToolCallContext } from '@rudderjs/ai'

const myTool = toolDefinition({
  name: 'my_tool',
  description: '...',
  inputSchema: z.object({ q: z.string() }),
}).server(async (input, ctx?: ToolCallContext) => {
  console.log('this call id:', ctx?.toolCallId)
  return { ok: true }
})
```

The primary consumer is `@pilotiq-pro/ai`'s `runAgentTool`, which uses
`ctx.toolCallId` to correlate sub-agent suspensions with the parent's
`run_agent` call (see "Pausing the loop from a server tool" below).

### Pausing the loop from a server tool

A server tool's async-generator execute can `yield` a `pauseForClientTools`
control chunk to halt the enclosing agent loop and surface a set of
**client** tool calls to the caller — as if the model itself had emitted
them. The yielding tool's own call stays orphaned in the message history
until the caller resolves it on continuation.

```ts
import { toolDefinition, pauseForClientTools } from '@rudderjs/ai'

const runNestedTool = toolDefinition({
  name: 'run_nested',
  description: 'Runs a nested workflow that may need browser interaction',
  inputSchema: z.object({ task: z.string() }),
}).server(async function* (input, ctx) {
  // ...do some server-side work, maybe yield progress chunks...

  if (needsBrowserAction) {
    // Persist whatever state you need to resume later, keyed by an
    // opaque `resumeHandle` your continuation logic understands.
    const handle = await persistMyResumeState({
      parentToolCallId: ctx?.toolCallId,
      task: input.task,
      // ...
    })

    // Yielding the control chunk halts iteration. The agent loop
    // appends the toolCalls to its own pendingClientToolCalls,
    // sets stop-for-client-tools, and emits 'pending-client-tools'
    // upward. The browser executes the calls and POSTs back, your
    // continuation handler picks up `handle` and resumes.
    yield pauseForClientTools(
      [{ id: 'call_xyz', name: 'update_form_state', arguments: { ... } }],
      handle,
    )
    // Unreachable — the loop halts iteration after the pause chunk.
    return null as never
  }

  return { result: 'done' }
})
```

**Why a yield instead of a throw:**

- Symmetry with the existing `tool-update` yield protocol (no parallel
  catch-based control path)
- Middleware can observe pauses through `runOnChunk`; throws would route
  through `onError` and muddle telemetry
- Exceptions signal "something went wrong"; this is not an error
- Any server tool can yield this — not just nested agent runners. E.g., a
  tool that wants the browser's geolocation, clipboard, or a user file
  upload.

**Recognizing the chunk:** the loop uses `isPauseForClientToolsChunk(value)`
internally. Tool authors should construct chunks via the
`pauseForClientTools()` factory rather than by hand so future shape
changes stay source-compatible.

**Approval pauses:** the sibling `pauseForApproval(toolCall, isClientTool, resumeHandle?)`
chunk halts the parent loop when a sub-agent's inner approval gate fires
(inner `finishReason === 'tool_approval_required'`). The parent's loop
sets `loopFinishReason = 'tool_approval_required'` and surfaces the
gated call on `pendingApprovalToolCall`. The wrapping `asTool({ suspendable })`
generator persists a snapshot with `pauseKind: 'approval'` and yields
this chunk automatically — hand-rolled tools that wrap their own
approval-gated sub-agents can yield it directly. Resume with
`Agent.resumeAsTool(subRunId, [], { runStore, agent, approvedToolCallIds: [...] })`
(or `rejectedToolCallIds`).

**Resuming:** that's caller territory — `@rudderjs/ai` knows nothing about
the resume protocol. The canonical implementation is in
`@rudderjs/panels`'s `subAgentResume.ts`, which uses a runStore to persist
sub-agent state and re-invokes the tool's enclosing agent on the
continuation request.

### Structured Output

```ts
import { agent, Output } from '@rudderjs/ai'
import { z } from 'zod'

const output = Output.object({
  schema: z.object({
    people: z.array(z.string()),
    companies: z.array(z.string()),
  }),
})

// Use with agent (append output instructions to system prompt)
```

### Prompt caching

Mark stable parts of the prompt as cacheable. Provider adapters translate the markers to native primitives — Anthropic adds `cache_control: { type: 'ephemeral' }` to the last content block of each marked region. Cache hits typically save 50–90% on input tokens for long system prompts and tool definitions.

```ts
class SupportAgent extends Agent {
  instructions() { return LONG_SYSTEM_PROMPT }     // 50k tokens of policy
  tools()        { return [...biggToolList] }      // 30k tokens of tool defs

  cacheable() {
    return { instructions: true, tools: true }
    //                                  ^ both eligible — Anthropic caches up to the last marked block
  }
}

await new SupportAgent().prompt('How do I reset my password?')
//   ↑ first call: cache miss; subsequent calls within 5 minutes: cache hit
```

Cache the first N messages of a multi-turn conversation:

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

Google's `cachedContent` is the only provider with a stateful cache resource — its TTL is configurable via the `ttl` field (default `'1h'`):

```ts
class SupportAgent extends Agent {
  cacheable() {
    return { instructions: true, tools: true, ttl: '6h' }
    //                                        ^ Google-only; Anthropic/OpenAI ignore it
  }
}
```

When `@rudderjs/cache` is installed and registered, the Google cache registry uses it for cross-process / cross-restart persistence so multi-worker deployments don't create duplicate cache resources. Without it, the registry falls back to in-memory storage and warns once on first use.

**Provider support:**

| Provider | Status |
|---|---|
| Anthropic | ✓ — `cache_control` on system, tools, and Nth message |
| OpenAI    | ✓ — `prompt_cache_key` for routing affinity (caching is automatic above 1024 tokens) |
| Google    | ✓ — `cachedContent` resource translation, with TTL refresh and 404 recovery |

Other adapters ignore the markers — the request runs uncached.

### Failover

Try multiple providers in order — if the primary fails, fall through to the next:

```ts
class ResilientAgent extends Agent {
  instructions() { return 'You are helpful.' }
  model() { return 'anthropic/claude-sonnet-4-5' }
  failover() { return ['openai/gpt-4o', 'google/gemini-2.5-pro'] }
}

// If Anthropic is down, tries OpenAI, then Google
const response = await new ResilientAgent().prompt('Hello')
```

Works with both `prompt()` and `stream()`.

The same pattern is available on the media generators (Image, Audio, Transcription) — pass extra provider/model strings to `.failover(...)`:

```ts
await ImageGenerator.of('A donut')
  .model('openai/dall-e-3')
  .failover('google/imagen-3', 'azure/dall-e-3')
  .generate()

await AudioGenerator.of('Hello').model('openai/tts-1-hd').failover('elevenlabs/eleven_multilingual_v2').generate()
await Transcription.fromBytes(bytes).model('openai/whisper-1').failover('google/gemini-2.0-flash-exp').generate()
```

Tried in order. If the primary fails (provider error, capability missing, etc.), the next candidate runs. Only the last error surfaces if every candidate fails.

### Image Generation

```ts
import { AI } from '@rudderjs/ai'

const result = await AI.image('A mountain at sunset')
  .model('openai/dall-e-3')
  .size('landscape')
  .quality('hd')
  .generate()

// result.images[0].base64 or result.images[0].url
await AI.image('Logo design').model('openai/dall-e-3').store('images/logo.png')
```

### Text-to-Speech

```ts
import { AI } from '@rudderjs/ai'

const result = await AI.audio('Hello world')
  .model('openai/tts-1')
  .voice('nova')
  .format('mp3')
  .generate()

// result.audio → Buffer
await AI.audio('Welcome').model('openai/tts-1').store('audio/welcome.mp3')
```

### Speech-to-Text

```ts
import { AI } from '@rudderjs/ai'

const bytes = new Uint8Array(/* recorded audio */)

const result = await AI.transcribe(bytes)
  .model('openai/whisper-1')
  .language('en')
  .generate()

// result.text → transcribed text
```

In Node, load the file with the `/node` helper:

```ts
import { transcribeFromPath } from '@rudderjs/ai/node'

const result = await (await transcribeFromPath('./meeting.mp3'))
  .model('openai/whisper-1')
  .language('en')
  .generate()
```

### Provider Tools (WebSearch, WebFetch)

Built-in tools that leverage provider capabilities:

```ts
import { AI, WebSearch, WebFetch } from '@rudderjs/ai'

const agent = AI.agent({
  instructions: 'Research assistant',
  tools: [
    WebSearch.make().domains(['docs.rudderjs.dev']).toTool(),
    WebFetch.make().maxLength(5000).toTool(),
  ],
})
```

### Reranking

Reorder documents by relevance to a query — useful for RAG pipelines:

```ts
import { AI } from '@rudderjs/ai'

// One-shot
const result = await AI.rerank('search query', documents, {
  model: 'cohere/rerank-v3.5',
  topK: 5,
})
// result.results → [{ index, relevanceScore, document }, ...]

// Fluent builder
const result = await AI.rerank('how to deploy', docs)
  .model('jina/jina-reranker-v2-base-multilingual')
  .topK(10)
  .rank()
```

Supported providers: **Cohere** (`cohere-ai` SDK) and **Jina** (direct HTTP, no SDK).

### File Management

Upload, list, and delete files on provider platforms — needed for large document context and assistant APIs:

```ts
import { AI } from '@rudderjs/ai'

const files = AI.files('openai')

// Upload
const uploaded = await files.upload('./report.pdf', { purpose: 'assistants' })
// uploaded → { id, filename, bytes, purpose }

// List
const { files: allFiles } = await files.list()

// Delete
await files.delete(uploaded.id)

// Retrieve content (OpenAI, Anthropic)
const content = await files.retrieve(uploaded.id)
// content → { data: Buffer, mimeType }
```

Supported providers: **OpenAI** (full CRUD + retrieve), **Anthropic** (full CRUD + retrieve), **Google** (upload, list, delete — no retrieve).

### Embeddings

```ts
import { AI } from '@rudderjs/ai'

// Single text
const result = await AI.embed('Hello world')

// Batch (auto-chunks arrays > 100 items)
const result = await AI.embed(['text one', 'text two'])

// With caching
const result = await AI.embed('text', { cache: true })

// Specific model
const result = await AI.embed('text', { model: 'openai/text-embedding-3-small' })
```

### Vercel AI Protocol

Stream to frontend frameworks (Next.js, Nuxt, SvelteKit):

```ts
import { toVercelResponse } from '@rudderjs/ai'

// In a route handler
const { stream } = agent('You are helpful.').stream(input)
return toVercelResponse(stream)
```

### Streaming

```ts
const { stream, response } = agent('You are helpful.').stream('Tell me a story')

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text!)
}

const final = await response // full AgentResponse when stream completes
```

### Queued prompts (`agent.queue()`)

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

#### Stream progress to a broadcast channel — `.broadcast(channel)`

Background AI work + live UI without polling. Each stream chunk is broadcast to the channel as the job runs; the final response is broadcast as a `done` event:

```ts
await new SupportAgent()
  .queue('Help with refund request')
  .broadcast(`user.${userId}.support`)
  .send()

// Subscribers on `user.${userId}.support` receive:
//   { event: 'chunk', data: <StreamChunk> }   // one per stream chunk (text-delta, tool-call, ...)
//   { event: 'done',  data: <AgentResponse> } // final result, after the loop ends
//   { event: 'error', data: { message } }     // on failure
```

The wire shape matches the framework's normal `StreamChunk` types — the same `text-delta` / `tool-call` / `tool-result` shapes you'd iterate from `agent.stream()`. Frontends can subscribe to the channel and reuse their existing chunk-handling code.

Pass `eventPrefix` to namespace events when the channel carries other unrelated messages:

```ts
.broadcast('shared-channel', { eventPrefix: 'agent.' })
// emits 'agent.chunk', 'agent.done', 'agent.error'
```

**Process model:** `@rudderjs/broadcast`'s `broadcast()` writes to the WS server in the same process. In the typical RudderJS dev setup (single process running both web + `queue:work`) this works out of the box. Production deployments that run the queue worker as a separate process from the broadcast WS server will need a pub/sub bridge (Redis, Reverb, etc.) — outside the scope of v1.

### Conversation History

Pass message history to maintain context across turns:

```ts
const response = await agent('You are helpful.').prompt('Follow up question', {
  history: [
    { role: 'user', content: 'What is TypeScript?' },
    { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript...' },
  ],
})
```

Works with both `.prompt()` and `.stream()`. History messages are prepended after the system prompt, before the current user message.

### Auto-persist conversations

Override `conversational()` on an agent class to auto-load and auto-save threads without threading user ids through every call site:

```ts
class ChatAgent extends Agent {
  conversational() { return { user: Auth.user()?.id } }
}

await new ChatAgent().prompt('Hi')         // auto-loads + auto-saves
await new ChatAgent().prompt('Continue?')  // resumes same thread (per user + class)
```

Returning `false` (the default) keeps the agent stateless. Async returns are awaited; an optional `historyLimit` caps loaded messages. Per-call escape hatches: `prompt(input, { conversation: false })` or `agent.forUser(id).prompt()` / `agent.continue(id).prompt()` — explicit always wins. See `docs/guide/ai.md` for the full precedence chain.

### User memory beyond conversation history (Mem0-style)

Conversation history persists messages; user memory persists **facts** that should travel across conversations. Useful when the agent needs to remember "Alice's project is named Foo" in a brand-new thread without replaying the entire prior session.

```ts
import type { UserMemory } from '@rudderjs/ai'
import { MemoryUserMemory } from '@rudderjs/ai'

// config/ai.ts — wire a backend
export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: { /* ... */ },
  memory: new MemoryUserMemory(),    // in-process; swap for an ORM- or embedding-backed store in production
} satisfies AiConfig

// Use it directly
const memory = app().make<UserMemory>('ai.memory')
await memory.remember('user_123', 'Project name is Foo', { tags: ['project'] })
const facts = await memory.recall('user_123', 'project')
//=> [{ fact: 'Project name is Foo', tags: ['project'], ... }]
```

Or declare on an agent class to opt into auto-inject — relevant facts get prepended to the system prompt before each turn, with no plumbing on the caller's side:

```ts
class SupportAgent extends Agent {
  remembers() {
    return {
      user:               ctx.user.id,
      inject:            'auto',          // recall + prepend matching facts before each model call
      tags:              ['support'],     // recall scope
      injectLimit:       5,               // cap facts per turn
      injectTokenBudget: 400,             // hard token cap; lowest-score facts drop first
    }
  }
}

await new SupportAgent().prompt('Where is my project deployed?')
// system prompt sent to the model:
//   "You are a support agent.\n\n
//    <user-memory>\n
//    - Project Foo deploys to fly.io us-east\n
//    - …\n
//    </user-memory>"
```

The auto-cascade runs in `Agent.prompt` / `Agent.stream`, before conversation persistence. `withMemoryInject(spec)` is also exported so you can drop it into `agent.middleware()` manually if you want full control.

**Continuation note:** when you pass `options.messages` (e.g. resuming after a client-tool round-trip), both auto-inject and auto-extract are skipped — the system prompt was already augmented on the original turn, and re-extracting would write the same facts twice.

#### Auto-extract — distill facts from each turn

Set `extract: 'auto'` (and an `extractWith` model) and a small model is asked to pull durable facts from each successful turn:

```ts
class SupportAgent extends Agent {
  remembers() {
    return {
      user:        ctx.user.id,
      inject:      'auto',
      extract:     'auto',
      extractWith: 'anthropic/claude-haiku-4-5',     // small model for fact distillation
      tags:        ['support'],
    }
  }
}

await new SupportAgent().prompt('hey, my project is named Foo and lives at /var/www/foo')
// On success, the small model is asked to distill durable facts. Survivors above
// the confidence threshold (default 0.7) get written via `mem.remember()`:
//   - "Project name is Foo"  (score ~0.95, tags: ['support', 'project'])
```

Failures (network, JSON parse, schema mismatch, store write) route through `MemoryExtractOptions.onError` and never break the parent run. Failed parent runs do NOT trigger extract.

**Poisoning mitigation** — auto-extraction trusts the user's own conversation as input. The default 0.7 confidence threshold is the v1 defense against adversarial "facts." Pair with `MemoryExtractOptions.onExtracted` for an audit log when shipping to production, and tighten the threshold for high-risk domains.

#### Production backend — `OrmUserMemory`

For production, swap `MemoryUserMemory` for `OrmUserMemory` (subpath `@rudderjs/ai/memory-orm`) — persists rows via your registered `@rudderjs/orm` adapter (Prisma today; Drizzle once you wire the tables):

```ts
// config/ai.ts
import type { AiConfig } from '@rudderjs/ai'
import { OrmUserMemory } from '@rudderjs/ai/memory-orm'

export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: { /* ... */ },
  memory: new OrmUserMemory(),
} satisfies AiConfig
```

Add the schema to your Prisma file (or import the reference string `userMemoryPrismaSchema` from `@rudderjs/ai/memory-orm`):

```prisma
model UserMemory {
  id        String   @id @default(cuid())
  userId    String
  fact      String
  /// JSON-encoded `string[]` of tags, or null
  tags      String?
  /// Confidence score in [0, 1] — extract sets this from the model's self-rating
  score     Float?
  /// Phase 5 — vector embedding for cosine recall (nullable so Phase 4 ignores it)
  embedding Bytes?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}
```

Then run `pnpm exec prisma db push` (dev) or `pnpm exec prisma migrate dev` (prod). The `embedding Bytes?` column is intentionally nullable — Phase 5's `EmbeddingUserMemory` populates it without forcing a follow-up migration.

`OrmUserMemory.recall()` uses **OR-of-LIKE token overlap** on the `fact` column — same semantic as `MemoryUserMemory`. Tag-array filtering happens JS-side after fetch (pushing tags into the WHERE is adapter-specific; that lands in a follow-up).

#### Embedding backend — `EmbeddingUserMemory` (Phase 5)

For semantic recall ("Where do I deploy?" matching "Project Foo lives at fly.io"), wrap `OrmUserMemory` with `EmbeddingUserMemory` from `@rudderjs/ai/memory-embedding`:

```ts
import { OrmUserMemory } from '@rudderjs/ai/memory-orm'
import { EmbeddingUserMemory } from '@rudderjs/ai/memory-embedding'

export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: { /* ... */ },
  memory: new EmbeddingUserMemory({
    inner: new OrmUserMemory(),
    model: 'openai/text-embedding-3-small',
    threshold: 0.5,                    // cosine floor; matches below get dropped
  }),
} satisfies AiConfig
```

`remember()` embeds the fact via `AI.embed()` and writes the Float32-packed vector into the row's `embedding` column. `recall()` embeds the query and ranks all of the user's facts by **pure-JS cosine similarity** (acceptable up to a few thousand facts/user; for larger workloads, B7 lands a pgvector-backed variant).

**GDPR right-to-be-forgotten cascades automatically** — the embedding lives in the same row as the fact, so `forget()` / `forgetAll()` delete both. No second store to keep in sync.

**Backward compat with Phase 4:** rows persisted before `EmbeddingUserMemory` was wired in have `embedding === null`. The default `nullEmbeddingFallback: 'token-overlap'` falls back to the same token-overlap matching `MemoryUserMemory` uses, so upgrading from `OrmUserMemory` doesn't lose recall on existing rows. New `remember()` calls populate the embedding column going forward. Set `nullEmbeddingFallback: 'skip'` to drop pre-embedding rows entirely.

`embed()` failures (network down, missing peer SDK) are swallowed: `remember()` still persists the entry with `embedding === null`, and `recall()` falls back to token-overlap. The parent prompt never breaks because of memory work.

**A4 status (all phases shipped):** interface, in-process backend, per-call/class declaration, auto-inject, auto-extract, ORM-backed `OrmUserMemory`, and embedding-backed `EmbeddingUserMemory` all ship today. The roadmap item is complete.

### Model Selection

Configure available models for user selection (used by `@rudderjs/panels` chat UI):

```ts
// config/ai.ts
export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: { ... },
  models: [
    { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', default: true },
    { id: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
}
```

The model registry is available via `AiRegistry.getModels()` / `AiRegistry.getDefault()`.

### Middleware

```ts
import type { AiMiddleware } from '@rudderjs/ai'

const loggingMiddleware: AiMiddleware = {
  name: 'logger',
  onStart(ctx) { console.log(`[AI] Request ${ctx.requestId} started`) },
  onFinish(ctx) { console.log(`[AI] Request ${ctx.requestId} finished`) },
  onBeforeToolCall(ctx, toolName, args) {
    console.log(`[AI] Calling tool: ${toolName}`, args)
  },
}
```

### Testing

```ts
import { AiFake, AI } from '@rudderjs/ai'

const fake = AiFake.fake()
fake.respondWith('Mocked response')

const response = await AI.prompt('Hello')
assert.strictEqual(response.text, 'Mocked response')

fake.assertPrompted(input => input.includes('Hello'))
fake.restore()
```

Fakes cover every modality:

```ts
fake.respondWith('text')                  // text generation
fake.respondWithImage('base64...')        // image generation
fake.respondWithAudio(Buffer.from(''))    // TTS
fake.respondWithTranscription('text')     // STT
fake.respondWithEmbedding([[0.1, 0.2]])   // embeddings
fake.respondWithRanking([                 // reranking
  { index: 0, relevanceScore: 0.95, document: 'most relevant' },
])
fake.respondWithFileUpload({             // file upload
  id: 'file-123', filename: 'report.pdf', bytes: 1024,
})

// Assertions
fake.assertPrompted()          fake.assertImageGenerated()
fake.assertAudioGenerated()    fake.assertTranscribed()
fake.assertEmbedded()          fake.assertReranked()
fake.assertFileUploaded()
```

**Strict mode (`preventStrayPrompts`).** Without it, an unscripted prompt silently falls back to the ambient `respondWith` default — which means a test that forgets to assert anything still passes. Strict mode flips that around: any prompt without a matching scripted response throws.

```ts
const fake = AiFake.fake().preventStrayPrompts()
fake.respondWithSequence([{ text: 'expected reply' }])

await new ChatAgent().prompt('hello')   // OK — consumes step 0
await new ChatAgent().prompt('again')   // throws "Stray prompt: no scripted response at step 1"
```

Under strict mode, only `respondWithSequence` entries count as valid responses; ambient `respondWith` is ignored. Force a single-step script via `respondWithSequence([{ text: '...' }])` if you want exact-one-prompt tests with content.

### Evals — `@rudderjs/ai/eval`

`AiFake` proves the agent's wiring works; **evals** prove the agent does the right thing on real models. Define a suite of input cases + assertions, run them against any `Agent`, get a console report with pass/fail + cost + tokens:

```ts
// evals/support-agent.eval.ts
import { evalSuite, llmJudge, exactMatch, regex } from '@rudderjs/ai/eval'
import { SupportAgent } from '../app/Agents/SupportAgent.js'

export default evalSuite('SupportAgent', {
  agent: () => new SupportAgent(),
  cases: [
    { name: 'password reset',
      input: 'How do I reset my password?',
      assert: llmJudge('mentions a password reset link') },
    { name: 'price',
      input: 'How much does this cost?',
      assert: exactMatch('$99/month') },
    { name: 'support email',
      input: 'How do I contact support?',
      assert: regex(/support@example\.com/) },
  ],
})
```

Run via the CLI (Phase 2):

```bash
pnpm rudder ai:eval                    # all suites under evals/**/*.eval.ts
pnpm rudder ai:eval support            # only suites whose name includes "support"
pnpm rudder ai:eval --bail             # stop on first failing suite
pnpm rudder ai:eval --json             # machine-readable envelope to stdout
```

```text
SupportAgent (3 cases, 2.3s, $0.014)
  ✓ password reset             1.2s   $0.003   tokens: 487
  ✓ price                      0.8s   $0.002   tokens: 312
  ✗ support email              1.1s   $0.002   tokens: 425
      pattern /support@example\.com/ did not match "Reach us at hello@…"

  2 passed, 1 failed
  total: $0.007  •  cumulative tokens: 1,224
```

Exits 0 when every case passes, 1 on any failure. `--json` emits `{ suites: [{ suite, passed, failed, cases: [{ name, status, pass, score?, reason?, tokens, cost, duration }] }] }` to stdout — pipe directly into `jq` for CI gates.

Override the discovery pattern via `config('ai').eval.pattern` (`'evals/**/*.eval.ts'` by default; supports `<dir>/**/*<suffix>` and `*<suffix>` shapes).

Or run programmatically:

```ts
import { runSuite, reportConsole, reportJson } from '@rudderjs/ai/eval'
import suite from './evals/support-agent.eval.ts'

reportConsole(await runSuite(suite))
// reportJson(await runSuite(suite))   // structured envelope for CI scripts
```

**Built-in metrics:**

| Metric | Behavior |
|---|---|
| `exactMatch(string)` | `response.text === expected` |
| `regex(RegExp)` | `pattern.test(response.text)` |
| `llmJudge(criterion, opts?)` | Asks a small model whether the response satisfies a natural-language criterion. Returns the judge's reasoning in `reason` so failures are debuggable. |
| `jsonShape(zodSchema)` | Strips ```` ``` ```` fences, parses, runs zod `safeParse`. Surfaces the zod issue path on failure. Pairs with `Output.object({ schema })` on the agent. |
| `semanticMatch(reference, opts?)` | Embeds reference + response via `AI.embed()`, cosine similarity vs `opts.threshold` (default `0.85`). Embed cost rolls into the case's cost rollup. Requires a provider with `createEmbedding()` (openai/google/mistral/cohere/jina). |
| `tokenCost(threshold)` | Passes when `response.usage.totalTokens <= threshold`. Detects prompt-size regressions before they show up as a billing surprise. |

`compose(...metrics)` runs them in order, short-circuits on the first failure, surfaces its reason. Useful for "must be valid JSON AND under budget" assertions:

```ts
{ input: '…',
  assert: compose(jsonShape(SummarySchema), tokenCost(800)) }
```

User-defined metrics implement `(response, ctx) => MetricResult` — no inheritance, no decorators. The catalog is just a starting set.

**Failure semantics:** the runner never throws upward. Agent errors AND assertion throws become `failed` rows with the message in `reason`. Per-case `timeout` (ms) caps long runs. Per-case `agent` factory overrides the suite default — useful for stress-testing one case against a different model.

**Roadmap:** Phase 4 adds `--record` / `--replay` (deterministic regression tests via `AiFake`) + telescope eval-pass-rate dashboards. Phase 5 adds an HTML report.

### MCP integration

`@rudderjs/ai/mcp` bridges agents and Model Context Protocol servers in both directions. Optional peer: `@modelcontextprotocol/sdk`.

```ts
import { mcpClientTools, mcpServerFromAgent } from '@rudderjs/ai/mcp'
```

#### Consume MCP tools in an Agent — `mcpClientTools(transport, opts?)`

Connect to a remote MCP server and surface its tools to an agent.

```ts
// HTTP transport
const tools = await mcpClientTools('https://api.example.com/mcp')

// Local subprocess (stdio)
const tools = await mcpClientTools({ command: 'npx', args: ['some-mcp-server'] })

// Already-connected SDK Client (caller owns lifecycle)
const tools = await mcpClientTools(myClient)

class ResearchAgent extends Agent {
  instructions() { return 'You have access to remote tools via MCP.' }
  tools() { return tools }
}
```

The remote server's JSON Schema flows directly to providers via the `jsonSchema` passthrough field on `ToolDefinitionOptions` — no zod round-trip. When this connector owns the underlying client (URL or stdio transport), the returned array exposes a non-enumerable `close()` for shutdown:

```ts
const tools = await mcpClientTools('https://api.example.com/mcp')
// ... use tools in agent ...
await tools.close?.()
```

Options: `filter` (drop tools by name), `namePrefix` (avoid collisions across multiple servers), `streaming` (forward MCP `notifications/progress` as `tool-update` chunks; default `true`).

#### Expose an Agent as an MCP server — `mcpServerFromAgent(AgentClass, opts?)`

Wrap an `Agent` so external MCP clients (Claude Desktop, Cursor, etc.) can call it. Returns a `McpServer` from `@modelcontextprotocol/sdk` — connect with any SDK transport.

```ts
import { mcpServerFromAgent } from '@rudderjs/ai/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = await mcpServerFromAgent(ResearchAgent)
await server.connect(new StdioServerTransport())
```

Three exposure modes via `opts.expose`:
- `'tools'` *(default)* — one MCP tool per `agent.tools()` entry; the wrapping agent isn't called, individual tools execute directly
- `'agent'` — one MCP tool that runs the whole agent (`prompt(text) → response.text`); the differentiator move — ship an agent, callable from any MCP-aware client
- `'both'` — individual tools and the agent prompt-tool side by side

Other options: `name`, `version`, `instructions` (defaults to `agent.instructions()`), `agentToolName` (renames the prompt-tool when `expose: 'agent' | 'both'`).

Approval gates (`needsApproval: true`) are dropped on the MCP side — there's no MCP-protocol way to forward "this tool needs human approval" to a remote client. The gate fires only inside the wrapping agent, not for external MCP callers.

## Providers

| Provider | SDK | Model String | Text | Embeddings | Images | TTS/STT | Reranking | Files |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Anthropic | `@anthropic-ai/sdk` | `anthropic/claude-sonnet-4-5` | ✓ | | | | | ✓ |
| OpenAI | `openai` | `openai/gpt-4o` | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Google | `@google/genai` | `google/gemini-2.5-pro` | ✓ | ✓ | ✓ | | | ✓ |
| Cohere | `cohere-ai` | `cohere/rerank-v3.5` | | ✓ | | | ✓ | |
| Jina | *(none)* | `jina/jina-reranker-v2-base-multilingual` | | ✓ | | | ✓ | |
| Ollama | *(none)* | `ollama/llama3` | ✓ | | | | | |
| Groq | *(none)* | `groq/llama-3.3-70b` | ✓ | | | | | |
| DeepSeek | *(none)* | `deepseek/deepseek-chat` | ✓ | | | | | |
| xAI | *(none)* | `xai/grok-3` | ✓ | | | | | |
| Mistral | *(none)* | `mistral/mistral-large` | ✓ | ✓ | | | | |
| Azure OpenAI | `openai` | `azure/gpt-4o` | ✓ | | | | | |
| OpenRouter | `openai` | `openrouter/anthropic/claude-3.5-sonnet` | ✓ | | | | | |
| AWS Bedrock | `@aws-sdk/client-bedrock-runtime` | `bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0` | ✓ | | | | | |

## Notes

- Provider SDKs are optional dependencies — install only what you use
- `exactOptionalPropertyTypes` compatible
- All adapters lazy-load their SDK on first use
- Ollama, Groq, DeepSeek, xAI, Mistral, OpenRouter reuse the OpenAI adapter (OpenAI-compatible API)
- Cohere requires `cohere-ai` SDK; Jina uses direct HTTP (no SDK needed)
- Bedrock uses the AWS credential chain (env vars / IAM roles / `~/.aws/credentials`); v1 supports Anthropic Claude models on Bedrock
