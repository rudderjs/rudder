# AI Engine

`@boostkit/ai` is a multi-provider AI engine with agents, tools, streaming, middleware, structured output, and conversation memory.

## Installation

```bash
pnpm add @boostkit/ai
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
import { Env } from '@boostkit/support'

export default {
  default: Env.get('AI_MODEL', 'anthropic/claude-sonnet-4-5'),
  providers: {
    anthropic: { driver: 'anthropic', apiKey: Env.get('ANTHROPIC_API_KEY', '') },
    openai:    { driver: 'openai',    apiKey: Env.get('OPENAI_API_KEY', '') },
    google:    { driver: 'google',    apiKey: Env.get('GOOGLE_AI_API_KEY', '') },
    ollama:    { driver: 'ollama',    baseUrl: Env.get('OLLAMA_BASE_URL', 'http://localhost:11434') },
  },
}
```

Register the provider:

```ts
// bootstrap/providers.ts
import { ai } from '@boostkit/ai'
import configs from '../config/index.js'

export default [ai(configs.ai), ...]
```

## Providers

| Provider | SDK | Model String |
|---|---|---|
| Anthropic | `@anthropic-ai/sdk` | `anthropic/claude-sonnet-4-5` |
| OpenAI | `openai` | `openai/gpt-4o` |
| Google | `@google/genai` | `google/gemini-2.5-pro` |
| Ollama | *(none)* | `ollama/llama3` |

Provider SDKs are optional dependencies — install only what you use. All adapters lazy-load their SDK on first use.
