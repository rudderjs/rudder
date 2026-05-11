---
"@rudderjs/ai": minor
---

**B10 — VoyageAI provider for best-in-class embeddings + reranking. Closes Track B.** New `VoyageProvider` implements `EmbeddingAdapter` + `RerankingAdapter` against Voyage's REST API. Raw `fetch` adapter — no SDK peer dep (matches the Jina / ElevenLabs shape). Wired through `AiProvider` via `driver: 'voyage'`.

```ts
// config/ai.ts
import { env } from '@rudderjs/support'

export default {
  default: 'openai/gpt-4o',
  providers: {
    openai: { driver: 'openai', apiKey: env('OPENAI_API_KEY')! },
    voyage: { driver: 'voyage', apiKey: env('VOYAGE_API_KEY')! },
  },
}
```

```ts
// Embeddings (defaults to input_type: 'document' — RAG ingestion)
const { embeddings } = await AI.embed('hello world', { model: 'voyage/voyage-3-large' })

// Reranking
const ranked = await AI.rerank({
  model:     'voyage/rerank-2.5',
  query:     'how do I reset my password?',
  documents: [
    'change account name procedure',
    'reset password procedure',
    'enable two-factor authentication',
  ],
  topK: 5,
})
```

**Models:**

- **Embeddings:** `voyage-3` (general), `voyage-3-large` (best quality), `voyage-code-3` (code), `voyage-finance-2` (finance), `voyage-law-2` (legal).
- **Reranking:** `rerank-2.5` (best), `rerank-2.5-lite`, `rerank-2`.

**Conventions:**

- `VoyageConfig.defaultInputType` defaults to `'document'` — Voyage embeddings perform measurably better when the API knows whether a string is a search **query** or an indexed **document**. Override per-deployment to `'query'` for query-side pipelines.
- Rerank requests forward `topK` → `top_k`; results map `relevance_score` → `relevanceScore`. The adapter prefers Voyage-echoed `document` text when present, otherwise looks up by index in the original input (defensive against API revisions that toggle the echo behavior).
- Embed responses are **defensively sorted by index** before returning — guards against future API revisions that might return out-of-order results.

**Closes Track B.** All of Tracks A and B are shipped. Next forward-looking item is **B8.5** (Gemini hosted RAG) once there's customer signal, or net-new ideas.

**Manual registration alternative** (matches Jina / Cohere precedent):

```ts
import { AiRegistry, VoyageProvider } from '@rudderjs/ai'

AiRegistry.register(new VoyageProvider({
  apiKey: process.env.VOYAGE_API_KEY!,
}))
```
