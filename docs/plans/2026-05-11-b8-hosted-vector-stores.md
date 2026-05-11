# B8 — Hosted vector stores + `fileSearch` provider tool

**Status:** B8 ✓ closed. Phase 1 ✓ shipped (#379). Phase 2 ✓ shipped (#380). Phase 2.x ✓ shipped (#381). Phase 3 ✓ shipped (#382). B8.5 ✓ shipped (see `2026-05-11-b8.5-gemini-hosted-rag.md`).
**Date:** 2026-05-11
**Roadmap item:** B8 in `docs/plans/2026-05-09-ai-roadmap.md`
**Effort:** ~1 week, 3 PR-sized phases + 1 sidecar.
**Prerequisites:** B7 closed (Phase 1 #374, Phase 2 #375, Phase 2.5 #376, Phase 3 #378). Local pgvector primitives exist; B8 adds the hosted equivalents and the unified agent surface.

## Phase status

| Phase | What ships | PR | State |
|---|---|---|---|
| 1   | `VectorStores` facade + `VectorStore` wrapper — CRUD over OpenAI's hosted vector stores. New `VectorStoreAdapter` contract on `ProviderFactory.createVectorStores?()`. OpenAI adapter wraps `client.vectorStores.*` + `client.vectorStores.files.*`; lazy SDK load; file upload pipeline reuses the Files API; default `wait: true` polls `vectorStores.files.retrieve` until `'completed'` / `'failed'` / `'cancelled'` (configurable interval + timeout). Searchable `attributes` map directly to OpenAI's per-file metadata. | #379 | ✓ shipped |
| 2   | `fileSearch({ stores, where?, maxResults?, name?, description? })` agent-tool factory + OpenAI adapter native-block emission via `providerHint`. Bundled latent bug fix: `toolToSchema` now propagates `definition.providerHint` so the agent loop's tool serialization wires hints through to adapters (fixes computer-use's hint too — it lived only on the instance `toSchema()` method, never reached `toAnthropicTools` through agent runs). Closes the agent loop end-to-end on OpenAI's `chat.completions`. | #380 | ✓ shipped |
| 2.x | **WebSearch retrofit (sidecar PR)** — same `providerHint` mechanism Phase 2 introduces, retrofitted onto `WebSearch.toTool()`. **Anthropic** adapter emits native `{ type: 'web_search_20250305', name: 'web_search', max_uses?, allowed_domains? }`; **Gemini** adapter emits `{ google_search: {} }` as a separate top-level tools entry. **OpenAI's chat-completions** has no equivalent (`web_search` is Responses-API-only) — falls through to the existing DuckDuckGo HTML-scrape `server` execute. Same fallback applies to any provider without a native hint match. `WebSearch.domains([...])` lifts to `allowed_domains` on Anthropic; ignored on Gemini (the `google_search` block accepts no opts). `WebSearch.maxResults(n)` lifts to Anthropic's `max_uses`; ignored on Gemini. ~half-day. | #381 | ✓ shipped |
| 3   | **Local pgvector fallback** — `fileSearch({ ..., fallback: { model, column, embedWith, ... } })`. The cascade is automatic: OpenAI's adapter still emits the native `file_search` block (model never invokes execute on that path); other providers (Anthropic, Gemini, etc.) serialize the tool as a function-call schema and the model invokes the lifted `similaritySearch` execute against the local pgvector model. No detection flag — providerHint recognition at the adapter level is the discriminator. Same agent prompt across hosted and self-hosted RAG. Closes B8. | #382 | ✓ shipped |
| B8.5 | **Gemini hosted RAG.** Wraps Google's `fileSearchStores` API as a `VectorStoreAdapter`; typed `where` filters translate to Gemini's `metadataFilter` string syntax; `toGeminiTools` emits the native `fileSearch` block via the same `providerHint` mechanism. Same façade as OpenAI. Locked-decision concern about `cachedContent`-shaped RAG turned out to be outdated — Google now ships a direct equivalent surface. Plan: `2026-05-11-b8.5-gemini-hosted-rag.md`. | — | ✓ shipped |

**B8 is closed with Phase 3.** B8.5 (Gemini hosted RAG) shipped 2026-05-11. Track B fully closed with B10.

## Locked decisions

- **Single `fileSearch({ stores, fallback? })` factory** (not separate hosted/local tools). Agent prompts stay identical across hosted and self-hosted RAG.
- **Gemini deferred to B8.5.** OpenAI is the dominant hosted vector store today; Gemini's `cachedContent`-shaped RAG surface diverges enough from OpenAI's that one unified facade across both is leaky. Ship B8 (OpenAI hosted + local fallback) first; revisit Gemini in B8.5 once we have customer signal on the shape. *Revisited 2026-05-11 — Google shipped `fileSearchStores`, a direct OpenAI equivalent. B8.5 unifies the façade after all; see `2026-05-11-b8.5-gemini-hosted-rag.md`.*
- **WebSearch retrofit lands as a sidecar PR** between Phase 2 and Phase 3. Reuses the `providerHint` plumbing Phase 2 introduces; **Anthropic** emits native `web_search_20250305`, **Gemini** emits native `google_search`. **OpenAI's chat-completions surface has no equivalent** (`web_search` only exists on the Responses API, which is its own migration); OpenAI keeps the DuckDuckGo fallback. Zero new API keys, zero new dependencies.

## Problem

OpenAI and Gemini both ship hosted vector store APIs that handle ingestion, chunking, embedding, and retrieval server-side. Customers shipping RAG agents on those providers either roll their own SDK calls or skip the hosted path entirely and stand up pgvector. Laravel wraps both in a `Stores` facade and exposes a `FileSearch` provider tool. RudderJS has neither.

B7 ships the local primitive (`similaritySearch` over pgvector). B8 adds the hosted surface AND unifies them under one tool — apps configure `fileSearch({ stores: [storeId] })` and the framework decides whether the provider runs the search natively (OpenAI / Gemini) or whether to fall back to local pgvector retrieval.

## Surface

```ts
// 1. Manage stores (Phase 1)
import { VectorStores } from '@rudderjs/ai'

const store = await VectorStores.create('Knowledge Base')
await store.add('./report.pdf', { metadata: { author: 'Alice', year: 2026 } })
await store.add('./policy.txt')

const stores = await VectorStores.list()
await VectorStores.delete(store.id)

// 2. Use the agent tool (Phase 2)
import { fileSearch } from '@rudderjs/ai'

class SupportAgent extends Agent {
  model() { return 'openai/gpt-4o' }
  tools() {
    return [
      fileSearch({
        stores: [store.id],
        where:  { author: 'Alice', year: 2026 },   // server-side metadata filter
        maxResults: 10,
      }),
    ]
  }
}

// 3. Local pgvector fallback (Phase 3)
import { fileSearch, similaritySearch } from '@rudderjs/ai'
import { Document } from './app/Models/Document.js'

class HybridAgent extends Agent {
  model() { return 'openai/gpt-4o' }
  tools() {
    return [
      // When `stores` is configured → routes through OpenAI native file_search.
      // When no hosted provider available for the agent's model → routes through
      // similaritySearch against the local pgvector model. Same tool name and
      // input schema in both paths so agent prompts don't change.
      fileSearch({
        stores:   [store.id],
        fallback: { model: Document, column: 'embedding', embedWith: 'openai/text-embedding-3-small' },
      }),
    ]
  }
}
```

## Why a single `fileSearch` (not separate `hostedFileSearch` + `similaritySearch`)

The agent prompt is the same across hosted and self-hosted RAG: "search for relevant documents." Splitting tools by backend forces apps to author per-deployment-target prompts. A single `fileSearch` factory with a `fallback` opt lets ops swap from a hosted store to a self-hosted one without retraining the agent.

`similaritySearch` (B7) stays as the **direct** local primitive — apps that ONLY ever use pgvector can keep using it. `fileSearch` is the **provider-aware** surface that unifies both paths and emits the native tool block when the provider supports it.

## Why a `providerHint` mechanism on the OpenAI adapter

A7 (computer-use) introduced `providerHint?: ProviderHint` on `ToolDefinitionSchema`. The Anthropic adapter recognizes `providerHint?.type === 'computer-use'` and emits Anthropic's native `{ type: 'computer_20250124', ... }` block instead of the standard function-call shape.

B8 reuses the exact same mechanism on the OpenAI side. `fileSearch` returns a tool with `providerHint?.type === 'file-search'`; the OpenAI adapter sees that hint and emits `{ type: 'file_search', vector_store_ids: [...], filters: {...}, max_num_results: N }` instead of the function-call block. Same forward-compat trick as A7 — `providerHint.tool` could carry a future schema version.

This means **B8 Phase 2 also touches `packages/ai/src/providers/openai.ts`**, similar to how A7 Phase 2 touched the Anthropic adapter. `WebSearch` already declared `meta.providerNative: true` aspirationally but no adapter consumed it. **Decision (revised):** Phase 2 lands the `providerHint` plumbing for `fileSearch`; **Phase 2.x** retrofits the same plumbing onto `WebSearch` for the providers that ship a native chat-completions web-search tool today (Anthropic + Gemini). OpenAI's chat-completions surface has no `web_search` block — that lives on the Responses API, which is a separate migration — so OpenAI continues to use the DuckDuckGo `server` execute as fallback.

## Design decisions to lock in before Phase 1

These force a rewrite if punted:

1. **VectorStore IDs are provider-prefixed.** `vs_abc123` → store on the provider. `local:documents` → local model reference. Apps that mix providers need disambiguation. Alternative: separate `provider` field on every operation (verbose).
2. **File upload reuses `FileManager`** (already exists at `src/files.ts`). `store.add('./report.pdf')` calls `FileManager.upload` → uploads to OpenAI Files → adds the file to the vector store via `client.vectorStores.fileBatches.create({ vector_store_id, file_ids: [id] })`. Don't reinvent the file-upload pipeline.
3. **`add(input, opts?)` accepts file paths, `Document.fromPath()` instances, and `Buffer`s.** Lifts onto the existing `Document` attachment surface. Per memory `feedback_no_top_level_node_imports`: the file-path overload is Node-only so it lives at `@rudderjs/ai/node` (with `documentFromPath` etc.), main-entry stays runtime-agnostic.
4. **Metadata filter syntax mirrors OpenAI's.** `where: { author: 'Alice', year: 2026 }` is sugar for `{ type: 'and', filters: [{ type: 'eq', key: 'author', value: 'Alice' }, { type: 'eq', key: 'year', value: 2026 }] }`. Provide both shapes — the typed shape for power, the object shape for ergonomics.
5. **`fileSearch` is a server tool with no execute when a hosted provider is in play.** When the provider runs the search natively, our `execute` is never called — the model gets the search results back as a synthetic tool-result block from the provider. When the local fallback engages, we install a real `execute` that calls `similaritySearch` and returns the result map.
6. **`fallback` requires Phase 2.5's chained-where capability** — falls back queries always need scope filtering (per-tenant, ACLs). Phase 3 of B8 is gated on Phase 2.5 of B7, which is now ✓ shipped.
7. **No streaming retrieval.** Hosted providers stream the model's response while doing the search inline; the search itself isn't a stream. Don't over-design for partial result delivery.

## Phases

### Phase 1 — `VectorStores` facade + OpenAI adapter

- `packages/ai/src/vector-stores/index.ts` — `VectorStores` static class with `create(name, opts?)`, `list(opts?)`, `get(id)`, `delete(id)`. Returns `VectorStore` instances exposing `add(input, opts?)`, `remove(fileId)`, `files()`, `delete()`.
- Provider dispatch via the registered AI provider (default = whatever's first in the registry; override per-call via `opts.provider`). For B8 v1: only `openai` implements; calls against other providers throw a clear error.
- File upload pipeline: `add('./path.pdf')` → `FileManager.upload(path)` → `client.vectorStores.fileBatches.create(...)` → wait for completion (poll `vectorStores.fileBatches.retrieve` until status is `'completed'` or `'failed'`). Add a `wait: false` opt for fire-and-forget.
- Tests: hand-rolled OpenAI client fake captures the SDK calls; assert the upload + attach + poll sequence; assert filter normalization on `where`.
- Docs: `docs/guide/vector-stores.md` — basic usage. Re-export from `@rudderjs/ai` main entry.

### Phase 2 — `fileSearch` provider tool + OpenAI native block

**Shipped surface (✓ #380):**

- `packages/ai/src/file-search.ts` exports `fileSearch({ stores, where?, maxResults?, name?, description? })`. Returns a `FileSearchTool` — plain object tagged with `Symbol.for('rudderjs.ai.file-search')` (mirrors `COMPUTER_USE_MARKER`); `isFileSearchTool(t)` typeguard. No `execute` on the hosted path. Default tool name `file_search` (OpenAI's trained identifier). Placeholder `inputSchema = z.object({ query: z.string() })` so non-OpenAI providers see a regular function-call tool.
- Provider hint lives on `definition.providerHint` — `{ type: 'file-search', vector_store_ids, filters?, max_num_results? }`. The agent loop's `toolToSchema()` propagates it onto `ToolDefinitionSchema` and the OpenAI adapter recognizes the hint.
- `where` accepts the sugar `{ key: value }` form (lowered to an `and` of `eq` filters) or the typed `FileSearchFilter` shape directly. `normalizeWhere(where)` is exported for advanced use; single-key sugar short-circuits to a bare `eq` (no `and` wrapper) matching OpenAI's recommended shape.
- `packages/ai/src/providers/openai.ts` — `toOpenAITools` (now exported) recognizes `providerHint?.type === 'file-search'` and emits `{ type: 'file_search', vector_store_ids, filters?, max_num_results? }`. Mirrors A7 Phase 2's Anthropic-side change.
- `AiFake.respondWithFileSearchResults({ text? | hits?, usage? })` — convenience helper. The hosted path produces the answer directly, so the fake stubs a single-step assistant reply (synthesized from hits or supplied verbatim).

**Latent bug fix bundled in:** `toolToSchema()` did NOT propagate `providerHint` — so computer-use's hint lived on the instance `toSchema()` method but never reached `toAnthropicTools` through real agent runs. Phase 2 adds `providerHint?: ProviderHint` to `ToolDefinitionOptions`, propagates it in `toolToSchema`, and moves computer-use's hint onto its `definition`. Both code paths now go through one channel.

**Tests:** new `packages/ai/src/file-search.test.ts` — factory shape (providerHint, marker, schema), validation (empty stores/where), `normalizeWhere` cases, `toOpenAITools` native-block emission, end-to-end through `toolToSchema → toOpenAITools`, `AiFake.respondWithFileSearchResults` agent-loop integration, and the `definition.providerHint` propagation contract.

**Verification:** `pnpm typecheck` ✓ root (93/93), `pnpm build` ✓ (51/51), `pnpm --filter @rudderjs/ai test` 703/703 ✓ (38 new), lint ✓ (only pre-existing warnings).

**Plan doc + changeset:** Phase 2 table row marked in flight + this body section + `.changeset/ai-b8-phase2-file-search.md` (minor).

**Docs:** new `docs/guide/vector-stores.md` covers both Phase 1 (CRUD) + Phase 2 (agent tool). Added under the AI sidebar between "AI" and "MCP".

### Phase 2.x — `WebSearch` retrofit (sidecar)

**Shipped surface:**

- `packages/ai/src/provider-tools.ts` — `WebSearch.toTool()` now sets `providerHint: { type: 'web-search', allowed_domains?, max_uses? }` from the chained `.domains([...])` / `.maxResults(n)` opts. The DuckDuckGo `server` execute stays in place as the fallback.
- `packages/ai/src/providers/anthropic.ts` — `toAnthropicTools` recognizes the hint and emits `{ type: 'web_search_20250305', name: 'web_search', max_uses?, allowed_domains?, blocked_domains?, user_location? }`. Honors a `providerHint.tool` override for forward-compat with future Anthropic web-search variants (mirrors A7's computer-use forward-compat trick).
- `packages/ai/src/providers/google.ts` — `toGeminiTools` is restructured to return the **already-wrapped top-level array** (`[{ functionDeclarations: [...] }, { google_search: {} }, ...]`) instead of just the function declarations list. Native blocks like `google_search` sit as separate top-level entries alongside the function-declarations wrapper, matching Gemini's mixed-tools shape. The two consumer sites (request payload + cache-key build) drop their re-wrapping.
- **OpenAI's chat-completions has no native web-search block** (`web_search_preview` is Responses-API-only). The hint is harmless on OpenAI — `toOpenAITools` doesn't recognize `'web-search'` and the tool falls through to the standard function-call shape, where the DuckDuckGo `server` execute runs server-side. Same fallback for any other provider without a native match.

**`domains` / `maxResults` semantics across providers:**

| Provider  | `.domains([...])`           | `.maxResults(n)`           |
|---|---|---|
| Anthropic | → `allowed_domains`         | → `max_uses`               |
| Gemini    | ignored (block accepts none) | ignored (block accepts none) |
| OpenAI    | applied via DuckDuckGo `site:` query | bounded by `slice(0, 2000)` of HTML response |

**Tests:** new `packages/ai/src/provider-tools.test.ts` — `WebSearch` providerHint cascade through `toolToSchema`, `toAnthropicTools` native-block emission with/without domains/max_uses, the `providerHint.tool` forward-compat override, `GoogleAdapter` request-payload shape (single native entry, mixed function-decls + native, function-decls-only sanity).

**Verification:** `pnpm --filter @rudderjs/ai typecheck` ✓, `pnpm build` ✓ (51/51), `pnpm --filter @rudderjs/ai test` 715/715 ✓ (12 new across 3 suites).

**Plan doc + changeset:** Phase 2 row → ✓ #380, Phase 2.x row + this body section + `.changeset/ai-b8-phase2x-websearch-retrofit.md` (minor).

**Out of scope:**

- Anthropic's `user_location` / `blocked_domains` lift onto `WebSearch.{ region(...), blockDomains(...) }` chained opts. The hint already passes them through if set manually; an ergonomic chain follows when there's customer demand.
- OpenAI Responses-API migration. Big enough that it's its own track; lands later as a separate adapter (`packages/ai/src/providers/openai-responses.ts`) that the registry routes to for `*-search-preview` model ids.

### Phase 3 — Local pgvector fallback (closes B8)

Gemini hosted parity stayed deferred to B8.5 (per the locked decision). Phase 3 ships **just** the local pgvector fallback. With a `fallback` opt configured, the same `fileSearch` tool works on every provider — OpenAI runs the search natively, everyone else runs `similaritySearch` against the local pgvector model.

**Shipped surface:**

- `packages/ai/src/file-search.ts` — new `fallback?: FileSearchFallback<TInstance>` opt on `FileSearchOptions`. Type alias `FileSearchFallback<TInstance> = Omit<SimilaritySearchOptions<TInstance>, 'name' | 'description'>` — every B7 similaritySearch knob (`model`, `column`, `embedWith`, `metric`, `minSimilarity`, `limit`, `scope`, `projectResult`) flows through. `name` / `description` are inherited from the outer `fileSearch` call so the agent prompt stays identical across providers.
- `FileSearchTool` interface widened to `Tool<{ query: string }, unknown>` with optional `execute` + `toModelOutput`. Both stay `undefined` when `fallback` is absent (Phase 2 back-compat). When `fallback` is set, both are lifted from an internal `similaritySearch(...)` instance.
- **No detection flag.** The `providerHint` recognition at the adapter level is the discriminator. OpenAI's `toOpenAITools` substitutes the native `file_search` block — the model never invokes the function-call tool, so `execute` is dead weight on that path. Anthropic / Gemini / others see a regular function-call schema with `{ query: string }`, the model invokes it, and `execute` delegates to `similaritySearch`. The plan originally proposed a `supportsFileSearch?: boolean` capability check on each `ProviderFactory` — turned out unnecessary; the existing `providerHint` cascade already does the right thing.

**Example:**

```ts
import { Agent, fileSearch } from '@rudderjs/ai'
import { Document } from './app/Models/Document.js'

class HybridAgent extends Agent {
  // On openai/*: native file_search runs server-side against vs_kb.
  // On anthropic/*, gemini/*, etc: similaritySearch runs against the local
  // Document model. Same prompt, same tool name, same input schema.
  model() { return 'openai/gpt-4o' }
  tools() {
    return [
      fileSearch({
        stores: ['vs_kb'],
        fallback: {
          model:     Document,
          column:    'embedding',
          embedWith: 'openai/text-embedding-3-small',
          minSimilarity: 0.7,
          limit:     10,
          scope:     q => q.where('tenantId', currentTenant).where('published', true),
        },
      }),
    ]
  }
}
```

**Tests:** new `describe('fileSearch — fallback (Phase 3)', ...)` block in `packages/ai/src/file-search.test.ts` — back-compat (no `fallback` → no `execute`), execute + toModelOutput lifted when `fallback` is set, providerHint preserved (OpenAI native still wins), execute delegates the embedding + vector-similarity call chain, modelOutput projects the `(0.80) {json}` shape, `fallback.scope` flows tenant/visibility predicates into the underlying QueryBuilder, missing vector-query adapter throws clearly. **7 new tests.**

**Verification:** `pnpm --filter @rudderjs/ai typecheck` ✓, `pnpm build` ✓ (51/51), `pnpm --filter @rudderjs/ai test` 722/722 ✓ (7 new in 1 new suite).

**Plan doc + changeset:** Phase 3 row → ✓ shipped + this body section + `.changeset/ai-b8-phase3-pgvector-fallback.md` (minor) + roadmap row B8 marked shipped 2026-05-11.

**Out of scope (matches the locked decisions above):**

- Gemini hosted `VectorStores` + `fileSearch` parity → B8.5 (shipped 2026-05-11).
- Hybrid hosted + local merge (reciprocal rank fusion) — punted unless customer demand.
- Vector store sync tooling — standalone follow-up.
- Telescope "RAG queries" tab — `ai.file_search.queried` observer event lands when there's UI demand.

## Out of scope (file as future plans if picked up)

- **Anthropic file search.** Anthropic has Files API but no first-class hosted vector store yet. When they ship one, retrofit via the same `providerHint` pattern.
- **Hybrid hosted + local.** Querying both a hosted store AND local pgvector and merging results (reciprocal rank fusion). Useful for some apps; out of scope until customer demand.
- **Vector store sync.** Mirroring a local pgvector model to a hosted store (or vice versa) for migration. Standalone tooling.
- **Streaming retrieval results.** Hosted providers don't expose retrieval as a stream; not worth designing for.
- **Custom chunking / embedding strategies on hosted stores.** OpenAI's API exposes some chunking config; B8 v1 uses defaults and accepts an opaque `chunkingStrategy` passthrough.
- **Telescope "RAG queries" tab.** Per-query latency, top-result similarity, embedding cost. Subscribes to a new `ai.file_search.queried` observer event. ~2 days; defer until B8 is in user hands.

## Pitfalls (preflight)

- **OpenAI vector store IDs vs file IDs.** A vector store has an ID (`vs_...`); files within it have separate file IDs (`file-...`). `store.add()` returns the file ID; `store.remove(fileId)` takes the file ID. Don't conflate.
- **File upload async completion.** `vectorStores.fileBatches.create` returns immediately; the actual ingestion + chunking + embedding is async. `add()` should poll until status is `'completed'` (with timeout) by default. Document the `wait: false` opt for fire-and-forget.
- **No top-level `node:*` imports** — file-path overloads of `add()` go to `@rudderjs/ai/node`. Main entry stays runtime-agnostic. Per memory `feedback_no_top_level_node_imports`.
- **`providerHint` cascade** — A7 introduced this on `ToolDefinitionSchema`. B8 adds a second consumer. If a third provider tool joins (e.g. Anthropic memory tool), the `providerHint.type` enum grows. Keep it as a string union on the type so additions are non-breaking.
- **Lazy SDK loading** — OpenAI vector stores live at `client.vectorStores.*` on the v4+ SDK. The OpenAI peer is already optional; the new code stays inside the existing lazy-load boundary in `providers/openai.ts`.
- **Cost surprise** — hosted vector stores bill per GB/month for storage + per query. Document loudly in `vector-stores.md`. Pair with A6's `withBudget` once that surface lands cost tracking for tool-result tokens (currently it doesn't).
- **Plan-doc backticks** — per `feedback_no_escaped_backticks_in_plan_docs`, never embed `\`` in inline code spans here. Already applied above.

## Verification

- `pnpm --filter @rudderjs/ai test` — vector-stores + file-search test suites pass against AiFake.
- `pnpm typecheck` from root — no errors.
- `pnpm build` from root — both new modules ship in `dist/`. Docs build clean (post-#377).
- Smoke: in `playground/`, add a `KnowledgeAgent` using `fileSearch` against a real OpenAI vector store. Verify the agent answers from the docs.
- After Phase 3: round-trip a query through the local fallback path (mock no-network OpenAI) and assert the results match a direct `similaritySearch` call.
