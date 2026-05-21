# `@rudderjs/sync/react` — client-side collab room hooks

**Status:** OPEN 2026-05-21
**Scope:** `@rudderjs/sync` — add a new `react` subpath exposing `useCollabRoom()` + `useCollabSeed()`
**Why now:** unblocks Phase 6d of `pilotiq/docs/plans/code-quality-sweep.md` and the cross-repo note in `pilotiq-pro/docs/plans/code-quality-sweep.md`
**Effort:** ~4h implementation + tests, ~1h docs

---

## Motivation

`@rudderjs/sync` ships the server-side collab infrastructure (`SyncProvider`, `syncPrisma`, persistence adapters) and Y.Doc helpers used by `@rudderjs/ai` (`@rudderjs/sync/tiptap`, `@rudderjs/sync/lexical`). What's missing is the **client-side React surface** — the hook that turns a sync room key into a connected `Y.Doc` + `y-websocket` provider + optional `IndexeddbPersistence` handle.

Today every downstream package that needs a client collab room re-implements this lifecycle:

| Consumer | File | LOC |
|---|---|---|
| pilotiq | `packages/tiptap/src/react/TiptapEditor.tsx` | ~50 |
| pilotiq | `packages/tiptap/src/react/MarkdownEditor.tsx` | ~50 |
| pilotiq | `packages/tiptap/src/react/CollabTextRenderer.tsx` | ~40 |
| pilotiq | `packages/codemirror/src/react/CollabCodeMirrorEditor.tsx` | ~50 |
| pilotiq-pro | `packages/collab/src/useRecordCollabRoom.ts` | ~120 |

Each copy has the same shape:

```tsx
useEffect(() => {
  let cancelled = false
  let provider: WebsocketProvider | null = null
  let persistence: IndexeddbPersistence | null = null
  ;(async () => {
    const Y = await import('yjs')
    const { WebsocketProvider } = await import('y-websocket')
    if (cancelled) return
    const doc = new Y.Doc()
    provider = new WebsocketProvider(wsUrl, roomKey, doc)
    if (offline) persistence = new IndexeddbPersistence(roomKey, doc)
    onProviderSynced(provider, () => {
      // empty-fragment seed dance + race-window comment
    })
    setRoom({ ydoc: doc as any, provider: provider as any })
  })()
  return () => {
    cancelled = true
    try { provider?.disconnect() } catch {}
    try { provider?.destroy() } catch {}
    try { persistence?.destroy() } catch {}
  }
}, [roomKey, wsUrl, offline])
```

Same bug surface in each: `cancelled` racing against the awaits, `IndexeddbPersistence` handle potentially leaking, `as any` casts because the room shape isn't typed at the framework boundary.

This is a textbook framework concern: a single client-side lifecycle that every consumer reproduces identically (with the same bugs).

---

## Proposed API

New subpath: `@rudderjs/sync/react`. Mirrors how `@rudderjs/sync/tiptap` is structured (single `index.ts` in `packages/sync/src/react/`, separate `package.json` export entry).

### `useCollabRoom(roomKey, options): CollabRoom | null`

Connects to a sync room and returns the room handle (or `null` while loading / disconnected).

```ts
interface UseCollabRoomOptions {
  /** WebSocket URL; defaults to the SSR-injected sync endpoint */
  wsUrl?: string
  /** Enable IndexedDB persistence for offline-first behavior */
  offline?: boolean
  /** Optional awareness initial state */
  awareness?: Record<string, unknown>
}

interface CollabRoom {
  ydoc: Y.Doc
  provider: WebsocketProvider
  persistence: IndexeddbPersistence | null
  /** Resolves when the provider's initial sync completes */
  synced: Promise<void>
}

function useCollabRoom(
  roomKey: string,
  options?: UseCollabRoomOptions,
): CollabRoom | null
```

Semantics:
- On mount, lazy-imports `yjs` + `y-websocket` (+ `y-indexeddb` if `offline`), constructs the doc + provider, returns the room when ready.
- On `roomKey` / `wsUrl` change, tears down the old room and constructs a new one. Cancellation-safe.
- On unmount, calls `provider.disconnect()` → `provider.destroy()` → `persistence?.destroy()` in a single `try` block.
- Returns `null` while the dynamic imports + handshake are in flight (so consumers can render a placeholder).
- SSR: returns `null` immediately when `typeof window === 'undefined'`, no imports.

### `useCollabSeed(room, fragmentKey, seedFn): boolean`

Seeds a freshly-created Y fragment with default content on first sync. Returns `true` once the seed check has run (whether or not it actually wrote anything), so consumers can defer mount of an editor until the seed is settled.

```ts
function useCollabSeed<T = unknown>(
  room: CollabRoom | null,
  fragmentKey: string,
  seedFn: (doc: Y.Doc, fragment: Y.XmlFragment) => void,
): boolean
```

Semantics:
- Waits for `room.synced` to resolve.
- Checks `doc.getXmlFragment(fragmentKey).length === 0` — only seeds empty fragments.
- Runs `seedFn` inside `doc.transact(...)` with origin `'rudder-sync-seed'` so downstream observers can filter.
- Idempotent across re-mounts (the empty-fragment check is the dedup).
- Returns `true` once the check completes, even if no seed was needed.

This is the abstraction the four pilotiq adapters reproduce with the same race-window comment. Centralizing it lets us fix the race once and document it once.

### Types — no more `as any` at the boundary

Export `Y.Doc` and `WebsocketProvider` types from the subpath:

```ts
export type { Doc as YDoc } from 'yjs'
export type { WebsocketProvider } from 'y-websocket'
```

`@rudderjs/sync` already re-exports `YDoc` from the main entry (line 631 in current `index.ts`). The new subpath should mirror that and add `WebsocketProvider`.

---

## Implementation notes

### File layout

```
packages/sync/
├── src/
│   ├── react/
│   │   ├── index.ts          # exports
│   │   ├── useCollabRoom.ts
│   │   ├── useCollabSeed.ts
│   │   └── useCollabRoom.test.tsx
│   ├── index.ts              # server entry, untouched
│   ├── tiptap/               # untouched
│   └── lexical/              # untouched
```

### `package.json` exports

Add the subpath:

```json
"exports": {
  ".": { ... },
  "./react": {
    "import": "./dist/react/index.js",
    "types": "./dist/react/index.d.ts",
    "default": "./dist/react/index.js"
  },
  "./tiptap": { ... },
  "./lexical": { ... }
}
```

`react` listed as a `peerDependency` (`^19.2.0`, matching the framework's React floor). `y-websocket` and `y-indexeddb` stay `optionalDependencies` — lazy-loaded inside the hook, so SSR-only consumers don't pay the cost.

### Lazy imports

Keep the current pattern: `yjs` is already a direct dep of `@rudderjs/sync`; `y-websocket` and `y-indexeddb` are dynamically imported on first use. This is what the consumers do today; moving it into the hook doesn't change the bundle posture.

### Cancellation-safe effect

The bug all five copies share: `cancelled` is a closure boolean that's checked after each `await`, but `IndexeddbPersistence` is constructed *synchronously* after the WebsocketProvider — if cancellation lands between the two, the persistence handle is created and never destroyed.

Fix in the framework hook: track all handles in a single ref, and have cleanup destroy whatever's been written so far. Don't rely on the post-`await` flag dance:

```ts
const handlesRef = useRef<{ ydoc?: Y.Doc; provider?: WebsocketProvider; persistence?: IndexeddbPersistence }>({})

useEffect(() => {
  const handles = handlesRef.current = {}
  let cancelled = false
  ;(async () => {
    const Y = await import('yjs')
    if (cancelled) return
    handles.ydoc = new Y.Doc()
    const { WebsocketProvider } = await import('y-websocket')
    if (cancelled) return
    handles.provider = new WebsocketProvider(wsUrl, roomKey, handles.ydoc)
    if (offline) {
      const { IndexeddbPersistence } = await import('y-indexeddb')
      if (cancelled) return
      handles.persistence = new IndexeddbPersistence(roomKey, handles.ydoc)
    }
    // ... resolve synced promise, call setRoom
  })()
  return () => {
    cancelled = true
    try { handles.provider?.disconnect(); handles.provider?.destroy() } catch {}
    try { handles.persistence?.destroy() } catch {}
    try { handles.ydoc?.destroy() } catch {}
  }
}, [roomKey, wsUrl, offline])
```

The shared-ref pattern means the cleanup can run even if `cancelled` flipped between two awaits — whatever handles were assigned by that point get cleaned up.

### Awareness reporter integration

`@pilotiq-pro/collab` has a `fieldFocusReporter` that depends on knowing the active provider for awareness updates. The hook should surface the provider so consumers can wire awareness from outside, but not couple the two — `useCollabRoom` returns `{ provider, ... }`; `fieldFocusReporter` stays in pilotiq-pro and reads from there. No new framework dependency on awareness reporting.

### SSR safety

`typeof window === 'undefined'` short-circuit at the top of the effect (no `import()` calls). The hook returns `null` on the server and on the first client render before the effect runs. Consumers handle the `null` case with a placeholder — which the current pilotiq code already does, so no consumer-side change needed.

---

## Tests

Place tests in `packages/sync/src/react/useCollabRoom.test.tsx`. Use `@testing-library/react` + `happy-dom` (sync package already has dev tooling for this — check `package.json`; add if missing).

Coverage:

1. **Happy path** — `useCollabRoom('room-1')` returns `null` initially, then a `CollabRoom` with a connected provider once dynamic imports + handshake complete.
2. **Unmount during async** — render, unmount immediately (before imports resolve), assert no provider was constructed (or if constructed, was destroyed).
3. **Room key swap** — render with `room-1`, change to `room-2`, assert the first provider was destroyed before the second was constructed.
4. **SSR** — call the hook outside a browser context (mock `typeof window`), assert it returns `null` and triggers no imports.
5. **Offline mode** — `useCollabRoom('room', { offline: true })`, assert `room.persistence !== null` and is destroyed on unmount.
6. **`useCollabSeed` seeds empty fragment** — render, await synced, assert `seedFn` was called inside a transaction.
7. **`useCollabSeed` skips non-empty fragment** — pre-populate the fragment, render, assert `seedFn` was NOT called.
8. **`useCollabSeed` idempotency** — re-render the component, assert `seedFn` is not called twice.

Mock `y-websocket` and `y-indexeddb` — these tests don't need a real WS server. The integration with real Yjs happens in pilotiq's playground smoke + the existing server-side sync tests.

---

## Migration path for consumers

Once shipped:

### pilotiq adapters

Replace the inline lifecycle in each of:
- `packages/tiptap/src/react/TiptapEditor.tsx`
- `packages/tiptap/src/react/MarkdownEditor.tsx`
- `packages/tiptap/src/react/CollabTextRenderer.tsx`
- `packages/codemirror/src/react/CollabCodeMirrorEditor.tsx`

With:

```tsx
import { useCollabRoom, useCollabSeed } from '@rudderjs/sync/react'

const room = useCollabRoom(roomKey, { offline: true })
const seeded = useCollabSeed(room, fragmentKey, (doc, fragment) => {
  // existing seed logic, no race-window comment needed
})
if (!room || !seeded) return <Placeholder />
```

Removes the `as any` casts (the hook returns typed handles) and ~50 LOC per file. Tracked as Phase 6d in `pilotiq/docs/plans/code-quality-sweep.md`.

### pilotiq-pro collab

`packages/collab/src/useRecordCollabRoom.ts` currently does all of the above plus record-key scoping. Refactor to:

```ts
export function useRecordCollabRoom(recordKey: string) {
  const roomKey = scopedKey(recordKey)  // existing pilotiq-pro scoping
  return useCollabRoom(roomKey, { offline: true })
}
```

Removes ~100 LOC. Tracked in the cross-repo note at the top of `pilotiq-pro/docs/plans/code-quality-sweep.md` Phase 4.

---

## Out of scope

- **Server-side room mutation hooks** (`useCollabUpdate`, etc.) — server-side already has helpers in `@rudderjs/sync/tiptap` and `@rudderjs/sync/lexical`. The React hooks are purely connection lifecycle.
- **Awareness API surface** — `provider.awareness` is exposed on the returned room; consumers wire awareness themselves. A dedicated `useAwareness()` hook can come later if a pattern emerges.
- **Field-focus reporter / multi-room presence aggregation** — that's `@pilotiq-pro/collab` territory; stays out of the framework.
- **Lexical-specific hook variants** — Lexical's collab story is different (richer awareness needs); deal with it when a real consumer asks. Tiptap + CodeMirror cover the immediate case.

---

## Open questions

1. **Should `useCollabRoom` accept a pre-constructed `Y.Doc`?** Some advanced consumers (snapshot replay, agent-driven docs) might want to bring their own doc. Default: no, the hook owns the doc lifecycle. Add `{ doc?: Y.Doc }` only if a real use case appears.

2. **Should `useCollabSeed` take a generic `seedFn(doc)` instead of `(doc, fragment)`?** The fragment-keyed version is what 100% of current consumers want; the doc-only form is a stretch. Ship the fragment-keyed form; widen later if needed.

3. **Awareness cleanup on unmount** — `provider.awareness.setLocalState(null)` before disconnect is the polite move. Do this in the hook by default? Lean yes — silent in-room ghost users are a known annoyance.

---

## Suggested PR plan

Single PR — this is a cohesive new surface:

- `feat(sync): @rudderjs/sync/react with useCollabRoom + useCollabSeed`
- Changeset: minor bump (new public API)
- Touches: `packages/sync/src/react/*`, `packages/sync/package.json`, `packages/sync/CLAUDE.md` (brief subpath note), `docs/guide/sync.md` (small section)
- Tests: 8 cases listed above
- No changes to existing `@rudderjs/sync` exports — pure addition

Cross-repo follow-ups (separate PRs after framework ships):
1. `pilotiq` Phase 6d — swap adapters to use the hooks
2. `pilotiq-pro` — refactor `useRecordCollabRoom` to consume the hook
