# @rudderjs/ai

AI engine for RudderJS — providers, agents, tools, streaming, middleware, structured output, conversation memory, and testing fakes.

## Installation

```bash
pnpm add @rudderjs/ai
```

Install the provider SDK(s) you need:

```bash
pnpm add @anthropic-ai/sdk   # Anthropic (Claude)
pnpm add openai               # OpenAI (GPT)
pnpm add @google/genai        # Google (Gemini)
# Ollama — no extra package needed (OpenAI-compatible)
```

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
  },
}

// bootstrap/providers.ts
import { ai } from '@rudderjs/ai'
export default [ai(configs.ai), ...]
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

const result = await AI.transcribe('./meeting.mp3')
  .model('openai/whisper-1')
  .language('en')
  .generate()

// result.text → transcribed text
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

## Providers

| Provider | SDK | Model String | Embeddings | Images | TTS/STT |
|---|---|---|---|---|---|
| Anthropic | `@anthropic-ai/sdk` | `anthropic/claude-sonnet-4-5` | | | |
| OpenAI | `openai` | `openai/gpt-4o` | ✓ | ✓ | ✓ |
| Google | `@google/genai` | `google/gemini-2.5-pro` | ✓ | ✓ | |
| Ollama | *(none)* | `ollama/llama3` | | | |
| Groq | *(none)* | `groq/llama-3.3-70b` | | | |
| DeepSeek | *(none)* | `deepseek/deepseek-chat` | | | |
| xAI | *(none)* | `xai/grok-3` | | | |
| Mistral | *(none)* | `mistral/mistral-large` | ✓ | | |
| Azure OpenAI | `openai` | `azure/gpt-4o` | | | |

## Notes

- Provider SDKs are optional dependencies — install only what you use
- `exactOptionalPropertyTypes` compatible
- All adapters lazy-load their SDK on first use
- Ollama, Groq, DeepSeek, xAI, Mistral reuse the OpenAI adapter (OpenAI-compatible API)
