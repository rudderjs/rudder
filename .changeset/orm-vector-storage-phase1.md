---
"@rudderjs/contracts": minor
"@rudderjs/orm": minor
"@rudderjs/orm-prisma": minor
"@rudderjs/orm-drizzle": minor
---

**B7 Phase 1 — vector storage foundations + Prisma pgvector adapter.** Foundation for the `similaritySearch()` agent tool (Phase 2) and Drizzle adapter + migration helper (Phase 3). Postgres + pgvector only in v1; Drizzle and non-Postgres connections throw `VectorStorageUnsupportedError`.

```ts
import { Model, vector, type CastDefinition } from '@rudderjs/orm'

class Document extends Model {
  static table = 'document'
  static casts = {
    embedding: vector({ dimensions: 1536 }),
  } as const satisfies Record<string, CastDefinition>

  embedding!: number[]
}

// Standalone vector query (v1 — chaining with .where() lands in Phase 2)
const docs = await Document.query()
  .whereVectorSimilarTo('embedding', queryEmbedding, { minSimilarity: 0.4 })
  .limit(10)
  .get()

// Project the cosine distance as a column for explicit ordering / display
const ranked = await Document.query()
  .whereVectorSimilarTo('embedding', queryEmbedding)
  .selectVectorDistance('embedding', queryEmbedding, 'score')
  .limit(10)
  .get()
```

**`@rudderjs/orm` (new exports):**

- `vector({ dimensions })` cast factory. Returns a `CastUsing` class capturing `dimensions` in its closure. On write: validates the array length matches `dimensions`, validates every element is a finite number, serializes to pgvector text format `'[0.1,0.2,...]'`. On read: parses the text format back to `number[]`. Already-array values pass through (idempotent on roundtrips through caches/serializers).
- `VectorDimensionMismatchError` (`code: 'VECTOR_DIMENSION_MISMATCH'`) — thrown by the cast when a write attempts to persist a wrong-dim vector. Carries `column`, `expected`, `actual`.
- `VectorStorageUnsupportedError` (`code: 'VECTOR_STORAGE_UNSUPPORTED'`) — thrown by adapters that don't support pgvector or are connected to a non-Postgres backend / a Postgres instance without the `vector` extension.
- `MissingEmbedderError` (`code: 'VECTOR_MISSING_EMBEDDER'`) — thrown when `whereVectorSimilarTo(col, 'natural-language string')` is called without `embedWith`. Auto-embed itself lands in Phase 2; the error guards against accidental paid API hits.

**`@rudderjs/contracts` (`QueryBuilder<T>` extensions, both optional):**

- `whereVectorSimilarTo?(column, query, opts?)` — pgvector similarity filter. `query` can be `number[]` (literal embedding) or `string` (auto-embed via `AI.embed()` once Phase 2 lands; throws `MissingEmbedderError` in v1 unless `embedWith` is set, then throws "Phase 2" error). Default metric `'cosine'` (`<=>`); `'l2'` (`<->`) and `'inner-product'` (`<#>`) supported. `minSimilarity` is normalized to cosine `[-1, 1]` (higher = closer) so apps never see raw distance.
- `selectVectorDistance?(column, query, alias)` — projects the cosine distance as a column for ordering / display. `0` = identical, `1 - alias` gives back similarity.

Both optional on the contract — adapters that don't support pgvector simply omit them. Apps that need vector storage on a non-supporting adapter get a clear `Cannot read properties of undefined` typeguard rather than a silent miss.

**`@rudderjs/orm-prisma`** implements both. Uses `prisma.$queryRawUnsafe` to construct the pgvector SQL because Prisma's standard fluent API has no way to express pgvector ops. `_getViaVector` switches the terminal path on `get()` and `first()`; identifiers are double-quoted defensively. pgvector errors (`operator does not exist`, `type "vector" does not exist`, `extension "vector"`) are caught and re-thrown as `VectorStorageUnsupportedError` with a runnable `CREATE EXTENSION` hint.

**v1 limitations** (deliberate, documented — lifted in Phase 2):

- Chaining vector queries with `.where()` / `.orWhere()` / `.whereGroup()` / relation predicates throws — vector queries must be standalone.
- Eager loading via `.with()` alongside vector queries throws.
- `withCount` / aggregates alongside vector queries throws.
- `.orderBy()` alongside vector queries throws (redundant — vector queries order by similarity).
- `.count()` with a vector clause throws.
- Auto-embed (`whereVectorSimilarTo(col, 'string')`) throws — pre-embed via `AI.embed()` and pass `number[]` for now.

**`@rudderjs/orm-drizzle`** ships stub implementations of both methods that throw `VectorStorageUnsupportedError('drizzle', ...)` — Drizzle pgvector support lands in Phase 3 alongside the `pnpm rudder make:migration --vector <table> <column> <dim>` helper.

**Out of this phase, deferred:**

- **Phase 2 — `similaritySearch()` agent tool** in `@rudderjs/ai`. Wraps a Model + column as a drop-in agent tool with auto-embed via `AI.embed()`, configurable result projection, tag-based scoping. Lifts the v1 standalone-query restriction.
- **Phase 3 — Drizzle adapter + migration helper.** Same SQL shape via Drizzle's `sql\`...\`` template; `pnpm rudder make:migration --vector` scaffolds the `CREATE EXTENSION` + `ALTER TABLE` + `CREATE INDEX hnsw` snippets.
- **pgvector-backed `EmbeddingUserMemory`.** A4 Phase 5's per-user memory uses Bytes packing + JS cosine; B7 targets app-scale corpora. Optional rewire after B7 ships if a customer reports recall slowdown.

Plan: `docs/plans/2026-05-10-b7-vector-storage.md`.
