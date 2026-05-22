---
"@rudderjs/sync": minor
---

`@rudderjs/sync/react` — `useCollabSeedText` + `enabled` option on `useCollabRoom`.

Two additive hooks/options that unblock CodeMirror-style adapters and conditional-connection patterns. Both pieces are mechanically small and fully backwards-compatible — existing call sites see no behavior change.

- **`useCollabSeedText(room, textKey, seedFn)`** — sibling of `useCollabSeed` for `Y.Text`-shaped editors (CodeMirror via `y-codemirror.next`, Monaco, plain `Y.Text` bindings). The existing `useCollabSeed` calls `doc.getXmlFragment(key)` unconditionally, which is correct for Tiptap / ProseMirror but throws / corrupts the doc on a name already bound as `Y.Text`. Same synced-await + `'rudder-sync-seed'` transact-origin semantics; the share-type-aware decision is the only difference. The two hooks now share an internal `seedShareTypeOnSync` helper that's exported for testing.

- **`UseCollabRoomOptions.enabled?: boolean`** — default `true`. Set to `false` to gate the WebSocket handshake + IndexedDB open without a render-time branch around the hook (illegal under Rules of Hooks). Standard shape — matches `useSWR({ enabled })` / `useQuery({ enabled })`. Flipping `false → true` mounts the manager; `true → false` runs the same `manager.stop()` path as unmount (and `room` flips back to `null` via the existing `onRoomChange(null)` callback). Use for "render fields locally until prerequisites are met" — e.g. `enabled: !!wsPath`.

Both hooks remain thin React wrappers; the framework continues to put testable logic in non-hook helpers (`CollabRoomManager` / `seedShareTypeOnSync`) so no React testing harness is required.
