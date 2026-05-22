# `@rudderjs/sync/react` — `Y.Text` seed + `enabled` option (followup)

**Status:** OPEN 2026-05-22
**Scope:** `@rudderjs/sync/react` — add `useCollabSeedText()` (sibling of `useCollabSeed`) and an `enabled` option to `useCollabRoom`
**Why now:** unblocks the remaining ~30% of `pilotiq/docs/plans/code-quality-sweep.md` Phase 6d (CodeMirror adapter migration + pilotiq-pro `useRecordCollabRoom` simplification)
**Effort:** ~2h implementation + tests, ~30min docs
**Predecessor:** `2026-05-21-sync-react-hooks.md` (the original `useCollabRoom` + `useCollabSeed` plan — shipped at commit 4c56a95e)

---

## Motivation

The 2026-05-21 hook plan covered the dominant case (Tiptap + ProseMirror-style `Y.XmlFragment` seeds). Two real consumer migrations stalled when I tried to land Phase 6d of pilotiq's code-quality sweep:

### Gap 1 — `useCollabSeed` is `Y.XmlFragment`-only

`packages/sync/src/react/useCollabSeed.ts:49` calls `room.ydoc.getXmlFragment(fragmentKey)` unconditionally. That's correct for Tiptap (ProseMirror needs an XmlFragment) but `@pilotiq/codemirror`'s `CollabCodeMirrorEditor` seeds a `Y.Text` (`y-codemirror.next` binds to `Y.Text`):

```ts
// packages/codemirror/src/react/CollabCodeMirrorEditor.tsx:206-211 (pilotiq repo)
useCollabSeed(seedRoom, fragmentKey, (doc) => {
  const yText = (doc as Y.Doc).getText(fragmentKey)
  if (yText.length === 0 && defaultValue) {
    yText.insert(0, defaultValue)
  }
})
```

Calling `doc.getXmlFragment(name)` on a name already bound as `Y.Text` throws / corrupts the doc. CodeMirror can't migrate to the current framework hook — it had to keep using pilotiq core's local `useCollabSeed` shim, which is `(doc: unknown) => void`-typed.

### Gap 2 — `useCollabRoom` has no `enabled` option

`@pilotiq-pro/collab`'s `useRecordCollabRoom` short-circuits when `wsPath` is empty (a panel without a configured `wsPath` should render fields locally, no WS connection):

```ts
// packages/collab/src/useRecordCollabRoom.ts:97-100
if (!wsPath || !roomName) {
  setState(EMPTY_RETURN)
  return
}
```

`useCollabRoom` always starts the manager — there's no way to gate it without rendering branches around the hook (illegal Rules-of-Hooks). The plan's recommended thin-wrapper migration (`return useCollabRoom(scopedKey, { offline: true })`) can't preserve the disable-when-`wsPath`-empty path. Result: `useRecordCollabRoom` stays at the lower `CollabRoomManager` API, which works but never collapses.

This is a known shape — `swr`, `react-query`, `useSWR(key, fetcher, { enabled })` all expose this. The default is `enabled: true`; consumers flip to `false` to suspend until prerequisites are met.

---

## Proposed API

### `useCollabSeedText(room, textKey, seedFn): boolean`

Symmetric sibling of `useCollabSeed`. Binds (and seeds) a `Y.Text` instead of a `Y.XmlFragment`.

```ts
function useCollabSeedText(
  room:    CollabRoom | null,
  textKey: string,
  seedFn:  (doc: Y.Doc, text: Y.Text) => void,
): boolean
```

Semantics — identical to `useCollabSeed` except for the share type:
- Waits for `room.synced`.
- Reads via `room.ydoc.getText(textKey)`.
- Only invokes `seedFn` when `text.length === 0`.
- Wraps the call in `doc.transact(..., 'rudder-sync-seed')` (same origin tag as `useCollabSeed`).
- Returns `true` once the check has run.

The shared bits (ref capture for `seedFn`, cancellation, synced-rejected fallback) extract into a `useSeedShareType` internal helper that both hooks call.

### `useCollabRoom(key, { enabled?: boolean })`

Add `enabled` to `UseCollabRoomOptions`:

```ts
interface UseCollabRoomOptions {
  wsUrl?:    string
  offline?:  boolean
  enabled?:  boolean  // NEW — default true
}
```

Semantics:
- `enabled: false` → hook returns `null` immediately, never constructs a `CollabRoomManager`, never starts the WS connection. The effect's cleanup is a no-op.
- Flipping `enabled` from `false` → `true` triggers the existing mount flow (same deps signal as `roomKey` / `wsUrl` change).
- Flipping `enabled` from `true` → `false` tears down the active room (same cleanup as unmount), returns `null`.
- Server-side render path is unchanged — already returns `null` when `window` is missing.

Backwards-compatible: omitted `enabled` keeps the current "always-on" behavior. Apps that don't pass it see no diff.

---

## Implementation notes

### `useCollabSeedText` — shared scaffold

The existing `useCollabSeed` body is the canonical seed-on-first-sync skeleton. Extract a private helper that takes a `getShare(doc, key) → ShareType` closure:

```ts
type ShareType = YText | XmlFragment

function useSeedShareType(
  room:     CollabRoom | null,
  key:      string,
  getShare: (doc: YDoc, key: string) => ShareType,
  seedFn:   (doc: YDoc, share: ShareType) => void,
): boolean {
  // (current useCollabSeed body, parameterized on `getShare`)
}

export function useCollabSeed(room, fragmentKey, seedFn) {
  return useSeedShareType(room, fragmentKey, (doc, k) => doc.getXmlFragment(k), seedFn)
}

export function useCollabSeedText(room, textKey, seedFn) {
  return useSeedShareType(room, textKey, (doc, k) => doc.getText(k), seedFn)
}
```

Strictly internal extraction — the public API stays two named hooks (consumers reach for the one that matches their share type; one-and-only-one path is easier to grep / read in adapter code than a `kind: 'text' | 'xml'` discriminator).

### `useCollabRoom` — `enabled` plumbing

Two-line change inside the existing effect:

```ts
useEffect(() => {
  if (typeof globalThis.window === 'undefined') return
  if (enabled === false) return  // NEW
  const manager = new CollabRoomManager({ roomKey, wsUrl, offline })
  manager.onRoomChange(setRoom)
  void manager.start()
  return () => { manager.stop() }
}, [roomKey, wsUrl, offline, enabled])  // NEW dep
```

Plus: reset `room` state to `null` when `enabled` flips to `false`. The cleanest place is an explicit branch at the top of the effect (the early-return on `enabled === false` leaves stale state otherwise).

### Default behavior

`enabled` defaults to `true`. The change should be invisible to every current call site.

---

## Tests

In `packages/sync/src/react/__tests__/`:

### `useCollabSeedText.test.ts` (new)

- Seeds an empty `Y.Text` with default content; observes the doc's `Y.Text` post-seed has the expected length + value.
- Skips seeding when the `Y.Text` is non-empty (cold-mount onto a populated room).
- Uses `doc.transact(..., 'rudder-sync-seed')` origin (assertion mirrors the existing `useCollabSeed` test).
- Returns `true` once the check completes.
- Passes a `Y.Text` to the seedFn — verify the param type at compile time by exercising `.insert(0, ...)`.

### `useCollabRoom.enabled.test.ts` (new)

- `enabled: false` → returns `null`, no WS manager constructed (assert via a spy / mock on `CollabRoomManager.start`).
- Flipping `enabled: false → true` → manager starts, room emits.
- Flipping `enabled: true → false` → manager stops, room returns to `null`.
- Default (`enabled` omitted) is unchanged from existing test suite.

---

## Migration path for consumers

### CodeMirror adapter (pilotiq)

`packages/codemirror/src/react/CollabCodeMirrorEditor.tsx` — switch from pilotiq core's `useCollabSeed` to `useCollabSeedText`:

```ts
// Before:
import { useCollabSeed } from '@pilotiq/pilotiq/react'
useCollabSeed(seedRoom, fragmentKey, (doc) => {
  const yText = (doc as Y.Doc).getText(fragmentKey)
  if (yText.length === 0 && defaultValue) yText.insert(0, defaultValue)
})

// After:
import { useCollabSeedText } from '@rudderjs/sync/react'
useCollabSeedText(seedRoom as unknown as FrameworkCollabRoom | null, fragmentKey, (_doc, text) => {
  if (text.length === 0 && defaultValue) text.insert(0, defaultValue)
})
```

Eliminates the `(doc as Y.Doc).getText(...)` cast + manual length check unwrap. Adds `@rudderjs/sync` to `@pilotiq/codemirror` peer deps (mirrors what `@pilotiq/tiptap` already does after `2026-05-22` commit `223eb38`).

### `useRecordCollabRoom` simplification (pilotiq-pro)

`packages/collab/src/useRecordCollabRoom.ts` — collapse the `CollabRoomManager` plumbing into `useCollabRoom({ enabled })`:

```ts
export function useRecordCollabRoom({ wsPath, roomName, panelId, userName, userColor }: ...) {
  const scopedKey = scopeRoomNameWithPanel(roomName, panelId)
  const wsUrl     = useWsUrl(wsPath)
  const room      = useCollabRoom(scopedKey, {
    wsUrl,
    offline: true,
    enabled: !!(wsPath && roomName),
  })

  // …layer awareness writes + setActiveCollabProvider as separate effects on `room`…

  return /* mapped UseRecordCollabRoomReturn shape */
}
```

Removes ~80 LOC and the lower-level `CollabRoomManager` import. Tracked as 6d-A in `pilotiq/docs/plans/code-quality-sweep.md` (currently marked "skipped — framework gap").

---

## Out of scope

- **A `useCollabSeedArray` for `Y.Array`-backed editors** — no current consumer needs it. Add when one shows up.
- **Awareness gating via `enabled`** — when `enabled: false`, awareness is unreachable (no provider). Consumers reading awareness should check `room === null` before subscribing; existing pattern.
- **Idle/visibility-based auto-disable** — apps wanting "disconnect when tab is hidden" should orchestrate that themselves; framework stays mechanism, not policy.

---

## Open questions

1. **Naming — `useCollabSeedText` vs `useCollabTextSeed`?** Prior plan landed on `useCollabSeed`; the `Text` suffix preserves the `useCollabSeed*` prefix grouping. Lean toward `useCollabSeedText` for grep-friendliness.

2. **Should `enabled: false` on `useCollabRoom` also clear the `cachedAutoDark`-style internal state in `CollabRoomManager`?** The manager's `stop()` already handles teardown — confirm there's no surviving listener post-stop. If not, file a separate fix.

3. **Should `useCollabSeed`'s existing share-type assumption be encoded in its name (rename to `useCollabSeedXmlFragment`)?** That's a breaking rename for a hook that just shipped — defer until a `1.x → 2.0` window. For now, document the share-type assumption clearly in the JSDoc; the sibling `useCollabSeedText` makes the distinction discoverable.

---

## Suggested PR plan

1. `feat(sync): useCollabSeedText for Y.Text seeds` — extract `useSeedShareType` helper, add the new hook + tests. No breaking changes.
2. `feat(sync): enabled option on useCollabRoom` — small option addition + tests. No breaking changes.
3. Cut a minor release (`@rudderjs/sync@1.3.0` or `1.2.x` depending on semver policy).
4. Downstream PRs in pilotiq + pilotiq-pro consume the new surface (out of scope for this plan — see the consumer migration paths above).

Both items are mechanically small, ship-as-one-PR-or-split; landing them together lets the consumer migration close in a single sweep.

---

## Strengths of the prior plan (worth preserving)

The 2026-05-21 plan got the lifecycle hooks right on the first try. Real consumer migration only surfaced two narrow gaps — both are additive, neither requires changing existing semantics. The cancellation handling, SSR posture, and `synced` Promise contract all transfer cleanly to both new surfaces.
