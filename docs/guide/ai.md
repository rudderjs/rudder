# AI

`@rudderjs/ai` is Rudder's AI binding. It re-exports the framework-agnostic agent engine, [`@gemstack/ai-sdk`](https://github.com/gemstack-land/gemstack/tree/main/packages/ai-sdk), and wires it into Rudder: provider configuration through `config/ai.ts`, ORM-backed conversation and memory stores, queue- and broadcast-backed runs, a `make:agent` scaffolder, an `ai:eval` command, and a doctor check. One install gives you the full engine plus the framework integration.

```ts
import { agent } from '@rudderjs/ai'

const response = await agent('You are a helpful assistant.')
  .prompt('Summarize the transformer architecture in one sentence.')

console.log(response.text)
```

Everything `@gemstack/ai-sdk` exports is re-exported from `@rudderjs/ai`, so your imports stay `@rudderjs/ai`. This page covers what Rudder adds on top of the engine. For the engine itself, see the GemStack docs linked below.

## Engine reference (GemStack docs)

The agent runtime, tools, streaming, structured output, the memory contracts, RAG, the provider adapters, and the testing/eval framework are all the engine. Their full reference lives in the GemStack docs:

<!-- Interim links point at the GemStack docs source on GitHub. Once the GemStack
     docs site is live (gemstack.land), repoint these to the rendered pages. -->

| Topic | Reference |
|---|---|
| Agents, multi-step, sub-agents, suspend/resume | [ai-sdk / Agents](https://gemstack-land.github.io/gemstack/packages/ai-sdk/agents) |
| Tools, scoped tools, client tools, approval gates | [ai-sdk / Tools](https://gemstack-land.github.io/gemstack/packages/ai-sdk/tools) |
| Streaming, SSE, React, cancellation | [ai-sdk / Streaming](https://gemstack-land.github.io/gemstack/packages/ai-sdk/streaming) |
| Structured output, multi-modal attachments | [ai-sdk / Structured Output](https://gemstack-land.github.io/gemstack/packages/ai-sdk/structured-output) |
| Conversation + user-memory contracts, prompt caching | [ai-sdk / Memory](https://gemstack-land.github.io/gemstack/packages/ai-sdk/memory) |
| Hosted vector stores, embeddings, reranking, RAG | [ai-sdk / RAG](https://gemstack-land.github.io/gemstack/packages/ai-sdk/rag) |
| Provider adapters and config | [ai-sdk / Providers](https://gemstack-land.github.io/gemstack/packages/ai-sdk/providers) |
| The fake, observers, and evals | [ai-sdk / Testing](https://gemstack-land.github.io/gemstack/packages/ai-sdk/testing) |

The rest of this page is Rudder-specific.

## Setup

```bash
pnpm add @rudderjs/ai
pnpm add @anthropic-ai/sdk      # Anthropic
pnpm add openai                  # OpenAI
pnpm add @google/genai           # Google
# Ollama, Groq, DeepSeek, xAI, Mistral - no extra SDK
```

Provider SDKs are optional peers, install only what you use. Each adapter lazy-loads its SDK on first call.

In a framework-free app you register providers against the engine's `AiRegistry`. In Rudder you don't: write a `config/ai.ts`, and the auto-discovered `AiProvider` registers everything for you at boot.

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

Models are always `provider/model`. A bare model name throws. Behind an LLM gateway or proxy? If it is OpenAI- or Anthropic-compatible, set `baseUrl` on the matching driver. If it speaks its own wire format, subclass `HttpGatewayAdapter`, see [Custom Gateway Provider](./custom-gateway-provider).

## Scaffolding an agent

```bash
pnpm rudder make:agent Search
```

generates a typed `Agent` subclass under `app/Agents/`. From there the agent API is the engine's, see [Agents](https://gemstack-land.github.io/gemstack/packages/ai-sdk/agents) for the shapes, `stopWhen()`, sub-agents, and suspend/resume.

## Tools that reach into your app

Tools are defined with the engine's `toolDefinition(...)`, see [Tools](https://gemstack-land.github.io/gemstack/packages/ai-sdk/tools) for the full surface (scoped tools, client tools, approval gates, parallel execution). In a Rudder app a tool handler is just application code, so it can query your models and resolve services from the container:

```ts
import { toolDefinition } from '@rudderjs/ai'
import { z } from 'zod'
import { User } from '../app/Models/User.js'

const searchUsers = toolDefinition({
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

## Conversation persistence (ORM-backed)

The engine defines the `ConversationStore` contract and ships an in-memory default (`MemoryConversationStore`), good for tests but lost on restart. Rudder adds the production store, `OrmConversationStore`, which persists threads through the registered `@rudderjs/orm` adapter (native, Prisma, or Drizzle) so they survive restarts and are shared across web processes and queue workers:

```ts
import { setConversationStore } from '@rudderjs/ai'
import { OrmConversationStore } from '@rudderjs/ai/conversation-orm'

setConversationStore(new OrmConversationStore())

const first  = await new AssistantAgent().forUser('user-42').prompt('My name is Alice.')
const second = await new AssistantAgent().continue(first.conversationId!).prompt("What's my name?")
// second.text -> 'Your name is Alice.'
```

It stores two tables (`AiConversation` + `AiConversationMessage`). Copy the schema from the exported `conversationOrmPrismaSchema` into your Prisma schema, add an equivalent native migration, or define and register the matching Drizzle tables. `OrmConversationStore.load()` runs persisted history through the engine's `sanitizeConversation()` so an interrupted thread is replay-safe.

### Auto-persist with the authed user

Override `conversational()` on the agent class to auto-load and auto-save without threading the user id through every call site:

```ts
class ChatAgent extends Agent {
  conversational() {
    return { user: Auth.user()?.id }   // null user -> falsy -> opt-out
  }
}

await new ChatAgent().prompt('Hi')          // auto-loads thread, runs, auto-saves
await new ChatAgent().prompt('Still you?')  // resumes the same thread
```

Each `(user, agent class)` pair gets its own thread. Override the segregation key with `agent: 'custom'` if you rename the class.

## User memory (ORM-backed)

Conversation persistence remembers messages; **user memory** persists *facts* that travel across conversations. The engine defines the `UserMemory` contract and the `MemoryUserMemory` default; Rudder adds two production backends behind the same interface:

| Backend | Subpath | When to use |
|---|---|---|
| `MemoryUserMemory` | `@rudderjs/ai` (engine default) | Tests, dev, ephemeral state |
| `OrmUserMemory` | `@rudderjs/ai/memory-orm` | Production with `@rudderjs/orm` registered |
| `EmbeddingUserMemory` | `@rudderjs/ai/memory-embedding` | Production + semantic (cosine) recall |

Wire one in `config/ai.ts`; `AiProvider` binds it to the `ai.memory` container key and the engine's `setUserMemory()` registry that the auto-inject / auto-extract middleware look up:

```ts
// config/ai.ts
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

`EmbeddingUserMemory` embeds each fact and ranks recall by cosine similarity, so "Where do I deploy?" matches "Project Foo lives at fly.io". GDPR `forget()` / `forgetAll()` cascades automatically because the vector lives in the same row as the fact. Add the schema from the exported `userMemoryPrismaSchema` (or an equivalent native/Drizzle table).

The `UserMemory` interface, the manual `remember` / `recall` / `forget` API, and the `Agent.remembers()` auto-inject + auto-extract middleware are the engine's, see [Memory](https://gemstack-land.github.io/gemstack/packages/ai-sdk/memory). The ORM backends above are the only Rudder-specific part.

> **Memory poisoning.** Auto-extract trusts the user's own conversation as input, so a malicious user can plant adversarial "facts". The default confidence threshold is the first defense; tighten it for high-risk domains and pair with an audit log via `MemoryExtractOptions.onExtracted`.

## Budgets (ORM-backed)

The engine's `withBudget` middleware enforces token/cost ceilings against a `BudgetStorage` contract. For ceilings that persist across processes, Rudder ships the ORM-backed implementation at `@rudderjs/ai/budget-orm`; register it the same way you register the conversation store.

## Queued and broadcast runs

`AiProvider` wires the engine's neutral queue seam (`configureAiQueue`) to `@rudderjs/queue` and `@rudderjs/broadcast` at boot, so `.queue()` and `.broadcast()` work out of the box in a Rudder app. Push an agent run onto the queue for background execution:

```ts
// Fire-and-forget background run
await new SupportAgent()
  .queue('Help with refund request')
  .onQueue('ai')
  .send()

// With success / failure callbacks
await new ResearchAgent()
  .queue('Research GPT-5 architecture')
  .then(response => console.log('Done:', response.text))
  .catch(error  => console.error('Failed:', error))
  .send()
```

`.broadcast(channel)` streams progress to a broadcast channel as the job runs, so background AI work drives a live UI without polling:

```ts
await new SupportAgent()
  .queue('Help with refund request')
  .broadcast(`user.${userId}.support`)
  .send()
```

Subscribers on the channel receive:

- `{ event: 'chunk', data: <StreamChunk> }` - one per stream chunk (text-delta, tool-call, tool-result, ...)
- `{ event: 'done',  data: <AgentResponse> }` - final result, after the agent loop ends
- `{ event: 'error', data: { message } }` - on failure

The chunk shape matches the engine's normal `StreamChunk` types, so a frontend reuses its existing chunk-handling code. Pass `eventPrefix` to namespace events when the channel carries other traffic.

> **Process model.** `@rudderjs/broadcast` writes to the WS server in the same process. In the typical Rudder dev setup (one process running web + `queue:work`) this works out of the box. Deployments that run the queue worker as a separate process from the broadcast WS server need a pub/sub bridge (Redis, Reverb, etc.).

## Evals

The eval framework (`evalSuite`, metrics, reporters) is the engine's, see [Testing & Evals](https://gemstack-land.github.io/gemstack/packages/ai-sdk/testing). Rudder wraps it in a console command for record/replay and suite discovery:

```bash
pnpm rudder ai:eval
```

## Doctor

`AiProvider` registers an `ai:provider-keys` check, so `pnpm rudder doctor` warns when `config/ai.ts` references a provider whose API key is missing or misconfigured, before you hit it at runtime.

## Pitfalls

- **Bare model names throw.** Models are always `provider/model`. A model string without a registered provider prefix is a configuration error, not a silent default.
- **`MemoryConversationStore` / `MemoryUserMemory` are in-process.** They are the engine defaults for tests and dev; they lose everything on restart and are not shared across workers. Use the ORM-backed stores in production.
- **Queue worker split from the broadcast server.** `.broadcast()` over a separate worker process needs a pub/sub bridge, see the process-model note above.
- **Calling providers from the browser leaks keys.** The engine runs client-side for BYOK desktop apps, but a normal Rudder app should keep provider calls server-side.
