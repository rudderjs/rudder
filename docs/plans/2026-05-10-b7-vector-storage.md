# B7 — Vector storage in `@rudderjs/orm` + `similaritySearch` tool

**Status:** Phase 1 ✓ (#374), Phase 2 ✓ (#375), Phase 2.5 ✓ (#376); Phase 3 in flight on `feat-b7-drizzle-and-migration`.
**Date:** 2026-05-10
**Roadmap item:** B7 in `docs/plans/2026-05-09-ai-roadmap.md`
**Effort:** ~1 week, 4 PR-sized phases (3 → 4 after Phase 2/2.5 split).

## Phase status

| Phase | What ships | PR | State |
|---|---|---|---|
| 1   | `vector()` cast + `whereVectorSimilarTo()` / `selectVectorDistance()` query builder helpers — **Prisma + pgvector only** | #374 | ✓ shipped |
| 2   | `similaritySearch({ model, column, embedWith, ... })` agent tool factory in `@rudderjs/ai`; auto-embed in `whereVectorSimilarTo` (string `query` + `embedWith`) lifted in `@rudderjs/orm-prisma` via lazy `@rudderjs/ai` optional peer | #375 | ✓ shipped |
| 2.5 | Lift the standalone-query restriction on `whereVectorSimilarTo` — flat `.where()` / `.orWhere()` chains compose into the vector SQL with positional params; `scope: (q) => q` callback added to `similaritySearch` | #376 | ✓ shipped |
| 3   | Drizzle pgvector adapter (mirrors orm-prisma's surface incl. Phase 2.5 chain composition); `make:migration --vector <table> <column> <dim>` helper extends the existing `make:migration` command | — | in flight |

After Phase 3, B7 is **complete**. Next Track B parity item is **B8 (hosted vector stores + `FileSearch` provider tool)** — wraps OpenAI/Gemini hosted stores. B7 must land first because B8's local-fallback path will reuse B7's primitives.

### Phase 2 / 2.5 split — why

The original Phase 2 in this plan bundled three things into one PR: the `similaritySearch` tool, auto-embed in `whereVectorSimilarTo`, and lifting the standalone-query restriction so a `scope` callback could attach `.where()` clauses ahead of the vector clause. Composing arbitrary chained where-clauses with a raw-SQL pgvector query means re-implementing where-serialization to SQL fragments — non-trivial and worth its own design pass.

Phase 2 ships the agent-facing surface customers actually ask for: `similaritySearch` + auto-embed. Phase 2.5 follows with the chaining lift and the `scope` callback. Intermediate state: agents can do RAG over an entire corpus today; tenant/user filtering ships in the next PR. Apps needing scoping in the meantime can pre-fetch IDs in user code and post-filter the `similaritySearch` results.

## Problem

Every RAG app today rolls its own pgvector glue:

- Manually run the `CREATE EXTENSION vector` migration
- Hand-write `prisma.$queryRaw` for `<->` / `<=>` similarity queries
- Build their own agent tool that wraps "embed query → search → return rows"

Laravel ships this as first-class: `Schema::vector('col', dimensions: 1536)`, `whereVectorSimilarTo`, `selectVectorDistance`, plus `SimilaritySearch::usingModel(Model::class, 'col')` as a drop-in agent tool.

This is a real Laravel parity gap. Customers hit it the moment they reach for RAG.

## Surface

```ts
// 1. Schema (Prisma)
model Document {
  id        Int      @id @default(autoincrement())
  content   String
  embedding Unsupported("vector(1536)")?

  @@index([embedding(ops: VectorCosineOps)], type: Hnsw)
}

// 2. Model
class Document extends Model {
  static table = 'document'
  static casts = {
    embedding: vector({ dimensions: 1536 }),
  }
}

// 3. Query — manual embedding
const docs = await Document
  .whereVectorSimilarTo('embedding', queryEmbedding, { minSimilarity: 0.4 })
  .limit(10)
  .get()

// 4. Query — auto-embed (calls AI.embed() under the hood)
const docs = await Document
  .whereVectorSimilarTo('embedding', 'how do I reset my password?', {
    minSimilarity: 0.4,
    embedWith:     'openai/text-embedding-3-small',
  })
  .limit(10)
  .get()

// 5. Drop-in agent tool (lives in @rudderjs/ai, depends on @rudderjs/orm)
import { similaritySearch } from '@rudderjs/ai'

class KnowledgeAgent extends Agent {
  tools() {
    return [
      similaritySearch({
        model:         Document,
        column:        'embedding',
        minSimilarity: 0.7,
        limit:         10,
        scope:         (q) => q.where('published', true),
      }),
    ]
  }
}
```

## Why two layers (ORM primitives + AI tool)

Same split as A4: data plane vs agent plane.

- **`@rudderjs/orm`** owns the storage layer: column type, cast, query builder helpers, adapter (Prisma/Drizzle) wiring. Apps can use this directly without `@rudderjs/ai` (analytics dashboards, batch jobs, custom RAG pipelines).
- **`@rudderjs/ai`** owns the agent tool: `similaritySearch()` factory that wraps a Model + column into an `AgentTool`. Auto-embed via `AI.embed()`, tag-based `scope()` for tenancy, configurable result projection.

Pulling the tool into `@rudderjs/ai` keeps `@rudderjs/orm` AI-agnostic — same boundary that lets `OrmUserMemory` live in `@rudderjs/ai/memory-orm` while the underlying `Model` machinery is pure ORM.

## Why pgvector (not Bytes packing like A4 Phase 5)

A4's `EmbeddingUserMemory` stores Float32-packed vectors in a `Bytes?` column and does **pure-JS cosine over the user's full row set**. That's fine for "a few thousand facts per user" — the per-user shard keeps the scan small.

B7 targets **app-scale knowledge bases** — millions of rows, single shared corpus, latency-sensitive. Pure-JS cosine over a million rows is unworkable; we need an index that lives in the database. pgvector is the standard:

- HNSW index → millisecond ANN over ~10M rows
- Cosine, L2, inner-product distance operators (`<=>`, `<->`, `<#>`)
- Wide adoption, Postgres-native, well-maintained

A4 stays as-is — different problem, different storage. The roadmap doc note "B7 lands a pgvector-backed `EmbeddingUserMemory` that pushes the dot-product into the database" is a follow-up after B7 phase 1 ships: rewire `OrmUserMemory`'s embedding column to optionally use pgvector for installations that have it. **Not scoped into B7's three phases** — file as a future plan if we pick it up.

## Design decisions to lock in before phase 2

These are the questions that, if punted, force a rewrite later:

1. **Postgres-only in v1 — fail loud on other connections.** SQLite and MySQL <8.0 have no vector type; MySQL 8.0+ has VECTOR but the syntax differs enough that a single SQL helper can't cover both. The `vector()` cast throws `VectorStorageUnsupportedError` at first use against a non-Postgres adapter. Document loudly in the JSDoc + a `pitfalls` section.
2. **`vector()` is a cast, not a new column abstraction.** Apps still declare the column as `Unsupported("vector(N)")` in their Prisma schema and run migrations themselves. The cast handles serialization (number[] ⇄ pgvector text format). A migration helper in phase 3 generates the `Unsupported(...)` snippet + index. Going further (a fully-typed Prisma `vector(N)` column) requires a Prisma generator plugin and is out of scope.
3. **`whereVectorSimilarTo(column, query, opts)` accepts `number[]` OR `string`.** String form auto-embeds via `AI.embed()` — see decision 4. Vector form is the literal embedding (number[]). Single name, two semantics, decided by argument type.
4. **Auto-embed is opt-in via `embedWith`.** Passing a string without `embedWith` throws `MissingEmbedderError` — apps shouldn't accidentally hit a paid embeddings API by typo. The error message names the model id to add. Mirrors A6's "fail loud on unknown model pricing" pattern.
5. **Distance operator choice.** Default `cosine` (`<=>`); accept `'cosine' | 'l2' | 'inner-product'` opt. Cosine is the right default for embeddings — magnitude varies with model + content length, direction encodes meaning. Document the trade-offs.
6. **`minSimilarity` semantics: cosine in `[-1, 1]`, higher = closer.** pgvector returns *distance* (`1 - cosine_similarity`), so the SQL is `WHERE 1 - (embedding <=> :query) >= :minSimilarity`. Pre-cast normalize to similarity at the query builder layer so apps never see distance — just one number with a clear direction.
7. **`selectVectorDistance(column, query, alias)`** projects the cosine **distance** (not similarity) as a column for explicit ordering. `whereVectorSimilarTo` already implies an `ORDER BY distance ASC LIMIT N`; `selectVectorDistance` is for users who need the score in their result set.
8. **Tag-based scoping is a regular `where()` chain.** Not a new API. Phase 2's `similaritySearch({ scope })` accepts a `(qb) => qb` callback that runs before the vector clause — same pattern as Laravel's `whereVectorSimilarTo(...)->where(...)`.
9. **Agent tool result shape.** `similaritySearch` returns `{ results: Array<{ row: Model, similarity: number }> }`. The tool's `toModelOutput` projects `row.toJSON()` keys + similarity into a compact text representation so the model doesn't get the full (potentially huge) row JSON in its context. Apps can override `projectResult: (row, sim) => string` for custom shapes.

## Phases

Each phase is one PR. Order matters — phase 2's `similaritySearch` depends on phase 1's `whereVectorSimilarTo`.

### Phase 1 — ORM vector primitives (Prisma + pgvector)

- `packages/orm/src/cast.ts` adds a `vector` built-in cast accepting `{ dimensions: number }`. Serializes `number[]` ⇄ pgvector text format (`'[0.1,0.2,...]'`) on read/write.
- `packages/contracts/src/query-builder.ts` (new methods on the `QueryBuilder` interface):
  - `whereVectorSimilarTo(column: string, query: number[] | string, opts: { minSimilarity?: number; metric?: 'cosine' | 'l2' | 'inner-product'; embedWith?: string }): this`
  - `selectVectorDistance(column: string, query: number[], alias: string): this`
- `packages/orm-prisma/src/index.ts` implements both:
  - Builds a `prisma.$queryRaw` chain for the vector clause.
  - Detects auto-embed (string `query`); throws `MissingEmbedderError` if `embedWith` not set.
  - Throws `VectorStorageUnsupportedError` if the underlying database isn't Postgres (introspect via `prisma._engineConfig.activeProvider`).
  - HNSW index hint (`SET hnsw.ef_search = N`) configurable via opt; default `40`.
- `packages/orm-drizzle/src/index.ts` — stub that throws `VectorStorageUnsupportedError` until phase 3 implements it. Tests assert the throw + helpful error message.
- New error classes: `VectorStorageUnsupportedError`, `MissingEmbedderError`, `VectorDimensionMismatchError` (thrown when `cast(dimensions: 1536)` row gets a 768-dim vector at write time).
- **Tests:** in-memory pgvector via [`pgvector-node`](https://github.com/pgvector/pgvector-node)'s test helper OR a docker postgres in CI; serialize round-trip; cosine query against a 100-row fixture; dimension mismatch error; auto-embed without `embedWith` error; non-Postgres error.

### Phase 2 — `similaritySearch()` agent tool + auto-embed lift

Locked decisions before phase 2 started (recorded in `project_ai_roadmap_pickup` memory; mirrored here for traceability):

1. **Export from `@rudderjs/ai` main entry.** Flat `import { similaritySearch } from '@rudderjs/ai'`. Sits next to `tool()` / `agent()` / `handoff()`. The runtime never imports `@rudderjs/orm` — types only.
2. **`@rudderjs/orm-prisma` reaches `@rudderjs/ai` via lazy optional peer.** New direction in the dep graph (orm → ai); resolved at terminal time via `resolveOptionalPeer('@rudderjs/ai')` from `@rudderjs/support`. orm-prisma adds a `peerDependenciesMeta.@rudderjs/ai.optional = true` entry. Apps that don't do RAG never load AI.
3. **`scope` callback deferred to Phase 2.5.** The standalone-query restriction stays intact in Phase 2.

Surface:

- `packages/ai/src/similarity-search.ts` exports `similaritySearch({ model, column, embedWith, minSimilarity?, limit?, metric?, name?, description?, projectResult? })` returning a `Tool` (a `ServerToolBuilder`).
- `embedWith` is **required** — fail loud at factory construction if missing. Mirrors A6 / `assertKnownModelPricing`'s "fail loud on unknown model" pattern. No silent default-route to whichever provider happens to be `AiRegistry.getDefault()`.
- Tool name defaults to `similarity_search_<model.name.toLowerCase()>`; description mentions the model name. Both overridable.
- The tool's `inputSchema` is `z.object({ query: z.string().min(1) })` — model emits a natural-language query, the tool embeds + searches.
- Execute flow:
  1. `query` → `AI.embed(query, { model: embedWith })` → vector
  2. `model.query().whereVectorSimilarTo(column, vector, { metric, minSimilarity }).selectVectorDistance(column, vector, '<internal alias>').limit(limit).get()`
  3. Read distance from each row at the internal alias; map to `{ row, similarity: 1 - distance }` shape (cosine convention; documented for non-cosine metrics).
- `toModelOutput`: default formatter renders `(0.85) {json}` per hit, newline-joined (the JS shape is `results.map(({ row, similarity }) => format(similarity, row.toJSON())).join('\n')`). Empty-state returns `"No similar <ModelName> records found."`. Override via `projectResult`.

`@rudderjs/orm-prisma` changes:

- `whereVectorSimilarTo` no longer throws for `(string query, embedWith set)` — instead, it stores `{ pendingEmbed: { text, embedWith } }` on the vector clause and **defers** resolution to terminal time so the chain stays sync. `MissingEmbedderError` still fires when `embedWith` is omitted.
- `_getViaVector` resolves the deferred embed via `resolveOptionalPeer<{ AI }>('@rudderjs/ai')` then `AI.embed(text, { model: embedWith })`. Resolution failures surface a guided message ("Run `pnpm add @rudderjs/ai`, or pre-embed and pass number[] instead").
- `package.json` adds `@rudderjs/support` as a regular dep and `@rudderjs/ai` as an optional peer.

**Tests:**

- `packages/ai/src/similarity-search.test.ts` — factory validation (missing `embedWith` / `column` / `model`, invalid `limit`); tool definition (default + custom name/description, empty-query rejection); execute path with `AiFake` (vector forwarded to QB, metric/minSimilarity forwarded, distance alias projected, default-limit-10, similarity = 1-distance, empty embedding error, missing-vector-method error); modelOutput projection (default formatter, custom `projectResult`, empty-state message, internal alias stripped, `toJSON()` honored).
- `packages/orm-prisma/src/vector.test.ts` — replaced the "throws Phase 2" assertion with two tests: synchronous chain accepts string + `embedWith`, terminal call surfaces a clear `@rudderjs/ai`-mentioning error.

### Phase 2.5 — Lift the standalone-query restriction + `scope` callback

`@rudderjs/orm-prisma`:

- `_getViaVector` composes chained `_wheres` / `_orWheres` into the vector SQL via a new `clauseToSql(clause, params[])` helper that emits `"col" op $N` fragments and binds values positionally to `$queryRawUnsafe(sql, ...params)`. Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`. `null` values on `=`/`!=` translate to `IS NULL` / `IS NOT NULL`. Empty `IN` short-circuits to `FALSE`; empty `NOT IN` to `TRUE`.
- `_resolveDeferred()` runs first so polymorphic / pivot relation predicates flow through as flat `IN` / `NOT IN` clauses on `_wheres` — they compose transparently.
- Soft-delete scoping (`withTrashed` / `onlyTrashed`) flows into the SQL alongside user wheres.
- Vector min-similarity stays inlined (numeric, safe). User-supplied values bind positionally — defense-in-depth test asserts `'; DROP TABLE documents; --` payload never appears in the SQL string.
- **Still throws (out of scope for 2.5):** `.with()` (eager load), `whereGroup` / `orWhereGroup` (sub-builders pre-flatten to Prisma filter objects so the original `WhereClause[]` is lost), direct `whereHas` / `whereDoesntHave` (Prisma `some`/`none` filters don't have a flat SQL form), aggregates, redundant `.orderBy()`. Documented in the throw messages.

`@rudderjs/ai`:

- `similaritySearch({ ..., scope })` accepts an optional `(q: SimilaritySearchQueryBuilder<T>) => SimilaritySearchQueryBuilder<T>` callback. `scope(model.query())` runs before `whereVectorSimilarTo` attaches.
- `SimilaritySearchQueryBuilder<T>` widened with `where(col, op?, val)` / `orWhere(...)` / `withTrashed?()` / `onlyTrashed?()` overloads so the scope callback gets autocomplete on the methods that actually compose. Mirrors `@rudderjs/contracts`'s `QueryBuilder<T>` subset; main entry stays free of contracts runtime dep.
- New exported alias `SimilaritySearchWhereOperator` mirrors contracts' `WhereOperator` for typing scope arguments without importing `@rudderjs/contracts`.

`@rudderjs/contracts`:

- JSDoc on `whereVectorSimilarTo` updated: "Chained `.where()` / `.orWhere()` clauses compose into the SQL (Phase 2.5) — flat predicates work; `whereGroup` and direct `whereHas` still throw."

**Tests:**

- `packages/orm-prisma/src/vector.test.ts` — replaced the v1-restriction throw assertion for `.where()` chains with 11 new tests covering: single `.where()`, minSim + where AND-joined, all six comparison operators in one chain, `IS NULL` / `IS NOT NULL` (no binding), `IN` with positional params, empty `IN` → `FALSE`, empty `NOT IN` → `TRUE`, `LIKE`, `.orWhere()` parenthesized OR block, defense-in-depth SQL injection check. The remaining throws (`.with()`, `.orderBy()`, `whereGroup`, `count()`) keep their existing tests.
- `packages/ai/src/similarity-search.test.ts` — 5 new tests under `'similaritySearch — scope callback'`: scope applies before vector clause, WhereOperator overload forwards through scope, `.orWhere()` works, no-scope keeps Phase 2 behavior, identity scope `(q) => q` works.

**Recall preserved.** Because the chain pre-filters in SQL, there's no over-fetching trick — `LIMIT N` returns the top-K rows that match BOTH the vector neighbourhood and the scope predicate.

### Phase 3 — Drizzle adapter + migration helper

`@rudderjs/orm-drizzle`:

- `whereVectorSimilarTo` + `selectVectorDistance` mirror the orm-prisma surface: stash on `_vectorClause` / `_selectVectorDist`, defer string-query auto-embed via `pendingEmbed`. `MissingEmbedderError` still fires when a string `query` is passed without `embedWith`.
- `_getViaVector` terminal path routes through Drizzle's `db.execute()` with a tagged-template SQL literal (`SELECT ... ORDER BY col op vec::vector`), because Drizzle's fluent select API can't express pgvector ops. Composes the WHERE chain by reusing the existing `buildConditions()` so flat `.where()` / `.orWhere()` / soft-delete / `whereRelationExists`-EXISTS subqueries (Phase 2.5 parity) all flow into the SQL alongside the vector clause.
- Vector literal serialized to pgvector text (`'[0.1,0.2,...]'`) and bound through Drizzle's `sql` template — Drizzle handles parameter binding so user values (where-chain RHS, `minSimilarity`, `limit`, the vector itself) never get string-interpolated. Operators come from a closed allow-list and use `sql.raw` safely. Defense-in-depth SQL-injection test asserts a payload like `'; DROP TABLE documents; --` travels through bind params, not through the SQL string.
- `db.execute()` missing on the driver → `VectorStorageUnsupportedError` with hint to use a Postgres driver. Unknown column on the registered table → same error class with the column name. pgvector extension/operator missing → wrapped with the `CREATE EXTENSION` guidance message (matches orm-prisma).
- `@rudderjs/support` added as a regular dep, `@rudderjs/ai` as an optional peer (mirrors orm-prisma's wiring). The `resolveAutoEmbed` helper is a near-copy of orm-prisma's.

`@rudderjs/orm`:

- Extends the existing `make:migration` command with a `--vector <table> <column> <dim>` short-circuit (no new subpath needed — the helpers live in `commands/migrate.ts`). Conservative SQL identifier check on table + column rejects anything with non-alphanumeric chars; dimensions must be a positive integer.
- Generates an ORM-detected migration file: Prisma → `prisma/migrations/<ts>_add_<col>_vector_to_<table>/migration.sql`; Drizzle → `drizzle/<ts>_add_<col>_vector_to_<table>.sql`. SQL contains `CREATE EXTENSION IF NOT EXISTS vector;`, `ALTER TABLE ... ADD COLUMN ... vector(N);`, and a `CREATE INDEX ... USING hnsw (... vector_cosine_ops)` (or `vector_l2_ops` / `vector_ip_ops` if `--metric` overrides).
- Prisma projects also get a printed schema snippet showing the `Unsupported("vector(N)")` column + `@@index([col(ops: VectorCosineOps)], type: Hnsw)` declaration to add to `schema.prisma`, plus a reminder to enable the `postgresqlExtensions` preview feature.
- Exports `buildVectorMigrationSql`, `buildPrismaSchemaSnippet`, `parseVectorFlag`, `writeVectorMigration` for testing and for apps that want to compose the SQL into a hand-rolled migration.

**Tests:**

- `packages/orm-drizzle/src/vector.test.ts` — 21 tests mirroring orm-prisma's vector test suite: SQL shape (cosine default, l2/inner-product op variants, default LIMIT 100), `selectVectorDistance` projection, `first()` unwrap + null, chained `.where()` composition (single + multi-operator + IN), defense-in-depth SQL injection check, still-unsupported throws (`.orderBy()`, `.count()`), auto-embed defer (sync chain accepts string + `embedWith`), terminal AI-mention error, `pgvector missing` → `VectorStorageUnsupportedError`, unknown column → same, driver without `db.execute` → same. Uses real `pgTable` + `PgDialect.sqlToQuery` to render the captured SQL for assertion.
- `packages/orm/src/commands/migrate.test.ts` — 22 new tests covering `buildVectorMigrationSql` (cosine/l2/inner-product, identifier/dimension validation), `buildPrismaSchemaSnippet`, `parseVectorFlag` (positional args + `--metric`, missing args, invalid types), and `writeVectorMigration` (Prisma vs Drizzle layout, fallback when no ORM detected, Prisma-only schema snippet, explicit `opts.orm` override).

## Out of scope (file as future plans if picked up)

- **pgvector-backed `EmbeddingUserMemory`.** Rewire A4 Phase 5's storage to optionally push cosine into Postgres for installations with pgvector. ~3 days; punt until a customer reports a recall slowdown.
- **MySQL 8.0+ `VECTOR` adapter.** MySQL syntax diverges enough that the single helper signature can't cover both. Add as `pgvector | mysqlVector` adapter discrimination later if customer demand shows up.
- **HNSW index tuning rituals.** Documenting `SET hnsw.ef_search`, `lists` for IVFFlat, etc. Out-of-band — link to pgvector docs in the JSDoc.
- **Hybrid search (BM25 + vector reciprocal rank fusion).** Lots of value; significantly more surface (BM25 ranking, score fusion). Standalone plan if customer asks.
- **Multi-vector models (ColBERT-style).** Per-token vectors instead of one-vector-per-doc. Different storage shape entirely. Out of scope until late majority.
- **Streaming similaritySearch results.** Today the tool returns the full result set. Streaming would need a new tool kind and isn't a real ergonomics gap (top-10 RAG queries return fast).
- **Telescope "RAG queries" tab.** Per-query latency, top-result similarity, embedding cost. Subscribes to a new `orm.vector.queried` observer event. ~2 days; defer until B7 is in user hands.
- **B8 prep.** B8 (hosted vector stores) reuses B7's `similaritySearch` tool surface; the local Prisma/Drizzle path becomes the fallback when no hosted provider is configured. Mention this in B8's plan when we write it.

## Pitfalls (from memory + new)

- **Postgres-only.** Document loudly in JSDoc, README, and the auto-embed error message. Surface a clean `VectorStorageUnsupportedError` at first use rather than letting raw SQL fail with a cryptic Prisma error.
- **pgvector extension must be installed.** Check `pg_extension` on first query, throw a helpful "run `CREATE EXTENSION vector;` in your migration" error if missing.
- **`@@unique` race on insert** is the same pattern as A6's `BudgetUsage` — document the load-bearing index in the migration helper output.
- **No top-level `node:*` imports** in `packages/orm/src/cast.ts` — text-format serialization is pure JS (`JSON.stringify` on number[], regex on read). The pgvector text format is `'[0.1,0.2,0.3]'` — same as JSON but without quotes around numbers.
- **Embedding cost surprise** — auto-embed (`whereVectorSimilarTo('col', 'natural language query', { embedWith })`) hits a paid API per call. Pair with A6's `withBudget` in JSDoc. The `MissingEmbedderError` for omitted `embedWith` is the first guard.
- **Dimension mismatches are silent in pgvector.** A 1536-dim column gets a 768-dim vector and the insert fails with `expected 1536 dimensions, not 768`. Cast layer pre-validates and throws `VectorDimensionMismatchError` with the column name + expected vs actual.
- **Drizzle adapter requires `tables: { ... }` registration** (per the `whereHas` adapter requirements memory). The `similaritySearch` tool's model arg works through the same path, so no new constraint — but document it in the tool's JSDoc.
- **Package commands don't register in CLI** — when adding `make:migration --vector`, also add the loader entry in `packages/cli/src/index.ts` and export from `@rudderjs/orm/commands/make-migration`. Don't forget — the pitfall memory exists because this is forgotten regularly.

## Verification

- `pnpm --filter @rudderjs/orm test` — unit tests + integration tests against a docker postgres pass.
- `pnpm --filter @rudderjs/ai test` — `similaritySearch` test suite passes (uses `AiFake` for the embedder).
- `pnpm typecheck` from root — no errors.
- `pnpm build` from root — both packages ship the new exports.
- `pnpm lint` — 0 errors on new files.
- Smoke: in `playground/`, add a `Document` model + a few seeded rows + a `KnowledgeAgent` with `similaritySearch`. Run `pnpm rudder ai:eval` with a fixture suite that asserts the agent picks the right doc.
- Migration helper: `pnpm rudder make:migration --vector documents embedding 1536` produces a runnable migration; apply against playground postgres; round-trip a vector through the cast.
