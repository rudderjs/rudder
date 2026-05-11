---
"@rudderjs/ai": minor
---

**B8 Phase 3 — local pgvector fallback for `fileSearch`. Closes B8.** With the new `fallback` opt configured, the same `fileSearch` tool works on every provider — OpenAI runs the search natively, everyone else delegates to `similaritySearch` against a local pgvector model. Same agent prompt across hosted and self-hosted RAG, no re-prompting needed when ops swap deployment targets.

```ts
import { Agent, fileSearch } from '@rudderjs/ai'
import { Document } from './app/Models/Document.js'

class HybridAgent extends Agent {
  // openai/* — native file_search runs server-side against vs_kb.
  // anthropic/*, gemini/*, etc — similaritySearch runs locally against
  //   the Document model. Same prompt, same tool name, same input schema.
  model() { return 'openai/gpt-4o' }
  tools() {
    return [
      fileSearch({
        stores: ['vs_kb'],
        fallback: {
          model:         Document,
          column:        'embedding',
          embedWith:     'openai/text-embedding-3-small',
          minSimilarity: 0.7,
          limit:         10,
          scope:         q => q.where('tenantId', currentTenant).where('published', true),
        },
      }),
    ]
  }
}
```

**Surface:**

- `FileSearchOptions.fallback?: FileSearchFallback<TInstance>` — accepts every B7 `similaritySearch` knob (`model`, `column`, `embedWith`, `metric`, `minSimilarity`, `limit`, `scope`, `projectResult`). `name` / `description` flow from the outer `fileSearch` so the agent prompt stays identical across providers.
- `FileSearchTool` widened to `Tool<{ query: string }, unknown>` with optional `execute` + `toModelOutput`. Both stay `undefined` when `fallback` is absent (Phase 2 back-compat). When `fallback` is set, both are lifted from an internal `similaritySearch(...)` instance.
- New `FileSearchFallback<TInstance>` type alias exported from `@rudderjs/ai` for apps that want to factor out the fallback config.

**Why no `supportsFileSearch` flag:** the original plan proposed a per-`ProviderFactory` capability check. It turned out unnecessary — the `providerHint` cascade at the adapter level already does the right thing. OpenAI's `toOpenAITools` substitutes the native `file_search` block (model never invokes execute on that path); other providers serialize the tool as a function-call schema (model invokes execute → fallback runs). Simpler, fewer moving parts.

**Compatibility:** strictly additive. Apps already calling `fileSearch({ stores })` see no change — `execute` stays absent, the OpenAI native path is unchanged, and the previously-degraded "client tool" pause on non-OpenAI providers is unchanged unless `fallback` is configured.

**Closes B8.** Gemini hosted `VectorStores` parity stays deferred to B8.5 (Gemini's `cachedContent` shape diverges enough to deserve its own design pass). Next Track B item is **B9** (ElevenLabs provider).
