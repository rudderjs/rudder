---
'@rudderjs/sync': major
---

Graduate to 1.0.0.

The Yjs CRDT sync engine — `SyncProvider`, the `Sync` facade (`document`, `seed`, `snapshot`, `readMap`, `updateMap`, `updateMapBatch`, `clearDocument`, `getClientCount`, `persistence`), persistence drivers (`MemoryPersistence`, `syncPrisma()`, `syncRedis()`), the `SyncObserverRegistry` at `@rudderjs/sync/observers`, and the Lexical editor adapter at `@rudderjs/sync/lexical` are now stable.

**Breaking changes from 0.2.x:**

- `LIVE_UPGRADE_KEY` renamed to `SYNC_UPGRADE_KEY` (the underlying globalThis key value also changed from `__rudderjs_live_upgrade__` to `__rudderjs_sync_upgrade__`). The constant is internal — only matters if you wrote custom WS upgrade chaining against it.
- The `./tiptap` subpath export has been removed. It was a non-functional scaffold; a real Tiptap adapter is planned for a future release. The design notes live in `src/tiptap/README.md`.

**Documentation cleanup:** prior README + boost guidelines documented a `sync()` factory function and `await sync.document(...)` pattern that didn't exist. Setup now matches reality — `SyncProvider` is auto-discovered via `defaultProviders()` and configured through `config/sync.ts`. `Sync.document()` is synchronous (returns `Y.Doc` directly).
