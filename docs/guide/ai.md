# AI

`@rudderjs/ai` is a provider-agnostic agent framework — define an agent once, swap between Anthropic, OpenAI, Google, Ollama, and six others by changing one string. Ships tool calling, streaming, middleware hooks, structured output, multi-modal attachments, conversation persistence, and a test fake.

```ts
import { agent } from '@rudderjs/ai'

const response = await agent('You are a helpful assistant.')
  .prompt('Summarize the transformer architecture in one sentence.')

console.log(response.text)
```

This guide walks through agents, tools, streaming, and testing. For the full reference (image generation, TTS/STT, embeddings, reranking, Vercel AI Protocol adapter), see the [package README](https://github.com/rudderjs/rudder/tree/main/packages/ai).

---

## Setup

```bash
pnpm add @rudderjs/ai
pnpm add @anthropic-ai/sdk   # Anthropic (Claude)
pnpm add openai              # OpenAI (GPT)
pnpm add @google/genai       # Google (Gemini)
# Ollama, Groq, DeepSeek, xAI, Mistral — no extra SDK needed
```

Provider SDKs are **optional peers** — install only the ones you use. Each provider adapter lazy-loads its SDK on first call, so unused providers add zero overhead.

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

Models are always addressed as `provider/model`. A bare model name throws.

Register the provider — auto-discovered if you use `defaultProviders()`:

```ts
// bootstrap/providers.ts
import { ai } from '@rudderjs/ai'
import configs from '../config/index.js'

export default [
  ai(configs.ai),
  // ...other providers
]
```

---

## Your first agent

Three shapes, pick whichever reads best at the call site.

**Anonymous agent** — inline one-off:

```ts
import { agent, AI } from '@rudderjs/ai'

const response = await agent('You summarize text.').prompt('Summarize this...')

// Or the facade — uses the default provider
const response = await AI.prompt('Hello world')
```

**Configured anonymous agent** — keep tools and options together:

```ts
const response = await agent({
  instructions: 'You help find users in the system.',
  model: 'anthropic/claude-sonnet-4-5',
  tools: [searchTool],
}).prompt('Find all admins')
```

**Agent class** — reusable, testable, typed:

```ts
import { Agent, stepCountIs, type HasTools } from '@rudderjs/ai'

class SearchAgent extends Agent implements HasTools {
  instructions() { return 'You help find users in the system.' }
  model()        { return 'anthropic/claude-sonnet-4-5' }
  tools()        { return [searchTool] }
  stopWhen()     { return stepCountIs(5) }
}

const response = await new SearchAgent().prompt('Find all admins')
```

Reach for the class when the agent has non-trivial state (tools, middleware, conversation persistence, failover) and the same agent is called from multiple places.

---

## Tools

A tool is `{ definition, execute? }`. The presence of `execute` is the only discriminator — a **server tool** runs on your backend; a **client tool** (no `execute`) pauses the loop so the browser can run it.

```ts
import { toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'

// Server tool — executes on backend
const weatherTool = toolDefinition({
  name: 'get_weather',
  description: 'Get weather for a location',
  inputSchema: z.object({ location: z.string() }),
}).server(async ({ location }) => {
  const data = await fetch(`https://api.example.com/weather?q=${location}`).then(r => r.json())
  return { temp: data.temp, conditions: data.conditions }
})

// Client tool — no .server()
const readFormState = toolDefinition({
  name: 'read_form_state',
  description: 'Read the user\'s current local form values.',
  inputSchema: z.object({ fields: z.array(z.string()).optional() }),
})
```

Zod schemas are converted to JSON Schema for each provider automatically.

### Shrinking what the model sees with `.modelOutput()`

Big structured results eat context. Use `.modelOutput(fn)` to give the model a compact summary while the UI still gets the full result:

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

The UI stream chunk still carries `{ results, total }` — useful for rendering a results card. The model just sees the summary string on its next step.

### Approval gates

Add `needsApproval: true` and the loop **pauses** instead of calling the tool — the response carries `pendingApprovalToolCall` for the UI to show an approval prompt:

```ts
const deletePostTool = toolDefinition({
  name: 'delete_post',
  description: 'Permanently delete a post',
  inputSchema: z.object({ id: z.string() }),
  needsApproval: true,
}).server(async ({ id }) => {
  await Post.delete(id)
  return { deleted: true }
})

// In the route handler
const result = await myAgent.prompt(userInput)

if (result.finishReason === 'tool_approval_required') {
  // UI shows approval card; user clicks Approve → you re-POST with:
  //   approvedToolCallIds: [result.pendingApprovalToolCall.id]
}
```

Same mechanism for client tools — the loop stops with `finishReason === 'client_tool_calls'`, the browser runs the tool, and the continuation re-POSTs with the resolved results.

See the package README for the full continuation protocol (messages array, `resumedToolMessages`, generative UI registry).

---

## Streaming

`stream()` gives you the async iterator plus a promise that resolves after the stream completes with the full response:

```ts
const { stream, response } = myAgent.stream('Write a short story.')

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text ?? '')
  if (chunk.type === 'tool-call')  console.log('[tool]', chunk.toolCall?.name)
}

const final = await response  // full AgentResponse once the stream ends
```

Always iterate the stream before awaiting `response` — the promise only resolves once the stream is fully drained.

**Stream chunk types:** `text-delta` · `tool-call` · `tool-result` · `tool-update` (progress) · `pending-client-tools` · `pending-approval`

**Vercel AI Protocol:** if your frontend uses `useChat` from `ai/react` (or the Nuxt/Svelte equivalents), wrap the stream with `toVercelResponse()`:

```ts
import { toVercelResponse } from '@rudderjs/ai'

Route.post('/api/chat', async (req) => {
  const { stream } = agent('You are helpful.').stream(req.body.messages)
  return toVercelResponse(stream)
})
```

---

## Structured output

Force the model to respond in a typed shape via `Output`:

```ts
import { agent, Output } from '@rudderjs/ai'
import { z } from 'zod'

// Enum-style
const sentiment = Output.choice({ options: ['positive', 'negative', 'neutral'] as const })

// Typed object
const entities = Output.object({
  schema: z.object({
    people:    z.array(z.string()),
    companies: z.array(z.string()),
  }),
})

// Array of items
const items = Output.array({
  element: z.object({ title: z.string(), priority: z.number() }),
})
```

Pass the output to the agent and the response's `object` field contains the parsed result (type-safe from the Zod schema).

---

## Middleware

Middleware hooks into the agent lifecycle. Use it for logging, rate limiting, tool filtering, token tracking, prompt transformation — anything that cuts across agents.

```ts
import type { AiMiddleware } from '@rudderjs/ai'

const logging: AiMiddleware = {
  name: 'logging',

  onStart(ctx) {
    console.log(`[ai] ${ctx.requestId} start`)
  },

  onBeforeToolCall(ctx, toolName, args) {
    if (toolName === 'delete_post') return { type: 'skip', result: 'Disabled in prod' }
    return undefined  // continue
  },

  onUsage(ctx, usage) {
    metrics.increment('ai.tokens', usage.totalTokens)
  },

  onFinish(ctx) {
    console.log(`[ai] ${ctx.requestId} finish`)
  },
}
```

**Available hooks:** `onConfig` · `onStart` · `onIteration` · `onChunk` · `onBeforeToolCall` · `onAfterToolCall` · `onToolPhaseComplete` · `onUsage` · `onAbort` · `onError` · `onFinish`

Register per-agent via a `middleware()` method on the class, or pass `middleware: [...]` to the anonymous `agent({...})` shape.

---

## Conversations

Persist multi-turn conversations — `forUser(id)` starts a new one, `.continue(id)` resumes:

```ts
import { setConversationStore, MemoryConversationStore } from '@rudderjs/ai'

setConversationStore(new MemoryConversationStore())

const first = await myAgent.forUser('user-123').prompt('Hello')
// first.conversationId → 'conv_...'

const follow = await myAgent.continue(first.conversationId).prompt('Follow up')
```

Or pass raw history if you already have it:

```ts
await agent('You are helpful.').prompt('Follow up?', {
  history: [
    { role: 'user',      content: 'What is TypeScript?' },
    { role: 'assistant', content: 'TypeScript is...' },
  ],
})
```

Production usually wants a durable store (Prisma, Redis) — implement the `ConversationStore` interface and register with `setConversationStore()`.

---

## Failover

List backup providers — if the primary fails, the agent falls through in order:

```ts
class ResilientAgent extends Agent {
  instructions() { return 'You are helpful.' }
  model()        { return 'anthropic/claude-sonnet-4-5' }
  failover()     { return ['openai/gpt-4o', 'google/gemini-2.5-pro'] }
}
```

Works with both `.prompt()` and `.stream()`. The provider that actually served the response is on `response.model`.

---

## Testing

`AiFake` swaps in a stubbed provider — no real API calls, full assertion surface:

```ts
import { AiFake, AI } from '@rudderjs/ai'

const fake = AiFake.fake()
fake.respondWith('Mocked summary')

const response = await AI.prompt('Summarize something')
assert.strictEqual(response.text, 'Mocked summary')

fake.assertPrompted(input => input.includes('Summarize'))
fake.restore()
```

Covers every modality — `respondWithImage`, `respondWithAudio`, `respondWithTranscription`, `respondWithEmbedding`, `respondWithRanking`, `respondWithFileUpload` — plus matching `assert*` helpers.

---

## Provider matrix

| Provider | SDK | Text | Embeddings | Images | TTS/STT | Reranking |
|---|---|:---:|:---:|:---:|:---:|:---:|
| Anthropic | `@anthropic-ai/sdk` | ✓ | | | | |
| OpenAI | `openai` | ✓ | ✓ | ✓ | ✓ | |
| Google | `@google/genai` | ✓ | ✓ | ✓ | | |
| Cohere | `cohere-ai` | | ✓ | | | ✓ |
| Jina | *(none)* | | ✓ | | | ✓ |
| Ollama | *(none)* | ✓ | | | | |
| Groq, DeepSeek, xAI, Mistral, Azure | *(none / `openai`)* | ✓ | partial | | | |

Ollama, Groq, DeepSeek, xAI, and Mistral reuse the OpenAI adapter — they speak the OpenAI-compatible API.

---

## Common pitfalls

- **Bare model name throws.** Always use `provider/model` format (e.g. `anthropic/claude-sonnet-4-5`).
- **Optional SDK not installed.** Adapter throws on first call with a clear `Cannot find module '@anthropic-ai/sdk'` — install the SDK for the provider you're using.
- **Tool loop limit silent stop.** `stopWhen()` defaults to `stepCountIs(20)`. If the agent hits 20 steps it just stops — raise it for complex multi-tool workflows.
- **`await response` hangs.** When streaming, `response` only resolves after the stream is fully consumed. Iterate `stream` first, then `await response`.
- **`.forUser()` / `.continue()` throw.** No `ConversationStore` registered. Call `setConversationStore()` or pass `conversations` in the AI config.
- **Props include functions/class instances.** Tool `execute` return values are serialized to JSON for the model — methods, symbols, and non-plain objects get stripped. Return plain data.
- **Generator tool yields the wrong chunk shape.** Use the `pauseForClientTools()` factory rather than constructing pause chunks by hand. Future shape changes stay source-compatible that way.
- **Embeddings silently no-op.** Only providers that implement `createEmbedding()` (OpenAI-compatible, Cohere, Jina) support `AI.embed()`. Check the provider matrix.

---

## Next Steps

- [MCP](/guide/mcp) — expose your tools + resources to external AI agents (Claude Code, Cursor, etc.) over Model Context Protocol
- [Queue](/guide/rudder) — move long-running agent runs off the request hot path
- [AI package README](https://github.com/rudderjs/rudder/tree/main/packages/ai) — full reference: image generation, TTS/STT, reranking, file management, Vercel AI Protocol adapter
