---
'@rudderjs/sync': minor
---

feat(sync): add `@rudderjs/sync/react` subpath with `useCollabRoom` + `useCollabSeed` hooks

New client-side React surface for collab rooms. Replaces the ~50 LOC of `Y.Doc` + `WebsocketProvider` + `IndexeddbPersistence` lifecycle that every editor adapter (`@pilotiq/tiptap`, `@pilotiq/codemirror`, `@pilotiq-pro/collab`) currently re-implements with the same race-window bug.

```tsx
import { useCollabRoom, useCollabSeed } from '@rudderjs/sync/react'

const room = useCollabRoom(`doc:${id}`, { offline: true })
const seeded = useCollabSeed(room, 'content', (doc, fragment) => {
  const initial = new Y.XmlText()
  initial.insert(0, defaultValue)
  fragment.insert(0, [initial])
})
if (!room || !seeded) return <Placeholder />
```

- **`useCollabRoom(roomKey, options)`** — lazy-imports peers, connects, returns the room when ready. `null` on SSR + while loading. Re-keys on `roomKey` change.
- **`useCollabSeed(room, fragmentKey, seedFn)`** — seeds an empty Y.XmlFragment on first sync, idempotent across peers. `seedFn` captured via ref (no `useCallback` needed).
- **`CollabRoomManager`** — the underlying class, also exported. Pure logic (factory-injectable), no React dep — testable in node without DOM infra.

Peer requirements: `react@>=19.2.0` always; `y-websocket` and `y-indexeddb` are optional peers — install them when you use the hooks.

12 unit tests cover the manager's cancellation matrix (stop-before-start, stop-mid-construction, partial-handle cleanup, idempotent stop, sync-fast-path, factory-rejection cleanup).

Cross-repo migration paths documented in `docs/plans/2026-05-21-sync-react-hooks.md`.
