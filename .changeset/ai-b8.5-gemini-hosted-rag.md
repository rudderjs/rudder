---
"@rudderjs/ai": minor
---

**B8.5 — Gemini hosted RAG (`fileSearchStores`).** The `VectorStores` façade and `fileSearch` agent tool now work against Gemini, matching the OpenAI surface 1:1. Same code, different provider.

```ts
import { VectorStores, fileSearch, Agent } from '@rudderjs/ai'

const kb = await VectorStores.create('Knowledge Base', { provider: 'google' })
await kb.add({ filePath: './report.pdf', attributes: { author: 'Alice', year: 2026 } })

class SupportAgent extends Agent {
  model() { return 'google/gemini-2.5-flash' }
  tools() {
    return [
      fileSearch({
        stores:     [kb.id],                        // 'fileSearchStores/foo-bar'
        where:      { author: 'Alice', year: 2026 },
        maxResults: 10,
      }),
    ]
  }
}
```

**What's new:**

- `GoogleVectorStoreAdapter` wraps Google's `fileSearchStores` API. CRUD (`create`/`list`/`get`/`delete`), ingestion via `uploadToFileSearchStore` (local path/Blob) or `importFile` (existing Files API id). Both paths return LROs polled to completion via `client.operations.get`. Failed ingestion surfaces as `{ status: 'failed', lastError }` without throwing.
- `toGeminiTools` recognizes `providerHint.type === 'file-search'` and emits the native `{ fileSearch: { fileSearchStoreNames, metadataFilter?, topK? } }` tool block (same `providerHint` mechanism A7 and B8 established).
- Typed `FileSearchFilter` (`{ type: 'eq', key, value }` etc.) translates to Gemini's `metadataFilter` string syntax (`(author = "Alice") AND (year > 2020)`) at the adapter layer. The user-facing API is unchanged.
- Per-document `attributes` map to Gemini's `CustomMetadata[]` shape. Strings → `stringValue`, numbers → `numericValue`, booleans → `stringValue: 'true' | 'false'` (Gemini has no boolean variant; string is lossless and filter-matchable).

**Provider differences (Gemini vs OpenAI):**

- Store ids are full resource paths (`fileSearchStores/foo-bar`), not opaque (`vs_abc123`).
- Store-level `metadata` and `expiresAfter` aren't supported by Gemini — passing either throws fail-loud. Use per-document `attributes` instead.
- Gemini's `fileSearchStores` is **Developer API only** — not available on Vertex AI.

**Closes B8.5.** All of Tracks A and B (including B8.5) are shipped. See `docs/plans/2026-05-11-b8.5-gemini-hosted-rag.md`.
