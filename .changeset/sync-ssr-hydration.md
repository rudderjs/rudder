---
'@rudderjs/sync': minor
---

feat(sync): SSR hydration primitives + onFirstConnect lifecycle hook

Adds awaitable read accessors that wait for persistence load before returning, and a server-side seeding hook that fires once per document per process after the first WebSocket client attaches.

**New `Sync` facade methods (async siblings of existing sync ones):**
- `Sync.snapshotAsync(docName): Promise<Uint8Array>` — awaits `room.ready`, then encodes. SSR-safe replacement for `snapshot()`, which returns the empty in-process doc on cold reads.
- `Sync.readMapAsync(docName, mapName): Promise<Record<string, unknown>>` — async sibling of `readMap()`.
- `Sync.readText(docName, textName): Promise<string>` — read a `Y.Text` as a plain string. Returns `''` for never-written texts.
- `Sync.load(docName): Promise<Y.Doc>` — return the underlying doc after `room.ready` resolves. Power-user escape hatch for materializing multiple fields off one doc in one await.

**New `SyncConfig.onFirstConnect` hook:**
- Signature: `(docName, doc, ctx: { firstClient, persistence }) => void | Promise<void>`
- Fires exactly once per docName per process, after the first WebSocket client attaches AND `room.ready` resolves.
- Use case: seeding empty Y.Texts / Y.Maps from a DB of record without racing client-side seeding (fixes the SSR-vs-WS hydration flicker on collab-enabled pages).
- Best-effort: throws un-mark the docName so the next connection retries; the WebSocket itself is unaffected. Errors emit via `syncObservers.emit({ kind: 'sync.error', ... })`.
- Optional: omitting `onFirstConnect` from config leaves behavior unchanged.

The existing `Sync.snapshot()` / `Sync.readMap()` continue to work and remain sync — kept for back-compat with telescope, docs examples, and any in-the-wild callers. A future minor will mark them `@deprecated`.

No breaking changes.
