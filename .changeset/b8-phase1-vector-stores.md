---
"@rudderjs/ai": minor
---

**B8 Phase 1 — `VectorStores` facade + OpenAI hosted-vector-store adapter.** Apps can now manage OpenAI's hosted vector stores end-to-end (`VectorStores.create()` / `.list()` / `.get()` / `.delete()`; `VectorStore.add()` / `.remove()` / `.files()` / `.delete()`) with no SDK boilerplate. Phase 2 will add the `fileSearch` agent tool that consumes these stores; Phase 3 adds the local pgvector fallback bridge.

```ts
import { VectorStores } from '@rudderjs/ai'

const store = await VectorStores.create('Knowledge Base', {
  metadata:     { team: 'support' },
  expiresAfter: { anchor: 'last_active_at', days: 7 },
})

// Upload + attach + poll until indexed (default wait: true).
await store.add({
  filePath:    './report.pdf',
  attributes:  { author: 'Alice', year: 2026 },
})

// Or skip the upload if you already have an OpenAI file id.
await store.add({ fileId: 'file_abc', wait: false })

const all = await VectorStores.list()
await VectorStores.delete(store.id)
```

`@rudderjs/ai`:

- **`VectorStoreAdapter` contract** added to `ProviderFactory.createVectorStores?()` — provider-agnostic CRUD over hosted vector stores, plus `addFile` / `removeFile` / `listFiles`. New types: `VectorStoreInfo`, `VectorStoreFileInfo`, `VectorStoreCreateOptions`, `VectorStoreAddOptions`, `VectorStoreListOptions`, `VectorStoreList`, `VectorStoreFileList`.
- **`AiRegistry.resolveVectorStores(providerName)`** — resolves the registered provider's vector-store adapter; throws a helpful error pointing at `similaritySearch()` over a local pgvector model when the provider doesn't implement the contract.
- **`OpenAIVectorStoreAdapter`** wraps `client.vectorStores.*` + `client.vectorStores.files.*` from the v4+ SDK. Lazy SDK load mirrors the rest of the OpenAI provider. File upload pipeline reuses the Files API (`files.create({ purpose: 'assistants' })`). Per-file searchable metadata routes through OpenAI's `attributes` field — Phase 2's `fileSearch({ where })` filters on these.
- **`addFile` polling** — defaults to `wait: true`, polling `vectorStores.files.retrieve` until status is `'completed'` / `'failed'` / `'cancelled'`. Default poll interval `1000ms`, total timeout `120_000ms` (2 min). Both configurable; `wait: false` returns immediately (fire-and-forget). Failed-status responses surface `lastError` without throwing — apps decide whether to retry.
- **Re-exported from `@rudderjs/ai` main entry** — `VectorStores`, `VectorStore`, plus all the contract types.
- **17 new tests** in `vector-stores.test.ts` cover provider resolution, create/list/get/delete, addFile (existing fileId path, upload-then-attach path, attribute forwarding, fire-and-forget, polling-until-completed, polling timeout, failed-status surfaced, missing-input error), removeFile, files listing, and store deletion. Hand-rolled fake OpenAI client captures every SDK call for assertion.

Plan: `docs/plans/2026-05-11-b8-hosted-vector-stores.md` — Phase 1 in flight, Phase 2 (`fileSearch` agent tool + OpenAI native-block emission via `providerHint`) is up next.
