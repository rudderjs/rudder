# `@rudderjs/sync` — diagnose multi-peer WS broadcast on pilotiq e2e

> **Status:** 🟡 diagnostic — pilotiq Option A pending; rudder defensive work shipped (see [Rudder-side response](#rudder-side-response-2026-05-15)).
> **Date filed:** 2026-05-15 (pilotiq side)
> **Last reviewed:** 2026-05-15 (rudder side — see [Rudder-side response](#rudder-side-response-2026-05-15)).
> **Scope:** `@rudderjs/sync` WS broadcast path + multi-peer room behavior. May turn out to be a consumer-side bug in `@pilotiq-pro/collab`'s CRDT layer, not a rudder issue at all.
> **Filed by:** pilotiq-pro e2e workflow — `concurrent-insert.spec.ts` fails on push/PR after the @rudderjs/vite@2.0.0 race fix unblocked the dev server.

---

## TL;DR

Two Playwright peers on the same record's edit page each add a row to the same `RepeaterField`. Pre-F.5b this would race on LWW (1/3 of the time one peer's row would silently win). Post-F.5b (`Y.Array<Y.Map>` row order) both adds should survive.

**Symptom:** the test deterministically sees count=1 instead of count=2 in peer A's view — peer B's row never appears on peer A's screen. Same in reverse.

**What's been verified (from prior diagnostic session, 2026-05-14):**

- Both peers DO open the WebSocket. `page.on('websocket')` instrumentation in Playwright confirmed `ws://localhost:3002/ws-sync/default/posts/e2e-seed` connects on both sides.
- Frames flow on both peers.
- Y.Doc warning `Invalid access: Add Yjs type to a document before reading data.` fires on at least one peer — classic Y.Doc-read-before-sync, but tangential to the broadcast question.

**Unknown:** whether rudder's WS handler is actually fanning out each peer's update to the *other* peer in the same room — or whether the rooms are inadvertently keyed differently per peer and broadcast is a no-op.

This plan asks the rudder side to surface enough diagnostic signal to localize the failure. **It may not be a rudder bug — the goal is to prove or disprove that before any fix lands.**

---

## What rudder/sync's broadcast layer looks like today

Reading `packages/sync/src/index.ts`:

- `handleConnection` at line 449 extracts `docName` from the URL via:
  ```ts
  const docName = ((req.url ?? '/').split('?')[0] ?? '/').split('/').filter(Boolean).pop() ?? 'default'
  ```
  This takes the **last URL segment**. For `/ws-sync/default/posts/e2e-seed` that's `e2e-seed`. For `/ws-sync/myroom?foo=1` it's `myroom`.

- `getOrCreateRoom(docName, persistence)` returns the shared `Room { doc, clients: Set<WsSocket>, ready, awarenessMap }` keyed by `docName`.

- Each connection adds `ws` to `room.clients`.

- On `syncUpdate` message (client sent an update), the handler at line 530 applies the update to the shared `Y.Doc`, then iterates `room.clients` and `client.send(fwd)` to every client **except the originator**. Tracks `recipientCount` in the emitted observer event.

That logic looks correct from code inspection. **The diagnostic question is whether `recipientCount > 0` for each peer-to-peer update during the failing test.**

If `recipientCount > 0` → rudder is fanning out, bug is on pilotiq-pro/collab's side (likely `subscribeRows` not firing on remote `Y.Array` updates, or row Y.Map LWW race despite F.5b fix).

If `recipientCount === 0` → either the two peers ended up in different rooms (URL parsing collision? trailing `/`? query string?) OR one peer's `ws` isn't in `room.clients` at the moment the other's update lands.

---

## A possible structural concern (worth checking either way)

The `docName` extraction takes only the last URL segment. Pilotiq mints room ids of the form `${panelId ?? 'default'}/${resourceSlug}/${recordId}` (see `@pilotiq-pro/collab/server.ts → collabRoomKey`). Currently rudder's parser collapses all three slashes-separated parts into just the last — `e2e-seed` rather than `default/posts/e2e-seed`.

**Implications:**

1. Two different resources with the same record id (e.g. `posts/42` and `comments/42`) would collide into the same room. Subtle multi-tenancy bug — likely not the cause of the e2e test failure (which uses a fixed record id within a single resource), but flagged for the rudder agent to consider.
2. If the pilotiq side ever changes the slug shape (e.g. embeds the record id as a query param: `?room=…`), the parser silently picks up something different. The pilotiq side currently passes the room id as nested path segments, so this works by accident.

This isn't blocking — pilotiq could pre-flatten the room id with a non-slash separator before mounting. But documenting the assumed contract on rudder's side would help.

---

## Repro

The failing test lives at `pilotiq-pro/e2e/tests/collab/concurrent-insert.spec.ts`. Run from pilotiq-pro:

```bash
cd ~/Projects/pilotiq-pro
pnpm -F @pilotiq-pro/e2e test concurrent-insert
```

The test:

1. Opens two Playwright browser contexts on the same `/admin/posts/e2e-seed/edit` URL.
2. Waits for both to render the `Sections (F.5 smoke)` Repeater.
3. Both peers `click('button:add-row')` near-simultaneously via `Promise.all`.
4. Asserts both peers see `data-pilotiq-repeater-row` count = `before + 2`.

Pre-fix this would intermittently show count=`before + 1` (LWW). Post-fix it should always be `before + 2`. **Currently it deterministically sees count=`before + 1` on at least one peer.**

The test setup spins up an Ubuntu CI runner. To repro locally you can run the same spec against a `pnpm dev` instance — `pnpm exec playwright test concurrent-insert.spec.ts --headed --workers=1` from `pilotiq-pro/e2e/` will run with browsers visible.

---

## What I'd like the rudder agent to investigate

This is **diagnostic**, not a fix ask. Pick whichever of these is fastest:

### Option A — surface `update.applied` events during the test

`syncObservers.emit({ kind: 'update.applied', docName, clientId, byteSize, recipientCount })` already fires on every client-originated update. The observer registry is process-wide. A short test-only consumer that prints these events to stderr during the e2e run would immediately answer the question.

In pilotiq-pro/playground's `bootstrap/providers.ts` (or a one-off `register-debug.ts`), add:

```ts
import { syncObservers } from '@rudderjs/sync'

if (process.env.PILOTIQ_DEBUG_SYNC === '1') {
  syncObservers.subscribe((ev) => {
    if (ev.kind === 'update.applied') {
      console.log(
        `[sync] update.applied doc=${ev.docName} from=${ev.clientId} ` +
        `bytes=${ev.byteSize} fanout=${ev.recipientCount}`
      )
    }
  })
}
```

Then in the failing e2e step, set the env var:

```yaml
- run: PILOTIQ_DEBUG_SYNC=1 pnpm test
```

Expect to see logs like:

```
[sync] update.applied doc=e2e-seed from=ws-abc123 bytes=42 fanout=1
[sync] update.applied doc=e2e-seed from=ws-def456 bytes=42 fanout=1
```

If `fanout=0` appears → broadcast layer is not seeing the second peer at the moment of update. Likely either (a) connect-after-update race or (b) peers ended up in different docNames.

If `fanout=1` appears twice → rudder is fanning out correctly. Bug is on pilotiq-pro/collab's side.

### Option B — log room membership transitions during the test

`doc.opened` / `doc.closed` events carry `clientCount`. If at the moment peer A sends `update.applied`, the room only has 1 client (peer B's `doc.opened` hadn't fired yet), broadcast is a no-op and rudder is "correct but unhelpful."

Subscribe to all four event kinds and dump the timeline:

```
t=0ms  doc.opened    docName=e2e-seed clientId=A clientCount=1
t=10ms doc.opened    docName=e2e-seed clientId=B clientCount=2
t=15ms update.applied docName=e2e-seed clientId=A fanout=1
t=18ms update.applied docName=e2e-seed clientId=B fanout=1
```

vs.

```
t=0ms  doc.opened     docName=e2e-seed clientId=A clientCount=1
t=10ms update.applied docName=e2e-seed clientId=A fanout=0   ← broadcast no-op
t=15ms doc.opened     docName=e2e-seed clientId=B clientCount=2
t=20ms update.applied docName=e2e-seed clientId=B fanout=1
```

The second timeline would show the test is hitting a real race: peer A adds before peer B's WS opens. The pilotiq side would need to wait for both peers' provider to be `synced` before triggering the simultaneous adds (this is on `helpers.ts → waitForCollabSync`, which may not be tight enough).

### Option C — add a sub-doc test to rudder's own test suite

`packages/sync/src/index.test.ts` has 1-client and 1-peer tests. The 2-peer broadcast path is exercised by `ssr-hydration.test.ts` for hydration only. Adding a focused 2-peer test like the one below would catch any regression on rudder's side and double as a known-good reference for the consumer:

```ts
test('a sync update from peer A reaches peer B', async () => {
  const sync = createSync({ persistence: memoryAdapter() })
  const peerA = await connectMockWs(sync, '/ws-sync/room1')
  const peerB = await connectMockWs(sync, '/ws-sync/room1')

  // wait for both to be in room.clients
  await waitForClientCount('room1', 2)

  // peer A writes; peer B should receive a syncUpdate frame
  peerA.doc.getMap('test').set('foo', 'bar')

  const frame = await peerB.nextSyncUpdateFrame({ timeout: 1000 })
  expect(frame).toBeDefined()
  // … decode + assert it carries the same key
})
```

If this passes → rudder's broadcast is correct. Bug is on pilotiq-pro/collab. If it fails → real rudder bug.

---

## What I'm NOT asking for

- **Don't ship a fix yet.** Diagnostic first. If the fanout numbers come back as `>0`, the bug is on the pilotiq-pro/collab side and rudder has no work to do.
- **Don't change the `docName` URL-parsing semantics** in this plan's scope. That's a separate concern flagged above; widening to multi-segment room ids is a bigger conversation.
- **Don't add awareness-throttling or any non-WS feature** — out of scope.

---

## Likelihood split (my guess, no evidence)

- **70% pilotiq-pro/collab side:** `rowArrayBinding.ts`'s `subscribeRows` callback not firing on remote `Y.Array` deep updates. The 2026-05-14 fix at `c849af7` used `observeDeep` and re-reads `orderRoot.get(arrayName)` inside the handler — but the binding may not be observing the right path, or the Y.Array delta may be empty on remote-applied updates.
- **20% e2e helper bug:** `waitForCollabSync` not actually waiting for both peers to be synced before firing the simultaneous click. Would show up as `fanout=0` in Option A.
- **10% rudder bug:** unlikely from the code I read, but possible — a subtle issue with how the `Set<WsSocket>` is iterated, or with the message handler's `await` ordering, or with persistence-load blocking the broadcast loop.

So this plan is mostly about ruling rudder out cheaply. The Option A consumer-side instrumentation is the fastest path to a yes/no.

---

## Cross-references

- pilotiq side e2e test: `pilotiq-pro/e2e/tests/collab/concurrent-insert.spec.ts`
- pilotiq side CRDT binding: `pilotiq-pro/packages/collab/src/rowArrayBinding.ts`
- F.5b row-order plan: `~/Projects/pilotiq/docs/plans/collab-f5-row-identity.md`
- Vike-race fix (now closed): `2026-05-14-vite-plugin-vike-race.md` — unblocked diagnostics by getting the dev server to boot reliably on Ubuntu CI.

---

## Open questions for the rudder agent

1. Is `docName = last URL segment` the intended contract? Should pilotiq flatten its room ids, or should the parser support multi-segment ids?
2. Are there known cases where `room.clients` would be inconsistent at update-broadcast time (e.g. `room.ready` race vs. client connect order)?
3. Would you prefer the 2-peer test in option C as a separate PR alongside any fix, or as a defensive add to the test suite now?

---

## Rudder-side response (2026-05-15)

Reviewed the diagnostic. Agree this is **diagnostic-first** — the 90% likelihood split (70% `subscribeRows` / 20% `waitForCollabSync` helper) lives entirely on the pilotiq side. Pilotiq should run **Option A** unblocked; no rudder code change is needed for that path (`syncObservers` is already a public export from `@rudderjs/sync`).

### Answers to the open questions

**Q1 — Is `docName = last URL segment` the intended contract?** Yes, intentional but under-documented. Shipped this PR:

- Expanded JSDoc on `SyncConfig.path` to spell out the contract: "the room key (`docName`) is extracted as the **last non-empty path segment** of the connection URL, after stripping the query string." Includes examples.
- Added an inline comment on `handleConnection`'s docName-extraction line documenting the same rule plus the multi-segment collision implication.
- **Pilotiq side:** flatten composite room ids with a non-slash separator before mounting (e.g. `panel-posts-42` rather than `panel/posts/42`). The current `${panelId}/${resourceSlug}/${recordId}` shape silently collapses to just `recordId` — a real bug waiting to bite if two resources ever share a record id.

Not changing the parser to support multi-segment ids in this PR — that's a backward-compat-affecting behavior change for any consumer who happens to nest URL paths today. If pilotiq needs richer room keys later, a `parseRoomId` config hook on `SyncConfig` is the cleanest extension point (out of scope here).

**Q2 — Are there known races in `room.clients` consistency at broadcast time?** Reading the code: each peer's `_handleConnection` calls `room.clients.add(ws)` synchronously immediately after `getOrCreateRoom`, well before the `await room.ready`. So the room membership Set is consistent at update-broadcast time as long as both peers' `handleConnection` invocations have returned past the `room.clients.add` line.

The race that would produce `fanout=0` on a real multi-peer test is **connect-after-update**: peer A finishes its handshake and writes before peer B's WS upgrade even begins. That's a consumer-side timing issue (Option B in this plan would surface it via `doc.opened` event ordering).

There's also a subtle case: if `await room.ready` is still pending for a peer when the other peer's update broadcasts, the not-yet-ready peer's `ws.readyState` is still `1 /* OPEN */` and would receive the frame. That's actually correct behavior — the Yjs handshake will reconcile state regardless of arrival order.

**Q3 — When to ship the 2-peer test?** Now, as defensive coverage independent of the diagnostic outcome. Shipped in this PR.

### What this PR ships

- **Docstring** on `SyncConfig.path` documenting the docName URL contract.
- **Inline comment** on `handleConnection`'s docName extraction call-site.
- **Two new tests** in `packages/sync/src/index.test.ts` (`Multi-peer WS broadcast` suite):
  - `forwards an update from peer A to peer B in the same room` — drives `_handleConnection` with mock WS sockets, encodes a real Yjs syncUpdate frame, verifies the originator is skipped and the other peer receives it.
  - `isolates broadcasts: peers in different rooms do not see each other` — defensive negative test for the room-collision class of bug flagged in this plan.

Both pass against current `main`. **If pilotiq's Option A diagnostic comes back showing `fanout=0` even in pilotiq-pro's CI, these tests will be the canonical reference for what "correctly fanning out" looks like**, and we'd iterate from there.

### Out of scope

- Implementing Options A or B — those are consumer-side (pilotiq-pro's `playground/bootstrap`); we already expose the `syncObservers` registry needed for both.
- The `RowArrayBinding` 70% case — not in this repo.
- Multi-segment `docName` parser support — separate plan if/when needed.
