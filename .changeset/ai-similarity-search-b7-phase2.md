---
"@rudderjs/ai": minor
"@rudderjs/orm-prisma": minor
---

**B7 Phase 2 — `similaritySearch({ model, column, embedWith })` agent tool + auto-embed lift in `whereVectorSimilarTo`.** Wires Phase 1's pgvector primitives into the agent loop. Models emit a natural-language `query`; the tool embeds it, runs a `whereVectorSimilarTo` search, and returns top-K rows with similarity scores.

```ts
import { Agent } from '@rudderjs/ai'
import { similaritySearch } from '@rudderjs/ai'
import { Document } from './app/Models/Document.js'

class KnowledgeAgent extends Agent {
  tools() {
    return [
      similaritySearch({
        model:         Document,
        column:        'embedding',
        embedWith:     'openai/text-embedding-3-small',
        minSimilarity: 0.7,
        limit:         10,
      }),
    ]
  }
}
```

`@rudderjs/ai`:

- **`similaritySearch({ model, column, embedWith, metric?, minSimilarity?, limit?, name?, description?, projectResult? })`** — exported from the main entry (`@rudderjs/ai`). Returns a `ServerToolBuilder` whose `inputSchema` is `z.object({ query: z.string().min(1) })`. Default tool name: `similarity_search_<model_lowercase>`. `embedWith` is required — fails loud at factory construction if missing, mirroring A6's `assertKnownModelPricing` pattern (no silent default-route to `AiRegistry.getDefault()`).
- **Execute flow:** `query` → `AI.embed(query, { model: embedWith })` → `model.query().whereVectorSimilarTo(column, vector, { metric, minSimilarity }).selectVectorDistance(...).limit(limit).get()` → `{ row, similarity }[]`. The internal distance alias is read off each row at result time and converted to `similarity = 1 - distance` (cosine convention; documented for non-cosine metrics).
- **`toModelOutput`** default formatter: `(0.85) {"id":1,"content":"..."}` per hit, newline-joined, with the internal alias stripped from the JSON. Empty-state returns `"No similar <Model> records found."`. Override via `projectResult: (row, similarity) => string` for custom shapes.

`@rudderjs/orm-prisma`:

- **`whereVectorSimilarTo(column, '<string>', { embedWith })`** no longer throws — auto-embed is **deferred** to terminal time so the chain stays sync. The string + model id get stored on the vector clause and resolved when `.get()` / `.first()` runs by lazy-loading `@rudderjs/ai` via `resolveOptionalPeer('@rudderjs/ai')`. `MissingEmbedderError` still fires when `embedWith` is omitted.
- **`@rudderjs/ai` is a new optional peer** of `@rudderjs/orm-prisma`. Apps that don't do RAG never load AI. `@rudderjs/support` is a new regular dep (for `resolveOptionalPeer`).

**Phase 2 limitations** (lifted in Phase 2.5):

- **Standalone vector queries only.** `similaritySearch` doesn't support a `scope` callback yet — agents see every row in the corpus that matches the vector. Apps needing tenant/user filtering today can pre-fetch IDs in user code and post-filter the result set.
- The chained `.where()` lift on `whereVectorSimilarTo` ships in Phase 2.5 alongside `scope`.

Plan: `docs/plans/2026-05-10-b7-vector-storage.md` (updated to reflect the Phase 2 / 2.5 split).
