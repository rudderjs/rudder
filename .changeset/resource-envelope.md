---
'@rudderjs/orm': minor
---

API-resource envelopes (Laravel parity, non-breaking). **`Resource.collection()` now accepts paginator results directly** and auto-derives the envelope `meta`: a `Model.paginate()` result → `meta: { total, page, perPage, lastPage }`; a `Model.cursorPaginate()` result → `meta: { perPage, nextCursor, prevCursor, hasMore }`; a plain array keeps the original behavior. Detection is duck-typed (no `instanceof` — HMR re-import safe), and an explicit `meta` second argument merges over the derived values. **`additional(extra)`** on both `JsonResource` and `ResourceCollection` merges extra top-level keys into the `toResponse()` envelope (alongside `data`/`meta`, never inside; envelope keys win on conflict). **`JsonResource.toResponse(req?)`** wraps a single resource as `{ data: ..., ...additional }` — async-safe where `toJSON()` throws on an async `toArray()`.
