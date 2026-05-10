---
"@rudderjs/ai": minor
---

**A4 Phase 5 — `EmbeddingUserMemory` with cosine recall + GDPR cascade.** Closes out the A4 roadmap item. A new subpath at `@rudderjs/ai/memory-embedding` ships an embedding-backed `UserMemory` that composes Phase 4's `OrmUserMemory` with the registered embedding provider for semantic recall.

- **`EmbeddingUserMemory`** — composes `OrmUserMemory` + `AI.embed()`. `remember()` embeds the fact and writes the Float32-packed vector into the row's `embedding` column (added to the schema in Phase 4 as nullable, populated now). `recall()` embeds the query and ranks the user's facts by **pure-JS cosine similarity**.
- **GDPR right-to-be-forgotten cascades automatically** — the embedding lives in the same row as the fact, so `forget()` / `forgetAll()` delete both. No second store to keep in sync.
- **Backward compat with Phase 4** — rows whose `embedding` is null fall back to token-overlap on `fact` (`nullEmbeddingFallback: 'token-overlap'` default). Upgrading from `OrmUserMemory` to `EmbeddingUserMemory` doesn't lose recall on existing rows; new `remember()` calls populate the column going forward. Override to `'skip'` for strict embedding-only semantics.
- **`UserMemoryRecord.embedding` field added** to the existing class (Phase 4's class deliberately omitted it). `static fillable` extended to allow `embedding` on `Model.update()` calls.
- **Failure swallow** — `embed()` failures (network, missing peer SDK) don't break the parent. `remember()` persists the entry with `embedding === null`; `recall()` falls back to token-overlap.
- **`serializeVector` / `deserializeVector` / `cosineSimilarity` exported** for B7 (pgvector adapter) and any third-party backends. Float32 packing (4 bytes/dim); 1536-dim OpenAI vectors compress to 6144 bytes. `deserializeVector` honors `Uint8Array.byteOffset` for safe sub-views.

```ts
import { OrmUserMemory } from '@rudderjs/ai/memory-orm'
import { EmbeddingUserMemory } from '@rudderjs/ai/memory-embedding'

export default {
  default: 'anthropic/claude-sonnet-4-5',
  providers: { /* ... */ },
  memory: new EmbeddingUserMemory({
    inner: new OrmUserMemory(),
    model: 'openai/text-embedding-3-small',
    threshold: 0.5,
  }),
} satisfies AiConfig
```

20 new tests covering the full lifecycle: `remember` populates the embedding column (and stays null on embed failure), `recall` ranks by cosine + applies threshold + applies tags + applies limit, fallback to token-overlap when query embed fails, fallback for null-embedding rows, `'skip'` mode drops null-embedding rows, `forget` cascades the embedding with the row, `forgetAll` does the same in bulk, `list` delegates unchanged. Plus `serializeVector` / `deserializeVector` / `cosineSimilarity` round-trips and edge cases (1536-dim vector, sliced `Uint8Array`, zero magnitudes, length mismatch).

**A4 roadmap complete.** Phase 1 → Phase 5 all shipped — interface, in-process backend, auto-inject, auto-extract, ORM backend, and embedding backend with GDPR cascade.
