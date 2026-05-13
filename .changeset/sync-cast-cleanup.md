---
"@rudderjs/sync": patch
---

Internal cleanup of `@rudderjs/sync`. No public API changes.

- Centralize the rooms-map globalThis access behind `getRoomsMap()` / `ensureRoomsMap()` helpers — collapses 5 inline `g[KEY] as Map<string, Room>` reads (sync:docs, sync:clear, Sync.clearDocument, Sync.getClientCount, getOrCreateRoom) into one structural cast inside the helper. `getOrCreateRoom` is restructured to early-return on the cache-hit path so it no longer needs a `rooms.get(docName) as Room` non-null cast.
- Centralize the per-WebSocket client-id property bag behind `readTaggedId()` / `writeTaggedId()` helpers — keeps the `(ws as unknown as Record<...>)['__syncClientId']` cast in one spot instead of two inline at the callsite.
- Centralize commander-style argv reads behind `readDocArg()` — drops the duplicated `(args as unknown as Record<string, unknown>)['doc'] as string` pattern from the two `sync:*` commands.
- Add a named `DeltaItem` shape for `Y.XmlText.toDelta()` results (yjs types `toDelta` as `Array<any>`) and use it across the `sync:inspect` command's three call sites. Replaces three inline `as { insert: unknown; attributes?: Record<string, unknown> }` casts. Lexical adapter (`@rudderjs/sync/lexical`) still has its own toDelta casts — left for a follow-up sweep to keep this PR focused.
- `sync:inspect` outer/inner loops switched from `for (let i = 0; ...) { const entry = delta[i]! }` to `for (const [i, entry] of delta.entries())` — eliminates the per-iteration non-null assertion that the index-based form needed under `noUncheckedIndexedAccess`.
