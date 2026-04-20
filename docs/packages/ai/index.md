# AI Engine

`@rudderjs/ai` is a multi-provider AI engine with agents, tools, streaming, middleware, structured output, and conversation memory.

## Installation

```bash
pnpm add @rudderjs/ai
```

Install the provider SDK(s) you need:

```bash
pnpm add @anthropic-ai/sdk   # Anthropic (Claude)
pnpm add openai               # OpenAI, DeepSeek, xAI, Groq, Mistral, Azure, Ollama
pnpm add @google/genai        # Google (Gemini)
```

## Setup

```ts
// config/ai.ts
import { Env } from '@rudderjs/support'

export default {
  default: Env.get('AI_MODEL', 'anthropic/claude-sonnet-4-5'),
  providers: {
    anthropic: { driver: 'anthropic', apiKey: Env.get('ANTHROPIC_API_KEY', '') },
    openai:    { driver: 'openai',    apiKey: Env.get('OPENAI_API_KEY', '') },
    google:    { driver: 'google',    apiKey: Env.get('GOOGLE_AI_API_KEY', '') },
    ollama:    { driver: 'ollama',    baseUrl: Env.get('OLLAMA_BASE_URL', 'http://localhost:11434') },
    groq:      { driver: 'groq',      apiKey: Env.get('GROQ_API_KEY', '') },
    deepseek:  { driver: 'deepseek',  apiKey: Env.get('DEEPSEEK_API_KEY', '') },
    xai:       { driver: 'xai',       apiKey: Env.get('XAI_API_KEY', '') },
    mistral:   { driver: 'mistral',   apiKey: Env.get('MISTRAL_API_KEY', '') },
  },
}
```

Register the provider:

```ts
// bootstrap/providers.ts
import { ai } from '@rudderjs/ai'
import configs from '../config/index.js'

export default [ai(configs.ai), ...]
```

## Providers

| Provider | SDK | Model String | Capabilities |
|---|---|---|---|
| Anthropic | `@anthropic-ai/sdk` | `anthropic/claude-sonnet-4-5` | text, files |
| OpenAI | `openai` | `openai/gpt-4o` | text, embeddings, images, tts/stt, files |
| Google | `@google/genai` | `google/gemini-2.5-pro` | text, embeddings, images, files |
| Cohere | `cohere-ai` | `cohere/rerank-v3.5` | embeddings, reranking |
| Jina | *(none — HTTP)* | `jina/jina-reranker-v2-base-multilingual` | embeddings, reranking |
| Ollama | *(none)* | `ollama/llama3` | text |
| Groq | *(none)* | `groq/llama-3.3-70b` | text |
| DeepSeek | *(none)* | `deepseek/deepseek-chat` | text |
| xAI (Grok) | *(none)* | `xai/grok-3` | text |
| Mistral | *(none)* | `mistral/mistral-large-latest` | text, embeddings |
| Azure OpenAI | `openai` | `azure/gpt-4o` | text |

Provider SDKs are optional dependencies — install only what you use. OpenAI-compatible providers (Groq, DeepSeek, xAI, Mistral, Azure, Ollama) reuse the `openai` SDK under the hood. Cohere requires `cohere-ai`; Jina uses direct HTTP (no SDK). All adapters lazy-load their SDK on first use.

## Modalities

Beyond text chat, `@rudderjs/ai` covers every major generative modality. See the individual sub-pages for details:

- **[Agents](./agents)** — `Agent` class, anonymous `agent()`, the `AI` facade
- **[Tools](./tools)** — server tools, client tools, `.modelOutput()`, streaming tools, approval gates
- **[Streaming](./streaming)** — `.stream()` + Vercel AI Protocol adapter
- **[Middleware & Testing](./middleware)** — lifecycle hooks, `AiFake` stub adapter

Additional APIs covered in the [package README](https://github.com/rudderjs/rudder/tree/main/packages/ai):

- **Image generation** — `AI.image(prompt).model('openai/dall-e-3').generate()`
- **Text-to-speech** — `AI.audio(text).voice('nova').generate()`
- **Speech-to-text** — `AI.transcribe('./audio.mp3').generate()`
- **Embeddings** — `AI.embed(text)` (single or batch; auto-chunks arrays > 100)
- **Reranking** — `AI.rerank(query, docs).topK(5).rank()` (Cohere, Jina)
- **File management** — `AI.files('openai').upload(...)` (OpenAI, Anthropic, Google)
- **Provider tools** — `WebSearch.make().toTool()`, `WebFetch.make().toTool()`
- **Failover** — `failover()` returning fallback `provider/model` strings
- **Conversations** — `ConversationStore` + `setConversationStore()` for multi-turn memory

## Attachments

Send files and images with your prompts:

```ts
import { Document, Image } from '@rudderjs/ai'

const doc = await Document.fromPath('./report.pdf')
const img = await Image.fromUrl('https://example.com/chart.png')

const response = await agent.prompt('Summarize this report', {
  attachments: [doc.toAttachment(), img.toAttachment()],
})
```

| Method | Description |
|---|---|
| `Document.fromPath(path)` | Local file (auto-detects MIME) |
| `Document.fromUrl(url)` | Fetch from URL |
| `Document.fromString(text, name?)` | Raw text content |
| `Document.fromBase64(data, mime)` | Base64 string |
| `Image.fromPath(path)` | Local image file |
| `Image.fromUrl(url)` | Fetch image from URL |
| `Image.fromBase64(data, mime)` | Base64 image string |

## Conversations

Persist agent conversations across requests:

```ts
import { setConversationStore, MemoryConversationStore } from '@rudderjs/ai'

// Register a store (or pass in ai config)
setConversationStore(new MemoryConversationStore())

// Start a conversation
const response = await agent.forUser('user-123').prompt('What is TypeScript?')
// response.conversationId → 'abc-123'

// Continue the conversation (history auto-loaded)
const followUp = await agent.continue('abc-123').prompt('How does it compare to JS?')
```

Or configure via the `ai()` provider:

```ts
ai({
  default: 'anthropic/claude-sonnet-4-5',
  providers: { ... },
  conversations: new MemoryConversationStore(),
})
```

## Queue Integration

Run AI prompts in the background via `@rudderjs/queue`:

```ts
await agent.queue('Analyze this report')
  .onQueue('ai')
  .then(response => sendNotification(response.text))
  .catch(err => console.error(err))
  .send()
```

Requires `@rudderjs/queue` to be installed and a queue adapter registered.
