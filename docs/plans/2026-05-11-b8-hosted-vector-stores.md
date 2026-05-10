# B8 — Hosted vector stores + `fileSearch` provider tool

**Status:** Phase 1 ✓ shipped (#379). Phase 2 in flight on `feat-b8-file-search`. Phase 2.x / 3 not started.
**Date:** 2026-05-11
**Roadmap item:** B8 in `docs/plans/2026-05-09-ai-roadmap.md`
**Effort:** ~1 week, 3 PR-sized phases + 1 sidecar.
**Prerequisites:** B7 closed (Phase 1 #374, Phase 2 #375, Phase 2.5 #376, Phase 3 #378). Local pgvector primitives exist; B8 adds the hosted equivalents and the unified agent surface.

## Phase status

| Phase | What ships | PR | State |
|---|---|---|---|
| 1   | `VectorStores` facade + `VectorStore` wrapper — CRUD over OpenAI's hosted vector stores. New `VectorStoreAdapter` contract on `ProviderFactory.createVectorStores?()`. OpenAI adapter wraps `client.vectorStores.*` + `client.vectorStores.files.*`; lazy SDK load; file upload pipeline reuses the Files API; default `wait: true` polls `vectorStores.files.retrieve` until `'completed'` / `'failed'` / `'cancelled'` (configurable interval + timeout). Searchable `attributes` map directly to OpenAI's per-file metadata. | #379 | ✓ shipped |
| 2   | `fileSearch({ stores, where?, maxResults?, name?, description? })` agent-tool factory + OpenAI adapter native-block emission via `providerHint`. Bundled latent bug fix: `toolToSchema` now propagates `definition.providerHint` so the agent loop's tool serialization wires hints through to adapters (fixes computer-use's hint too — it lived only on the instance `toSchema()` method, never reached `toAnthropicTools` through agent runs). Closes the agent loop end-to-end on OpenAI's `chat.completions`. | — | in flight |
| 2.x | **WebSearch retrofit (sidecar PR)** — same `providerHint` mechanism Phase 2 introduces, retrofitted onto `WebSearch.toTool()`. OpenAI adapter emits native `{ type: 'web_search' }`; Gemini adapter emits `{ google_search: {} }`. DuckDuckGo HTML scrape stays as the no-config fallback for providers without native support. ~half-day. | — | not started |
| 3   | Local pgvector fallback bridge (when no hosted provider configured, `fileSearch` routes through B7's `similaritySearch`). Closes B8. | — | not started |
| B8.5 | Gemini parity for `VectorStores` + `fileSearch` (Gemini's RAG surface uses `cachedContent`, not vector stores; spec drift means it deserves its own design pass). Deferred — locked decision. | — | future |

After Phase 3, B8 closes. B8.5 adds Gemini hosted RAG. Next Track B item is **B9** (ElevenLabs provider — TTS/STT, ~2 days), then **B10** (VoyageAI provider — embeddings + reranking, ~2 days).

## Locked decisions

- **Single `fileSearch({ stores, fallback? })` factory** (not separate hosted/local tools). Agent prompts stay identical across hosted and self-hosted RAG.
- **Gemini deferred to B8.5.** OpenAI is the dominant hosted vector store today; Gemini's `cachedContent`-shaped RAG surface diverges enough from OpenAI's that one unified facade across both is leaky. Ship B8 (OpenAI hosted + local fallback) first; revisit Gemini in B8.5 once we have customer signal on the shape.
- **WebSearch retrofit lands as a sidecar PR** between Phase 2 and Phase 3. Reuses the `providerHint` plumbing Phase 2 introduces; OpenAI emits native `web_search`, Gemini emits native `google_search`. DuckDuckGo fallback stays for providers without native support — zero new API keys, zero new dependencies.

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

This means **B8 Phase 2 also touches `packages/ai/src/providers/openai.ts`**, similar to how A7 Phase 2 touched the Anthropic adapter. `WebSearch` already declares `meta.providerNative: true` aspirationally but no adapter consumes it; B8 also needs to either retrofit `WebSearch` to use `providerHint` (consistency) or leave it as a no-op fallback. **Decision:** leave `WebSearch` as-is for v1; revisit if customer asks. B8 only touches the file-search hint path.

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

**Shipped surface (in flight on `feat-b8-file-search`):**

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

### Phase 3 — Gemini parity + local pgvector fallback

- Gemini side: `client.files.upload` + `cachedContent` retrieval. Gemini's hosted RAG surface is shaped differently from OpenAI's — doesn't have a "vector store" abstraction in the same way; uses `cachedContent` resources. Plan: `VectorStores.create()` against `provider: 'google'` creates a `cachedContent`; `add()` appends files; `fileSearch` emits the appropriate Gemini tool. **Investigate API parity early** — if shapes diverge enough to make the unified facade leaky, document the divergence in JSDoc + ship the OpenAI-only path with Gemini deferred to B8.5.
- `fallback` opt on `fileSearch`: when set AND the agent's model has no native file-search support, install an execute that calls `similaritySearch({ model: fallback.model, column: fallback.column, embedWith: fallback.embedWith })` internally. The tool's `inputSchema` ({ query: string }) matches `similaritySearch`'s; the execute just delegates.
- Detection logic: provider-tool dispatch is a per-adapter capability check. Add `supportsFileSearch?: boolean` to the provider factory or a static method; default `false`. OpenAI / Google flip it to `true` in their factories.
- Tests: fallback path executes when model is `anthropic/*` (no native support); native path executes when model is `openai/*`; agent prompts work identically across both.
- Update plan doc + close B8.

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
