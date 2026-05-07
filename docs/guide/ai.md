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

Tools let the agent call your code. Define a tool with `tool(...)`, declare its input schema with Zod, and implement the body:

```ts
import { tool } from '@rudderjs/ai'
import { z } from 'zod'
import { User } from '../app/Models/User.js'

const searchTool = tool('search_users', 'Search users by name or email')
  .input(z.object({
    query: z.string().describe('Name or email substring'),
    limit: z.number().int().min(1).max(50).default(10),
  }))
  .handle(async ({ query, limit }) => {
    return User
      .where('name', 'LIKE', `%${query}%`)
      .orWhere('email', 'LIKE', `%${query}%`)
      .limit(limit)
      .get()
  })
```

The agent decides when to call tools based on the prompt. Tool calls and results both flow through the response object — inspect `response.steps` for the full trace.

When a model emits more than one tool call in a single step, their `execute()` functions run **in parallel** by default. The streamed chunk order is preserved (tool A's `tool-call` → updates → `tool-result` always precedes B's), so consumers see deterministic sequences regardless of which tool finishes first. Approval gates and `onBeforeToolCall` middleware decisions still resolve serially in tool-call order before any `execute()` runs. Opt out per call when tools share non-idempotent state (counters, file writes, sequential transactions):

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

For client-routed tools (dispatched to the browser to execute, e.g. updating form state), use `clientTool(...)` — see the [package README](https://github.com/rudderjs/rudder/tree/main/packages/ai).

## Streaming

For UIs that show output as it generates:

```ts
const stream = agent('You are a helpful assistant.').stream('Tell me a story.')

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk)
}

const finalResponse = await stream.finalResponse  // wait for the whole answer
```

For server-sent events to a browser client, use `stream.toServerSentEvents(res)`. The Vercel AI SDK adapter at `@rudderjs/ai/vercel` plugs straight into `useChat()` from `ai/react`.

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

A tool's handler can itself invoke another agent. The framework propagates streaming progress and authorization upstream so the parent agent's UI stays in sync:

```ts
const research = tool('research', 'Research a topic in depth')
  .input(z.object({ topic: z.string() }))
  .handle(async ({ topic }) => {
    return await new ResearchAgent().prompt(topic)
  })

await agent({ tools: [research], stopWhen: stepCountIs(5) })
  .prompt('Summarize the transformer paper.')
```

## Conversation persistence

Pass a `conversation` object to thread messages across calls:

```ts
import { agent, createConversation } from '@rudderjs/ai'

const conversation = createConversation('user-42')

await agent('You are an assistant.').conversation(conversation).prompt('My name is Alice.')
const reply = await agent('You are an assistant.').conversation(conversation).prompt('What's my name?')
// reply.text → 'Your name is Alice.'
```

Implement `ConversationStore` to persist threads to your database — Redis or Prisma adapters are the typical choices.

## Middleware

Middleware wraps every model call — useful for logging, redaction, retry, caching:

```ts
import { defineMiddleware } from '@rudderjs/ai'

const logUsage = defineMiddleware(async (ctx, next) => {
  const start = Date.now()
  const response = await next()
  console.log(`${ctx.model} • ${Date.now() - start}ms • ${response.usage.totalTokens} tokens`)
  return response
})

await agent({ middleware: [logUsage] }).prompt('Hello')
```

The framework ships built-in middleware for retry, redaction, and rate limiting — see the [package README](https://github.com/rudderjs/rudder/tree/main/packages/ai).

## Testing

```ts
import { AI } from '@rudderjs/ai'

AI.fake().respondWith('Mocked response')
await myCodeThatCallsAI()

AI.assertCalled()
AI.assertCalled((call) => call.prompt.includes('summarize'))
```

`AI.fake()` swaps the provider with a programmable fake — no API calls, no API key needed in tests.

## Pitfalls

- **Bare model names.** `model: 'claude-sonnet-4-5'` throws — must be `provider/model`.
- **Tool handlers throwing.** The agent gets the error message back as the tool result. Catch known errors inside the handler and return a structured failure shape.
- **Streaming without `finalResponse`.** Iterating `textStream` without awaiting `finalResponse` skips hooks that depend on it (middleware, conversation persistence). Always await it or `await stream.cancel()`.
