---
"@rudderjs/sync": minor
---

Harden the persistence layer + atomic `Sync.seed` (Phase 7 of the 2026-05-22 eventing/realtime plan):

- **`Sync.seed()` empty-doc gate is now atomic** — the check moved inside `transact` and runs against the actual `fields.size`, not the doc's state vector. Pre-fix, the state-vector check skipped seeding for any doc that had previously been opened (state vector grew on first connect, even with no field writes). Two concurrent `seed()` callers now serialise on Yjs's per-doc transact queue. Return type changed from `Promise<void>` to `Promise<boolean>` — `true` if this call wrote, `false` if the doc was already seeded.
- **`room.ready` rejects on persistence load failure** — was previously silenced with `.catch + resolve`, leaving a broken in-memory room cached forever. Now the WS upgrade closes the socket cleanly (RFC 6455 code 1011) and `Sync.snapshotAsync` / `readMapAsync` / `readTextAsync` / `seed` propagate the rejection to user code. Subsequent calls reload from persistence instead of operating against an empty doc.
- **`persistence.storeUpdate` failures emit `sync.error`** — fire-and-forget storeUpdate on server-originated updates (via `doc.on('update')` in `getOrCreateRoom`) and awaited storeUpdate on client messages both surface errors as `sync.error` events with the new `op: 'storeUpdate'` field. Telescope picks them up unchanged.
- **`onChange` callback failures emit `sync.error`** — was previously `await onChange?.()` with no try/catch, producing unhandled-rejection noise. Now caught and surfaced as `sync.error` with `op: 'onChange'`.
- **AI awareness clock survives HMR / process restart** — was a module-level counter that reset to 0 on Vite SSR re-eval, causing y-protocols to filter "older" clocks and silently drop AI cursor updates. Now lives on `globalThis['__rudderjs_sync_ai_clock__']`.
- **`SyncEvent['sync.error']` gains optional `op` field** — `'getYDoc' | 'storeUpdate' | 'onChange' | 'seed' | 'firstConnect'`. Backward-compatible (optional); telescope's SyncCollector picks it up via the generic `[key: string]: unknown` shape.

The `room.ready` and `Sync.seed` return-type changes are the only public-surface shifts. No existing in-repo callers exercise either change point.
