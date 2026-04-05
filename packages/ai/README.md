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

```ts
import { toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'

// Server tool — executes on backend
const weatherTool = toolDefinition({
  name: 'get_weather',
  description: 'Get weather for a location',
  inputSchema: z.object({ location: z.string() }),
  needsApproval: true,  // requires user approval
  lazy: true,           // not sent to LLM upfront
}).server(async ({ location }) => ({ temp: 72, unit: 'F' }))

// Client tool — executes in browser
const themeTool = toolDefinition({
  name: 'apply_theme',
  description: 'Apply a UI theme',
  inputSchema: z.object({ theme: z.enum(['light', 'dark']) }),
}).client(async ({ theme }) => { document.body.className = theme })
```

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

### Embeddings

Generate vector embeddings for text (requires a provider that supports embeddings, e.g. OpenAI):

```ts
import { AI } from '@rudderjs/ai'

// Single text
const result = await AI.embed('Hello world')
// result.embeddings → [[0.012, -0.034, ...]]

// Batch
const result = await AI.embed(['text one', 'text two'])
// result.embeddings → [[...], [...]]

// Specific model
const result = await AI.embed('text', { model: 'openai/text-embedding-3-small' })
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

| Provider | SDK | Model String |
|---|---|---|
| Anthropic | `@anthropic-ai/sdk` | `anthropic/claude-sonnet-4-5` |
| OpenAI | `openai` | `openai/gpt-4o` |
| Google | `@google/genai` | `google/gemini-2.5-pro` |
| Ollama | *(none)* | `ollama/llama3` |

## Notes

- Provider SDKs are optional dependencies — install only what you use
- `exactOptionalPropertyTypes` compatible
- All adapters lazy-load their SDK on first use
- Ollama reuses the OpenAI adapter (OpenAI-compatible API)
