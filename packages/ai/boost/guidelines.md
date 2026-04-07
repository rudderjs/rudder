# @rudderjs/ai

## Overview

AI engine for RudderJS providing a provider-agnostic agent framework with tool calling, streaming, middleware, attachments, conversation persistence, structured output, and queued execution. Supports Anthropic, OpenAI, Google, Ollama, DeepSeek, xAI, Groq, Mistral, and Azure OpenAI out of the box. Models are addressed via `provider/model` strings (e.g. `anthropic/claude-sonnet-4-5`), and the `AiRegistry` handles provider resolution and failover.

## Key Patterns

### Creating Agents

Extend the `Agent` class for reusable agents, or use `agent()` for inline one-offs:

```ts
class SearchAgent extends Agent implements HasTools, HasMiddleware {
  instructions() { return 'You are a search assistant.' }
  model() { return 'anthropic/claude-sonnet-4-5' }
  tools() { return [searchTool] }
  middleware() { return [loggingMiddleware] }
}
const response = await new SearchAgent().prompt('Find users named John')

// Inline agents
await agent({ instructions: 'You are helpful.', tools: [weatherTool] }).prompt('Hello')
await agent('You are helpful.').prompt('Hello') // simplest form
```

### Using Providers (Anthropic, OpenAI, Google, etc.)

Configure providers in `config/ai.ts` and register with `ai()`:

```ts
// config/ai.ts — providers: anthropic, openai, google, ollama, deepseek, xai, groq, mistral, azure
export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
    openai:    { apiKey: process.env.OPENAI_API_KEY },
    ollama:    { driver: 'ollama', baseUrl: 'http://localhost:11434' },
  },
} satisfies AiConfig

// bootstrap/providers.ts
export default [ai(configs.ai), ...]
```

Agents support failover: `failover() { return ['openai/gpt-4o'] }`

### Tools

Define tools with Zod schemas. Tools are either `server` (executed on backend) or `client` (forwarded to frontend):

```ts
const weatherTool = toolDefinition({
  name: 'get_weather',
  description: 'Get weather for a location',
  inputSchema: z.object({ location: z.string() }),
}).server(async ({ location }) => ({ temp: 72, unit: 'F', location }))
```

### Middleware

Middleware hooks into the agent loop lifecycle. Hooks: `onConfig`, `onStart`, `onIteration`, `onChunk`, `onBeforeToolCall`, `onAfterToolCall`, `onToolPhaseComplete`, `onUsage`, `onAbort`, `onError`, `onFinish`.

```ts
const loggingMiddleware: AiMiddleware = {
  onStart(ctx) { console.log(`[AI] Request ${ctx.requestId} started`) },
  onUsage(ctx, usage) { console.log(`[AI] Tokens: ${usage.totalTokens}`) },
  onBeforeToolCall(ctx, toolName, args) {
    if (toolName === 'dangerous_tool') return { type: 'skip', result: 'Tool disabled' }
    return undefined // continue normally
  },
  onChunk(ctx, chunk) { return chunk }, // transform or return null to drop
}
```

### Attachments

Send images and documents alongside prompts:

```ts
import { Image, Document } from '@rudderjs/ai'

const img = await Image.fromPath('./screenshot.png')
const doc = await Document.fromUrl('https://example.com/report.pdf')

await myAgent.prompt('Describe this image and summarize the doc', {
  attachments: [img.toAttachment(), doc.toAttachment()],
})
```

### Conversations

Persist multi-turn conversations with `ConversationStore`. Register via `setConversationStore()` or pass `conversations` in AI config:

```ts
setConversationStore(new MemoryConversationStore())
const response = await myAgent.forUser('user-123').prompt('Hello')  // creates conversation
const follow = await myAgent.continue(response.conversationId).prompt('Follow up')
```

### Streaming

Use `.stream()` for real-time token delivery:

```ts
const { stream, response } = myAgent.stream('Write a story')

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text ?? '')
  if (chunk.type === 'tool-call') console.log('Tool called:', chunk.toolCall)
}

const final = await response // full AgentResponse after stream ends
```

### Structured Output

Use `Output` to constrain responses to typed schemas:

```ts
import { Output } from '@rudderjs/ai'

const sentiment = Output.choice({ options: ['positive', 'negative', 'neutral'] as const })
const extraction = Output.object({ schema: z.object({ name: z.string(), age: z.number() }) })
const items = Output.array({ element: z.object({ title: z.string() }) })
```

## Common Pitfalls

- **Model string format**: Always use `provider/model` (e.g. `anthropic/claude-sonnet-4-5`). A bare model name throws.
- **Optional SDK deps**: Provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) are optional dependencies. Install the ones you need.
- **ConversationStore required for `.forUser()`/`.continue()`**: Call `setConversationStore()` or pass `conversations` in the AI config. Without it, conversation methods throw.
- **Tool loop limits**: `maxSteps()` defaults to 20. If the agent hits the limit it stops silently. Increase it for complex multi-tool workflows.
- **Streaming response access**: `await response` only resolves after the stream is fully consumed. Always iterate the stream first.
- **Embeddings**: Only providers that implement `createEmbedding()` support `AI.embed()`. Currently OpenAI-compatible providers.

## Key Imports

```ts
import { ai } from '@rudderjs/ai'                          // provider factory
import { Agent, agent, ConversableAgent } from '@rudderjs/ai'  // agents
import { AI } from '@rudderjs/ai'                          // facade (AI.prompt, AI.agent, AI.embed)
import { toolDefinition } from '@rudderjs/ai'              // tool builder
import { Image, Document } from '@rudderjs/ai'             // attachments
import { MemoryConversationStore, setConversationStore } from '@rudderjs/ai'
import { Output } from '@rudderjs/ai'                      // structured output
import { AiRegistry } from '@rudderjs/ai'                  // provider registry
import { stepCountIs, hasToolCall } from '@rudderjs/ai'    // stop conditions
import type { AgentResponse, AiConfig, AiMiddleware, AnyTool, HasTools, HasMiddleware } from '@rudderjs/ai'
```
