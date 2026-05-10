# Hosted Vector Stores

`@rudderjs/ai` ships first-class support for hosted vector stores — managed RAG infrastructure where the provider handles ingestion, chunking, embedding, and retrieval server-side. Apps drop in `fileSearch({ stores })` as an agent tool and the model runs the search natively; no embedding pipeline, no pgvector setup, no glue code.

Today only OpenAI implements the hosted-store contract. For self-hosted RAG over a local Postgres + pgvector model, use the `similaritySearch` agent tool — same surface, against an ORM model you own.

## Managing stores

```ts
import { VectorStores } from '@rudderjs/ai'

const store = await VectorStores.create('Knowledge Base')

await store.add({ filePath: './report.pdf', attributes: { author: 'Alice', year: 2026 } })
await store.add({ filePath: './policy.txt' })

const all = await VectorStores.list()
const one = await VectorStores.get(store.id)

await VectorStores.delete(store.id)
```

`store.add(...)` accepts:

- `{ fileId: 'file-...' }` — an existing OpenAI Files API id
- `{ filePath: './foo.pdf' }` — local path; uploaded via the Files API first (`Node` only)
- `{ fileBuffer: Buffer, filename }` — in-memory bytes

By default `add()` polls the provider until indexing is `'completed'` (status `'failed'` / `'cancelled'` throws). Pass `wait: false` for fire-and-forget. `attributes` map to OpenAI's per-file searchable metadata — `fileSearch({ where })` filters on these.

### Provider override

The default provider comes from the registered AI default (`@rudderjs/ai`'s `AiRegistry`). Override per call:

```ts
const store = await VectorStores.create('KB', { provider: 'openai' })
const list  = await VectorStores.list({ provider: 'openai' })
```

## The `fileSearch` agent tool

`fileSearch({ stores })` returns a tool that the model uses to query the configured stores. On OpenAI the adapter emits the native `file_search` block — the model runs retrieval inline and the results land in the assistant reply. No tool-call round-trip, no `execute` to write.

```ts
import { Agent, VectorStores, fileSearch } from '@rudderjs/ai'

const kb = await VectorStores.get('vs_abc123')

class SupportAgent extends Agent {
  instructions() { return 'Answer support questions using the knowledge base.' }
  model() { return 'openai/gpt-4o' }
  tools() {
    return [
      fileSearch({
        stores:     [kb.id],
        where:      { author: 'Alice', year: 2026 },
        maxResults: 10,
      }),
    ]
  }
}

const reply = await new SupportAgent().prompt('What does our policy say about renewals?')
```

### Metadata filters

`where` accepts either the typed OpenAI filter shape or a plain `{ key: value }` object that's lowered to an `and` of `eq` filters:

```ts
// Sugar — two keys lower to an `and`-of-`eq`
fileSearch({ stores: [kb.id], where: { author: 'Alice', year: 2026 } })

// Typed shape — use for gt/lt/or/etc.
fileSearch({
  stores: [kb.id],
  where:  {
    type: 'and',
    filters: [
      { type: 'eq', key: 'author', value: 'Alice' },
      { type: 'gt', key: 'year',   value: 2024    },
    ],
  },
})
```

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, plus the `and` / `or` combinators.

### Customizing the tool surface

```ts
fileSearch({
  stores:      [kb.id],
  name:        'search_docs',                     // default 'file_search'
  description: 'Search the engineering wiki.',    // visible to the model
  maxResults:  20,
})
```

## Testing with `AiFake`

The hosted-OpenAI path runs the search server-side and the result lands in the assistant message — so the simplest fake is a single scripted reply:

```ts
import { AiFake } from '@rudderjs/ai'

const fake = AiFake.fake()
fake.respondWithFileSearchResults({
  hits: [
    { text: 'Policies renew annually.', source: 'policy.pdf', score: 0.92 },
    { text: 'Renewal happens in March.', source: 'renewal.pdf' },
  ],
})

const response = await new SupportAgent().prompt('How do renewals work?')
// response.text contains the formatted hits
```

Pass `text` directly for full control over the assistant reply, or `usage` to thread token counts through budget middleware.

## Provider compatibility

| Provider | Native `file_search` | Notes |
|----------|----------------------|-------|
| OpenAI   | ✓ | Phase 1 shipped — `VectorStores.create/list/get/delete`, `add`, native tool emission via `chat.completions`. |
| Gemini   | future (B8.5) | Gemini's hosted RAG uses `cachedContent`, not vector stores; deferred to B8.5. |
| Others   | falls back | Non-OpenAI providers see `fileSearch` as a regular function-call tool with `{ query: string }`. Without an `execute` the agent loop pauses for client tools — pair with a Phase 3 `fallback` (in flight) to delegate to `similaritySearch` over a local pgvector model. |

## Cost surprise

Hosted vector stores bill per GB/month for storage AND per query. Document your storage tiers and pair with `withBudget` once tool-result tokens land in usage tracking.

## See also

- [AI](./ai) — registering providers, the global `AI.embed()` helper, and the `similaritySearch` agent tool for self-hosted RAG.
- [Computer-use](./computer-use) — sibling agent-tool factory using the same `providerHint` mechanism.
