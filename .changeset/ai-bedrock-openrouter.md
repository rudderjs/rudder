---
'@rudderjs/ai': minor
---

`AWS Bedrock` and `OpenRouter` providers (B4 + B5):

- **`BedrockProvider`** — new `bedrock` driver. Lazy-loaded `@aws-sdk/client-bedrock-runtime` (added as an optional dep). Region from config; AWS credential chain (env vars / IAM roles / `~/.aws/credentials`) by default, explicit `credentials` accepted for multi-account cases. Streams via `InvokeModelWithResponseStreamCommand`; non-streaming via `InvokeModelCommand`. Prompt-caching markers (`cache_control`) work end-to-end through Bedrock-Anthropic.

  v1 supports **Anthropic Claude models on Bedrock** (`anthropic.*` and the regional cross-region inference profiles `us.anthropic.*` / `eu.anthropic.*` / `apac.anthropic.*`). Other model families on Bedrock (Llama, Nova, Cohere on Bedrock, Mistral on Bedrock, AI21) throw at adapter construction with a clear message — they can be added in follow-up PRs when there's customer demand.

  ```ts
  // config/ai.ts
  bedrock: {
    driver: 'bedrock',
    region: process.env.AWS_REGION ?? 'us-east-1',
  }

  // model strings: bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0
  ```

- **`OpenRouterProvider`** — new `openrouter` driver. Wraps `OpenAIAdapter` with `https://openrouter.ai/api/v1` as the base URL — installs no extra SDK (reuses `openai`). Optional `siteUrl` / `siteName` config flow through as `HTTP-Referer` / `X-Title` for OpenRouter's per-app analytics.

  Two-slash model strings parse cleanly thanks to `AiRegistry.parseModelString()` already splitting on the first slash — `openrouter/anthropic/claude-3.5-sonnet` → provider `openrouter`, model `anthropic/claude-3.5-sonnet`.

  ```ts
  // config/ai.ts
  openrouter: {
    driver:   'openrouter',
    apiKey:   process.env.OPENROUTER_API_KEY!,
    siteUrl:  process.env.APP_URL,
    siteName: 'My App',
  }

  // model strings: openrouter/anthropic/claude-3.5-sonnet, openrouter/openai/gpt-4o, etc.
  ```

- Internal: `OpenAIConfig` gains a `defaultHeaders?: Record<string, string>` field (passed through to the OpenAI SDK and the embeddings `fetch` call). OpenRouter is the first consumer; safe to use from any OpenAI-compatible derivative.
- Internal: `splitSystemMessages` / `toAnthropicMessages` / `toAnthropicTools` / `toAnthropicToolChoice` / `fromAnthropicResponse` are now `export`s from `providers/anthropic.ts` so Bedrock can reuse them. Not re-exported from the package's main entry — internal-only.
