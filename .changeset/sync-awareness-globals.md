---
"@rudderjs/sync": patch
---

Awareness lifecycle + globals hygiene (Phase 8 of the 2026-05-22 eventing/realtime plan):

- **Dead sockets pruned from `awarenessMap` on replay.** Force-killed sockets (proxy timeout, tab kill) never fire the `close` event, so their stored awareness entry would linger and replay ghost cursors to every late joiner. The Step-2 awareness replay loop now deletes entries whose `readyState !== OPEN`.
- **AI awareness replay TTL.** Stored `aiAwarenessMsg` was replayed to every new joiner forever; if the AI agent crashed without calling `clearAiAwareness`, the stale cursor never went away. Stored AI awareness now carries an `aiAwarenessAt` timestamp and the handler skips replay (and drops the buffer) once it's older than 60 seconds.
- **`Sync.clearAiAwareness(docName)` server helper.** Explicit recovery path keyed by `docName` for when an AI agent crashes without a Y.Doc reference handy. Drops the stored replay buffer; the lexical-side `clearAiAwareness(doc)` is still the way to also broadcast a null awareness frame to currently connected clients.
- **Centralized globalThis keys.** `packages/sync/src/globals.ts` now owns the slot names — `rooms`, `persistence`, `firstConnect`, `observers`, `aiAwarenessClock`. The package was renamed `live` → `sync` last year but two slots still carried the `__rudderjs_live_*` prefix and were re-declared independently across `index.ts` and `lexical/awareness.ts` — rename either side and AI cursors silently broke. All slots now use the `__rudderjs_sync_*` prefix and there's only one source of truth.
- **`CollabRoomManager.start()` throws on second call.** Was a silent no-op; if the first call was cancelled mid-`loadYjs` (React strict-mode double-invoke, route change), the `synced` promise was already rejected and the second call returned `undefined` against a dead state. Construct a fresh manager to retry — `useCollabRoom` already does this per effect, so the in-tree consumer is unaffected.

External consumers reaching into `globalThis['__rudderjs_live__']` or `globalThis['__rudderjs_live_persistence__']` directly will need to switch to `globalThis['__rudderjs_sync_rooms__']` / `globalThis['__rudderjs_sync_persistence__']`. Nothing inside the workspace did so.
