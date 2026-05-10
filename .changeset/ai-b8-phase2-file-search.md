---
"@rudderjs/ai": minor
---

**B8 Phase 2 — `fileSearch` agent tool + OpenAI native `file_search` emission.** Adds the agent-side surface to the hosted vector stores shipped in B8 Phase 1. Closes the agent loop end-to-end on OpenAI: the model invokes `file_search` natively against your configured stores; no `execute` to write, no embedding pipeline, no tool round-trip.

```ts
import { Agent, VectorStores, fileSearch } from '@rudderjs/ai'

const kb = await VectorStores.get('vs_abc123')

class SupportAgent extends Agent {
  model() { return 'openai/gpt-4o' }
  tools() {
    return [
      fileSearch({
        stores:     [kb.id],
        where:      { author: 'Alice', year: 2026 },   // server-side metadata filter
        maxResults: 10,
      }),
    ]
  }
}
```

**Surface:**

- `fileSearch({ stores, where?, maxResults?, name?, description? })` returns a `FileSearchTool` tagged with `providerHint: { type: 'file-search', vector_store_ids, filters?, max_num_results? }`. Symbol marker `FILE_SEARCH_MARKER` + `isFileSearchTool(t)` typeguard.
- `where` accepts the sugar `{ key: value }` form (lowered to an `and` of `eq` filters) or the typed `{ type: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'and' | 'or', ... }` shape directly. `normalizeWhere` is exported for advanced use.
- `toOpenAITools` recognizes `providerHint?.type === 'file-search'` and emits OpenAI's native `{ type: 'file_search', vector_store_ids, filters, max_num_results }` block instead of a function-call shape. Mirrors A7 Phase 2's Anthropic-side substitution.
- `AiFake.respondWithFileSearchResults({ text? | hits?, usage? })` stubs a single-step assistant reply for tests — the hosted path produces the answer directly so no tool round-trip is needed.

**Latent bug fix bundled in:** `toolToSchema()` now propagates `definition.providerHint` onto the emitted `ToolDefinitionSchema`. Computer-use's provider hint already lived on the instance `toSchema()` method but never reached `toAnthropicTools` through the agent loop — so the native `computer_20250124` block was silently absent from real agent runs. The hint now flows correctly through both the file-search and computer-use paths. `ToolDefinitionOptions.providerHint?` is the new typed slot for tools that need adapter-native serialization.

**Compatibility:**

- OpenAI on `chat.completions` — native block. Phase 1 + 2 close the OpenAI RAG story.
- Gemini — deferred to B8.5 (RAG surface uses `cachedContent`; design diverges enough to deserve its own pass).
- Other providers — see `fileSearch` as a normal function-call tool with the placeholder `{ query: string }` schema. Without an `execute` they pause for client tools; Phase 3 will add a `fallback` opt that delegates to `similaritySearch` over a local pgvector model.

Docs: new `docs/guide/vector-stores.md` covers both Phase 1 (CRUD) and Phase 2 (agent tool). Added under the AI sidebar.
