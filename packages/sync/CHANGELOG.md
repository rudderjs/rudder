# @rudderjs/sync

## 1.10.0

### Minor Changes

- 34d4659: feat(sync): collaborative row-array binding (repeatable rows with stable identity + reorder)

  Add a row-array collab binding for an **array of records** (a repeater, an editable table, a list of objects), the case the existing `scalar` / `text` / flat-`array` / `map` field bindings don't cover. It decouples data from order across two shares: `row-data` (`Y.Map<arrayName, Y.Map<rowId, Y.Map<field, value>>>`) holds each row keyed by a stable id (a generated UUID, or a DB primary key you pass in), and `row-order` (`Y.Map<arrayName, Y.Array<rowId>>`) holds the sequence. A row map is attached once and never moves, so a reorder only delete+inserts the plain `rowId` string in the order array. That stays lossless, where a naive delete+insert of an array of objects would throw away the moved row's per-field merge history. Non-text values use whole-value LWW. Both shares live in the same `Y.Doc` as the field bindings, so they persist over the existing transport with no schema or server change.

  `@rudderjs/sync/collab` exports framework-free primitives: `readRows` / `readRow`, `addRow`, `removeRow`, `moveRow`, `setRowField` / `updateRow`, `seedRows`, `observeRows`, `newRowId`. `@rudderjs/sync/react` adds `useCollabRows(room, arrayName)`, the row counterpart to `useCollabField`: it returns the rows in order plus a referentially-stable `{ add, remove, move, setField, update }` mutation API, and re-renders on any add / remove / reorder / field edit.

## 1.9.0

### Minor Changes

- bbe2af7: Add client-side collab presence to `@rudderjs/sync/react`.

  The React layer managed the Y.Doc + WebSocket lifecycle but exposed nothing for presence/awareness, so every consumer re-derived the same Yjs gotchas. This adds the client mirror of the server-side awareness helpers:

  - **Auth-denial reconnect-stop.** `useCollabRoom` / `CollabRoomManager` now detect a WS close with an auth-denied code (4401/4403 from the server's `onAuth` gate), disconnect instead of letting y-websocket reconnect ~10x/second, and return a `null` room. A new `onDenied` option on `useCollabRoom` surfaces the verdict so the UI can tell "denied" apart from "still connecting".
  - **`useCollabPresence(room, user)`** mirrors the local `{ name, color }` onto awareness, with `collabColorFromSeed(seed)` deriving a deterministic `#rrggbb` color (hex, because Tiptap's CollaborationCaret rejects `hsl(...)`).
  - **`useReportAwarenessField(room, key, value)`** writes a value into local awareness (clearing on change/unmount); **`useAwarenessField(room, key)`** reads remote peers holding a non-null value for that key (local excluded, deduped, `queueMicrotask`-deferred, re-rendering only on a real change). **`useFieldPresence(room, fieldName)`** is the convenience for per-field "who's editing this".
  - `computeAwarenessPeers` is exported as a pure, testable reducer.

- 626491f: Add `createCollabRoomSeeder` to `@rudderjs/sync/collab` — first-connect record seeding for record-backed collaboration.

  `SyncConfig.onFirstConnect` fires once per room, after persistence hydrates the `Y.Doc` and before the first client receives the initial state — the moment to seed an empty doc from a database record. `createCollabRoomSeeder` is the seeding counterpart to `createCollabRoomAuth`: it parses the room, resolves the backing resource, loads the record, projects it to a field map, and writes it into the doc only if the doc is still empty.

  The seed resource is duck-typed (`find(id)` + `seed(record)`) — no hard `@rudderjs/orm` dependency, and one object can satisfy both builders (add `seed` alongside `find`/`canView`). The write is idempotent and race-safe (single gated `doc.transact`), fail-soft on absence (unparsed room / unresolved resource / missing record / empty projection all skip) and fail-loud on error (a `find`/`seed` throw propagates so the framework retries on the next connection). Configurable `mapName` (default `'fields'`) and transact `origin` (default `'rudder-sync-seed'`).

- c9e9bb4: feat(sync): form-collab bindings (form-field ↔ share-type mapping)

  Add field bindings that map a form field to the Yjs share type that backs it, so a structured form edits collaboratively. A `CollabFieldBindings` descriptor (`'scalar' | 'text' | 'array' | 'map'`, with an optional per-field `validate` predicate) declares the layout; it lives on a `CollabSeedResource`'s new `fields` property, so one resource drives auth, seeding, and share-type routing.

  - `createCollabRoomSeeder` now routes each seeded value into the share its binding names — `text` → a dedicated `Y.Text`, `array` → a `Y.Array`, `map` → a nested `Y.Map`, `scalar` (the default) → an entry in the shared fields map. Scalars seed as a group gated on the shared map being empty (unchanged idempotence); each non-scalar share gates on its own emptiness, all in one origin-tagged transaction. A value the validator rejects is skipped (fail-soft). Resources without `fields` keep the flat scalar-only behavior.
  - New `useCollabField` hook in `@rudderjs/sync/react` two-way binds a form input to its share for the value-shaped types (`scalar` / `array` / `map`): reads the current value, re-renders on peer changes, and returns a setter that validates then writes (returning `false` on rejection). Collaborative-string `text` fields bind through an editor (`useCollabSeedText`) and are excluded at the type level.

  The contract is duck-typed with no `@rudderjs/orm` or form-schema dependency, the same posture as `createCollabRoomAuth` / `createCollabRoomSeeder`.

## 1.8.0

### Minor Changes

- c53e1ff: Add `createCollabRoomAuth`, a record-backed collaboration authorization builder at `@rudderjs/sync/collab`. It returns a `SyncConfig['onAuth']` handler that gates each WebSocket upgrade against the record behind the room — parse the room id, resolve the authenticated user, load the record, apply a `canView` policy — closing the collab IDOR where every `resource:recordId` room is otherwise world-open. The record contract is duck-typed (`find` + `canView`), so it stays adapter-agnostic with no hard `@rudderjs/orm` dependency. Fail-closed at every gap, with optional builder-wide or per-resource guest admission. Also exports `SyncAuthRequest` (the `onAuth` request shape) and `defaultParseCollabRoom`.

## 1.7.0

### Minor Changes

- e028ce4: Add `composeRoomId` / `parseRoomId` helpers for collision-safe composite room ids.

  The server derives the Y.Doc room name as the last non-empty path segment of the connection URL, so a slash-joined composite id like `panel/posts/42` silently collapses to `42`, and two resources sharing a record id (`posts/42` and `comments/42`) would land in the same room. The `SyncConfig.path` JSDoc told you to flatten ids by hand but shipped no helper, so every consumer reinvented a separator scheme.

  `composeRoomId(segments, separator?)` joins parts with a non-slash separator (default `':'`) and throws if any segment contains a slash or the separator, so a collision can never slip through silently. `parseRoomId` is the inverse. `DEFAULT_ROOM_SEPARATOR` is exported too.

  ```ts
  import { composeRoomId, parseRoomId } from "@rudderjs/sync";

  const room = composeRoomId(["default", "posts", "42"]); // 'default:posts:42'
  parseRoomId(room); // ['default', 'posts', '42']
  ```

### Patch Changes

- 7c9585f: Fix ghost users lingering in presence after a peer disconnects.

  The internal varint reader decoded values with 32-bit signed bitwise math (`result |= (byte & 0x7f) << shift`). Yjs client ids are random uint32, so any id with bit 28 or higher set overflowed and decoded to the wrong number. Live awareness still appeared correctly because the server relays raw awareness bytes, but the disconnect-removal frame is re-encoded from the decoded client id, so it targeted a non-existent id and never dropped the real client. The result: closing one window left a ghost user in every other window's presence list.

  `readVarUint` now decodes with overflow-safe arithmetic (correct to 2^53), and `writeVarUint` is hardened symmetrically. Awareness removal on disconnect now carries the correct client id, so peers leave presence immediately.

## 1.6.1

### Patch Changes

- 5be40d1: Fix a sync WebSocket connection failure crashing the whole process. `wss.on('connection')` invoked the connection handler fire-and-forget (`void handleConnection(...)`), and the handler has unguarded steps before its own try/catch — room setup, the `doc.opened` observer fan-out, and message-handler wiring. A throwing observer or a synchronous setup failure there rejected the floating promise, which Node 15+ surfaces as an unhandled rejection that terminates the process, taking every connected document down with it. The handler is now wrapped so any such rejection fails closed in keeping with the rest of the sync layer: it surfaces as a `sync.error` observer event (`op: 'connection'`) and closes that one socket cleanly (code 1011) so the client retries, instead of crashing the server.
- Updated dependencies [7f42787]
  - @rudderjs/core@1.12.3

## 1.6.0

### Minor Changes

- f8ed06b: feat(sync): run `onAuth` inside the framework's WS-upgrade context runner

  `onAuth` (enforced on every WS upgrade since #1011) ran with no request-scoped context, so the idiomatic resolver `() => Auth.user()` returned `null` — apps had to hand-roll cookie → session → user parsing to authorize a collab room by identity.

  `handleConnection` now routes `onAuth` through `globalThis['__rudderjs_ws_context_runner__']` when the framework registered it (`@rudderjs/core` ≥ this release, at app boot). The runner establishes the same session + auth `AsyncLocalStorage` scopes an HTTP request gets, so `Auth.user()` / `Session.*` resolve inside `onAuth` exactly as in a controller — no app-side parsing, no new `@rudderjs/sync` dependency (just a `globalThis` read).

  Backward compatible: standalone sync (no server adapter → no runner registered) keeps calling `onAuth` raw. Fail-closed is preserved end to end — a runner error, a context-middleware throw, or an `onAuth` rejection all deny and close the socket with WS code 4401.

### Patch Changes

- Updated dependencies [26e134b]
  - @rudderjs/core@1.12.0

## 1.5.1

### Patch Changes

- a71436e: fix(sync): enforce the `onAuth` callback on WebSocket connections

  `SyncConfig.onAuth` was declared, documented, and unit-tested in isolation — but the server never invoked it. Every WebSocket upgrade joined its room based on the URL path alone, so multi-tenant apps that supplied `onAuth` to scope collab rooms per user were silently unprotected: any reachable client could read **and** write any document's `Y.Doc` by guessing its room id (an IDOR across the entire sync surface).

  `onAuth` now runs in `handleConnection` **before** the socket joins the room, fires the first-connect seed (which reads the backing DB row), or is sent any state vector — so a denied client observes nothing. Enforcement is fail closed: a `false` return, a thrown error, or a rejected promise all deny, closing the socket with WS code 4401. The callback receives the same resolved `docName` the room join uses (shared extraction), preventing authorize-one-room / join-another divergence. Apps that don't set `onAuth` are unaffected (connections remain open to all, as before).

## 1.5.0

### Minor Changes

- 940406d: New `syncDatabase()` persistence driver — stores the Yjs update log through the app's active ORM adapter (`app().make('db')`), making durable sync a first-party option on the native engine (and working unchanged on the Prisma/Drizzle adapters). Shares the adapter's existing connection, defaults to the same `syncDocument` table layout as `syncPrisma()`, wraps updates as Buffers for driver compatibility, keeps a bounded LRU doc cache, and tolerates a missing table on reads so `rudder migrate` can boot the app before the table exists. A ready-made native migration ships under the existing `sync-schema` vendor:publish tag.

  Also fixes `sync:clear <doc>` / `sync:inspect <doc>` reading their `<doc>` argument from the wrong shape — both commands operated on `undefined` (sync:clear deleted nothing while printing success).

- 3c8e059: `SyncProvider` now registers a `sync-schema` publish group: `pnpm rudder vendor:publish --tag=sync-schema` drops the `SyncDocument` Prisma model into `prisma/schema/` (then `pnpm rudder migrate`). The model name is load-bearing — the delegate must be `syncDocument`, `syncPrisma()`'s default. Prisma-only: redis/in-memory persistence need no schema. Previously the docs referenced this tag but nothing registered it, so the documented one-command setup errored with "No publishable assets found".

### Patch Changes

- Updated dependencies [87783f7]
- Updated dependencies [940406d]
  - @rudderjs/core@1.8.0

## 1.4.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [7e6dc85]
  - @rudderjs/core@1.7.0

## 1.3.4

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/core@1.5.1

## 1.3.3

### Patch Changes

- afe56f5: fix(sync): bound prisma sync doc caching, serialize concurrent first-connect joins, and encode sync subtype as varint

## 1.3.2

### Patch Changes

- 9110ae3: Reuse the sync persistence across dev HMR re-boots. `SyncProvider.register()` rebuilds `cfg.persistence` (e.g. `syncRedis()`) on every `app/` edit as the config module re-evaluates, so its lazy ioredis client opened a fresh connection on the next doc op and leaked the previous one. Persistence is now resolved through sync's `syncGlobal` get-or-create slot, so the first instance wins and later per-boot ones stay inert (never connect). No-op in production (single boot). (The WebSocket server is still rebuilt per re-boot — benign: `noServer`, no pinning timer, GC-reclaimable — and is left untouched here because it's entangled with the order-sensitive cross-package upgrade-handler chain; tracked as a separate follow-up.)
- Updated dependencies [6f3cb2a]
  - @rudderjs/core@1.4.0

## 1.3.1

### Patch Changes

- ac45a61: Real-time correctness sweep — four bugs in the WebSocket / broadcast layer surfaced by an under-audited-tier review:

  - **`@rudderjs/sync` — ghost users on disconnect.** When a peer disconnected (refresh, tab close, network drop), the server only cleaned its own maps. Other peers never learned the user had left, so `Awareness.getStates()` kept the ghost user until the y-protocols 30s outdated-timeout — or forever if the client never refreshed their awareness clock. The fix tracks per-socket Y.js clientIDs as awareness frames arrive and synthesizes a null-state awareness message to remaining peers on close. Surfaces immediately in the playground demo (`/demos/sync`) — refresh no longer bumps the "Active users" count.
  - **`@rudderjs/sync` — unhandled rejection in async message handler.** The `ws.on('message', async (raw) => …)` body had no outer try/catch — a malformed Y frame (truncated varuint, bogus Y.applyUpdate input) became an unhandled promise rejection with no socket-level recovery. The fix wraps the body in try/catch and emits a `sync.error` observer event with `op: 'message'`.
  - **`@rudderjs/broadcast-redis` — splice during dispatch skipped the next handler.** Unsubscribe used `this.handlers.splice(idx, 1)` which mutated the array under the active `for…of` iterator in `dispatch()`. When a handler self-unsubscribed inside a broadcast, the next handler was silently skipped. Replaced with `filter` (matches `LocalDriver`'s contract — new array assignment keeps the active iterator pointed at its snapshot).
  - **`@rudderjs/broadcast` — dead-socket throw in `connAuth` upgrade path.** `state.wss.handleUpgrade(socket, …)` ran unconditionally after the auth promise resolved. If the client terminated the connection mid-await (proxy timeout, tab close), `handleUpgrade` threw against an already-destroyed socket. Guards on `socket.destroyed` before the call and emits `upgrade.rejected` with new reason `'socket-closed-during-auth'` so telescope sees the abandoned upgrade.

  None of these change public APIs. The new `upgrade.rejected` reason adds a literal to the observer-event union (additive). Sync's `sync.error` observer event gains a new `op: 'message'` value (additive).

## 1.3.0

### Minor Changes

- 335a2e3: Harden the persistence layer + atomic `Sync.seed` (Phase 7 of the 2026-05-22 eventing/realtime plan):

  - **`Sync.seed()` empty-doc gate is now atomic** — the check moved inside `transact` and runs against the actual `fields.size`, not the doc's state vector. Pre-fix, the state-vector check skipped seeding for any doc that had previously been opened (state vector grew on first connect, even with no field writes). Two concurrent `seed()` callers now serialise on Yjs's per-doc transact queue. Return type changed from `Promise<void>` to `Promise<boolean>` — `true` if this call wrote, `false` if the doc was already seeded.
  - **`room.ready` rejects on persistence load failure** — was previously silenced with `.catch + resolve`, leaving a broken in-memory room cached forever. Now the WS upgrade closes the socket cleanly (RFC 6455 code 1011) and `Sync.snapshotAsync` / `readMapAsync` / `readTextAsync` / `seed` propagate the rejection to user code. Subsequent calls reload from persistence instead of operating against an empty doc.
  - **`persistence.storeUpdate` failures emit `sync.error`** — fire-and-forget storeUpdate on server-originated updates (via `doc.on('update')` in `getOrCreateRoom`) and awaited storeUpdate on client messages both surface errors as `sync.error` events with the new `op: 'storeUpdate'` field. Telescope picks them up unchanged.
  - **`onChange` callback failures emit `sync.error`** — was previously `await onChange?.()` with no try/catch, producing unhandled-rejection noise. Now caught and surfaced as `sync.error` with `op: 'onChange'`.
  - **AI awareness clock survives HMR / process restart** — was a module-level counter that reset to 0 on Vite SSR re-eval, causing y-protocols to filter "older" clocks and silently drop AI cursor updates. Now lives on `globalThis['__rudderjs_sync_ai_clock__']`.
  - **`SyncEvent['sync.error']` gains optional `op` field** — `'getYDoc' | 'storeUpdate' | 'onChange' | 'seed' | 'firstConnect'`. Backward-compatible (optional); telescope's SyncCollector picks it up via the generic `[key: string]: unknown` shape.

  The `room.ready` and `Sync.seed` return-type changes are the only public-surface shifts. No existing in-repo callers exercise either change point.

- c59990d: `@rudderjs/sync/react` — `useCollabSeedText` + `enabled` option on `useCollabRoom`.

  Two additive hooks/options that unblock CodeMirror-style adapters and conditional-connection patterns. Both pieces are mechanically small and fully backwards-compatible — existing call sites see no behavior change.

  - **`useCollabSeedText(room, textKey, seedFn)`** — sibling of `useCollabSeed` for `Y.Text`-shaped editors (CodeMirror via `y-codemirror.next`, Monaco, plain `Y.Text` bindings). The existing `useCollabSeed` calls `doc.getXmlFragment(key)` unconditionally, which is correct for Tiptap / ProseMirror but throws / corrupts the doc on a name already bound as `Y.Text`. Same synced-await + `'rudder-sync-seed'` transact-origin semantics; the share-type-aware decision is the only difference. The two hooks now share an internal `seedShareTypeOnSync` helper that's exported for testing.

  - **`UseCollabRoomOptions.enabled?: boolean`** — default `true`. Set to `false` to gate the WebSocket handshake + IndexedDB open without a render-time branch around the hook (illegal under Rules of Hooks). Standard shape — matches `useSWR({ enabled })` / `useQuery({ enabled })`. Flipping `false → true` mounts the manager; `true → false` runs the same `manager.stop()` path as unmount (and `room` flips back to `null` via the existing `onRoomChange(null)` callback). Use for "render fields locally until prerequisites are met" — e.g. `enabled: !!wsPath`.

  Both hooks remain thin React wrappers; the framework continues to put testable logic in non-hook helpers (`CollabRoomManager` / `seedShareTypeOnSync`) so no React testing harness is required.

### Patch Changes

- ea5b53d: Awareness lifecycle + globals hygiene (Phase 8 of the 2026-05-22 eventing/realtime plan):

  - **Dead sockets pruned from `awarenessMap` on replay.** Force-killed sockets (proxy timeout, tab kill) never fire the `close` event, so their stored awareness entry would linger and replay ghost cursors to every late joiner. The Step-2 awareness replay loop now deletes entries whose `readyState !== OPEN`.
  - **AI awareness replay TTL.** Stored `aiAwarenessMsg` was replayed to every new joiner forever; if the AI agent crashed without calling `clearAiAwareness`, the stale cursor never went away. Stored AI awareness now carries an `aiAwarenessAt` timestamp and the handler skips replay (and drops the buffer) once it's older than 60 seconds.
  - **`Sync.clearAiAwareness(docName)` server helper.** Explicit recovery path keyed by `docName` for when an AI agent crashes without a Y.Doc reference handy. Drops the stored replay buffer; the lexical-side `clearAiAwareness(doc)` is still the way to also broadcast a null awareness frame to currently connected clients.
  - **Centralized globalThis keys.** `packages/sync/src/globals.ts` now owns the slot names — `rooms`, `persistence`, `firstConnect`, `observers`, `aiAwarenessClock`. The package was renamed `live` → `sync` last year but two slots still carried the `__rudderjs_live_*` prefix and were re-declared independently across `index.ts` and `lexical/awareness.ts` — rename either side and AI cursors silently broke. All slots now use the `__rudderjs_sync_*` prefix and there's only one source of truth.
  - **`CollabRoomManager.start()` throws on second call.** Was a silent no-op; if the first call was cancelled mid-`loadYjs` (React strict-mode double-invoke, route change), the `synced` promise was already rejected and the second call returned `undefined` against a dead state. Construct a fresh manager to retry — `useCollabRoom` already does this per effect, so the in-tree consumer is unaffected.

  External consumers reaching into `globalThis['__rudderjs_live__']` or `globalThis['__rudderjs_live_persistence__']` directly will need to switch to `globalThis['__rudderjs_sync_rooms__']` / `globalThis['__rudderjs_sync_persistence__']`. Nothing inside the workspace did so.

## 1.2.0

### Minor Changes

- 4c56a95: feat(sync): add `@rudderjs/sync/react` subpath with `useCollabRoom` + `useCollabSeed` hooks

  New client-side React surface for collab rooms. Replaces the ~50 LOC of `Y.Doc` + `WebsocketProvider` + `IndexeddbPersistence` lifecycle that every editor adapter (`@pilotiq/tiptap`, `@pilotiq/codemirror`, `@pilotiq-pro/collab`) currently re-implements with the same race-window bug.

  ```tsx
  import { useCollabRoom, useCollabSeed } from "@rudderjs/sync/react";

  const room = useCollabRoom(`doc:${id}`, { offline: true });
  const seeded = useCollabSeed(room, "content", (doc, fragment) => {
    const initial = new Y.XmlText();
    initial.insert(0, defaultValue);
    fragment.insert(0, [initial]);
  });
  if (!room || !seeded) return <Placeholder />;
  ```

  - **`useCollabRoom(roomKey, options)`** — lazy-imports peers, connects, returns the room when ready. `null` on SSR + while loading. Re-keys on `roomKey` change.
  - **`useCollabSeed(room, fragmentKey, seedFn)`** — seeds an empty Y.XmlFragment on first sync, idempotent across peers. `seedFn` captured via ref (no `useCallback` needed).
  - **`CollabRoomManager`** — the underlying class, also exported. Pure logic (factory-injectable), no React dep — testable in node without DOM infra.

  Peer requirements: `react@>=19.2.0` always; `y-websocket` and `y-indexeddb` are optional peers — install them when you use the hooks.

  12 unit tests cover the manager's cancellation matrix (stop-before-start, stop-mid-construction, partial-handle cleanup, idempotent stop, sync-fast-path, factory-rejection cleanup).

  Cross-repo migration paths documented in `docs/plans/2026-05-21-sync-react-hooks.md`.

## 1.1.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- 1dfb6b8: Document the WS `docName` URL contract on `SyncConfig.path` and add a multi-peer broadcast regression test.

  - **JSDoc** on `SyncConfig.path` now spells out that the room key (`docName`) is extracted as the **last non-empty path segment** of the connection URL, after stripping the query string. Consumers with composite room ids must flatten with a non-slash separator before mounting — otherwise distinct logical rooms with the same trailing segment collide into one shared `Y.Doc`.
  - **Inline comment** added on `handleConnection`'s docName extraction documenting the same rule plus the collision implication.
  - **Two new tests** in `packages/sync/src/index.test.ts` (`Multi-peer WS broadcast` suite):
    - `forwards an update from peer A to peer B in the same room` — drives `_handleConnection` with mock WS sockets, encodes a real Yjs syncUpdate frame, verifies the originator is skipped and the other peer receives it.
    - `isolates broadcasts: peers in different rooms do not see each other` — defensive negative test for the room-collision class of bug.

  No behavior change. Filed alongside `docs/plans/2026-05-15-sync-ws-multi-peer-diagnostic.md` from pilotiq agent — answers the three open questions in the plan's "Rudder-side response" section.

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5

## 1.1.0

### Minor Changes

- aba6076: feat(sync): SSR hydration primitives + onFirstConnect lifecycle hook

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

### Patch Changes

- 4c08da4: Internal cleanup of `@rudderjs/sync`. No public API changes.

  - Centralize the rooms-map globalThis access behind `getRoomsMap()` / `ensureRoomsMap()` helpers — collapses 5 inline `g[KEY] as Map<string, Room>` reads (sync:docs, sync:clear, Sync.clearDocument, Sync.getClientCount, getOrCreateRoom) into one structural cast inside the helper. `getOrCreateRoom` is restructured to early-return on the cache-hit path so it no longer needs a `rooms.get(docName) as Room` non-null cast.
  - Centralize the per-WebSocket client-id property bag behind `readTaggedId()` / `writeTaggedId()` helpers — keeps the `(ws as unknown as Record<...>)['__syncClientId']` cast in one spot instead of two inline at the callsite.
  - Centralize commander-style argv reads behind `readDocArg()` — drops the duplicated `(args as unknown as Record<string, unknown>)['doc'] as string` pattern from the two `sync:*` commands.
  - Add a named `DeltaItem` shape for `Y.XmlText.toDelta()` results (yjs types `toDelta` as `Array<any>`) and use it across the `sync:inspect` command's three call sites. Replaces three inline `as { insert: unknown; attributes?: Record<string, unknown> }` casts. Lexical adapter (`@rudderjs/sync/lexical`) still has its own toDelta casts — left for a follow-up sweep to keep this PR focused.
  - `sync:inspect` outer/inner loops switched from `for (let i = 0; ...) { const entry = delta[i]! }` to `for (const [i, entry] of delta.entries())` — eliminates the per-iteration non-null assertion that the index-based form needed under `noUncheckedIndexedAccess`.

- c7ef815: Internal cleanup of the `@rudderjs/sync/lexical` adapter — deferred follow-up from the previous sync cleanup. No public API changes.

  - Standardize on the existing `InnerDeltaItem` type alias from `lexical/types.ts` everywhere a `Y.XmlText.toDelta()` result is consumed. Replaces 7 inline `as Array<{ insert: unknown }>` casts across `text.ts` and `lexical/index.test.ts`.
  - Drop redundant `as Y.XmlText` / `as Y.XmlElement` post-`instanceof` casts in `text.ts` and the test file (4 casts) — TypeScript already narrows `entry.insert` to the matched type inside the `instanceof` branch.
  - Drop two unused `// eslint-disable-next-line @typescript-eslint/no-explicit-any` directives in `blocks.ts` — the underlying casts use `unknown`, not `any`, so the rule never fired.
  - Restructure `rewriteText` in `text.ts` to merge the two passes over `rootDelta` (paragraph-nodes + per-paragraph offsets) into one — collects `{ node, offset }` pairs, then iterates `existing.slice(newParagraphs.length).reverse()` for truncation and `newParagraphs.slice(existing.length)` for extension. Eliminates 3 non-null assertions (`existingNodes[i]!` / `newParagraphs[i]!` / `offsets[i]!`).
  - Replace `paragraphOffsets[pIdx]!` in `insertBlock` with `paragraphOffsets[pIdx] ?? totalLen`. The explicit `>= paragraphCount` guard above already covers OOB, but the `??` keeps `noUncheckedIndexedAccess` happy without the lint-flagged non-null assertion.
  - Test helper: `rooms()` accessor for the 4 repeated `G[ROOMS_KEY] as Map<string, { doc: Y.Doc }>` reads.

  `@rudderjs/sync` package-wide lint warnings: 7 → 0 (lexical/ adapter).

## 1.0.1

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.
- Updated dependencies [0f69018]
  - @rudderjs/core@1.1.3

## 1.0.0

### Major Changes

- 1d81533: Graduate to 1.0.0.

  The Yjs CRDT sync engine — `SyncProvider`, the `Sync` facade (`document`, `seed`, `snapshot`, `readMap`, `updateMap`, `updateMapBatch`, `clearDocument`, `getClientCount`, `persistence`), persistence drivers (`MemoryPersistence`, `syncPrisma()`, `syncRedis()`), the `SyncObserverRegistry` at `@rudderjs/sync/observers`, and the Lexical editor adapter at `@rudderjs/sync/lexical` are now stable.

  **Breaking changes from 0.2.x:**

  - `LIVE_UPGRADE_KEY` renamed to `SYNC_UPGRADE_KEY` (the underlying globalThis key value also changed from `__rudderjs_live_upgrade__` to `__rudderjs_sync_upgrade__`). The constant is internal — only matters if you wrote custom WS upgrade chaining against it.
  - The `./tiptap` subpath export has been removed. It was a non-functional scaffold; a real Tiptap adapter is planned for a future release. The design notes live in `src/tiptap/README.md`.

  **Documentation cleanup:** prior README + boost guidelines documented a `sync()` factory function and `await sync.document(...)` pattern that didn't exist. Setup now matches reality — `SyncProvider` is auto-discovered via `defaultProviders()` and configured through `config/sync.ts`. `Sync.document()` is synchronous (returns `Y.Doc` directly).

### Patch Changes

- @rudderjs/core@1.0.1

## 0.2.2

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0

## 0.2.1

### Patch Changes

- 8411cd5: **Renamed `@rudderjs/rudder` → `@rudderjs/console`** to match Laravel's `Illuminate\Console` namespace and remove the "rudder rudder" stutter (the binary is `rudder`, the framework is RudderJS, and the authoring package is now `console` — no more triple-naming collision).

  **Migration for consumers:**

  ```ts
  // before
  import { Rudder, Command } from "@rudderjs/rudder";

  // after
  import { Rudder, Command } from "@rudderjs/console";
  ```

  **No symbol changes** — `Rudder`, `Command`, `CommandRegistry`, `CommandBuilder`, `MakeSpec`, `CancelledError`, `parseSignature`, `commandObservers` all keep their names. Only the import path changes.

  **No CLI changes** — the binary is still `rudder` (`pnpm rudder ...`), and the runner package is still `@rudderjs/cli`. Internal dependency updates only.

  **Naming model after this rename:**

  | Concept                 | Package                 | Surface               |
  | ----------------------- | ----------------------- | --------------------- |
  | Author HTTP routes      | `@rudderjs/router`      | `Route.get(...)`      |
  | Run HTTP routes         | `@rudderjs/server-hono` | (boots HTTP server)   |
  | Author console commands | `@rudderjs/console`     | `Rudder.command(...)` |
  | Run console commands    | `@rudderjs/cli`         | `rudder` binary       |

  The old `@rudderjs/rudder` will be deprecated on npm with a pointer to `@rudderjs/console` after publish.

- Updated dependencies [8411cd5]
  - @rudderjs/core@0.1.4

## 0.2.0

### Minor Changes

- 3a1e5c7: Renamed `@rudderjs/live` → `@rudderjs/sync` and extracted Lexical-specific helpers into the `@rudderjs/sync/lexical` subpath. `@rudderjs/sync/tiptap` subpath is scaffolded as a contract-only stub for the upcoming Tiptap adapter.

  **Breaking — `@rudderjs/sync`:**

  - Package renamed: `@rudderjs/live` → `@rudderjs/sync` (`@rudderjs/live` is deprecated on npm with a pointer to the new name)
  - Facade renamed: `Live` → `Sync`; provider renamed: `LiveProvider` → `SyncProvider`
  - Type/interface renames: `LiveConfig` → `SyncConfig`, `LivePersistence` → `SyncPersistence`, `LiveEvent` → `SyncEvent`, `LiveObserver` → `SyncObserver`, `LiveObserverRegistry` → `SyncObserverRegistry`, `LiveClientProvider` → `SyncClientProvider`, `RedisLivePersistenceConfig` → `RedisSyncPersistenceConfig`
  - Factory renamed: `live()` → `sync()`
  - Helper renames: `livePrisma` → `syncPrisma`, `liveRedis` → `syncRedis`, `liveObservers` → `syncObservers`
  - WebSocket default path: `/ws-live` → `/ws-sync`
  - Config key + DI bind: `'live'` → `'sync'`, `'live.persistence'` → `'sync.persistence'`
  - CLI commands: `live:docs` / `live:clear` / `live:inspect` → `sync:docs` / `sync:clear` / `sync:inspect`
  - Prisma model default: `'liveDocument'` → `'syncDocument'` — rename your `LiveDocument` model to `SyncDocument`, or pass `syncPrisma({ model: 'liveDocument' })` explicitly to keep the old table
  - Redis key prefix default: `'rudderjs:live:'` → `'rudderjs:sync:'` — pass `syncRedis({ prefix: 'rudderjs:live:' })` to keep the old prefix
  - Lexical block helpers (`Live.editBlock` / `insertBlock` / `removeBlock`, `Live.editText` / `rewriteText` / `editTextBatch`, `Live.setAiAwareness` / `clearAiAwareness`, `Live.readText`) moved to `@rudderjs/sync/lexical` as standalone functions. Use `sync.document(name)` to get the `Y.Doc` handle, then pass it to the helper:

    ```ts
    import { sync } from "@rudderjs/sync";
    import { editBlock, insertBlock } from "@rudderjs/sync/lexical";

    const doc = sync.document("panel:articles:42:richcontent:body");
    insertBlock(doc, "callToAction", { title: "Subscribe" });
    ```

  **New — `@rudderjs/sync`:**

  - `sync.document(name)` accessor on the `Sync` facade returns the underlying `Y.Doc` for use with editor adapters
  - `YDoc` type re-exported from `@rudderjs/sync` (`export type { Doc as YDoc } from 'yjs'`)
  - `@rudderjs/sync/lexical` subpath: editor-agnostic Yjs core + Lexical-specific helpers separated for the first time
  - `@rudderjs/sync/tiptap` subpath: scaffolded contract for Tiptap adapter (throws at runtime until implemented)

  **Breaking — `@rudderjs/telescope`:**

  - `LiveCollector` → `SyncCollector`
  - Telescope entry type slug `'live'` → `'sync'` (URL `/telescope/live/...` becomes `/telescope/sync/...`; existing entries tagged `'live'` won't appear under the new tab)
  - Config keys: `recordLive` → `recordSync`, `liveAwarenessSampleMs` → `syncAwarenessSampleMs`

  **Patch — `@rudderjs/vite`, `@rudderjs/broadcast`:**

  Comment + guideline updates for the WS upgrade chaining (now references `@rudderjs/sync` instead of `@rudderjs/live`).

  **Patch / minor — `create-rudder-app`:**

  The `--packages` multi-select option `live` → `sync`; generated `config/live.ts` → `config/sync.ts`; generated Prisma model `LiveDocument` → `SyncDocument`. Existing scaffolded projects keep working — only new scaffolds use the renamed surface.

  **Sibling repos:** `pilotiq` and `pilotiq-pro` need their own PRs to update `pnpm.overrides` link targets (`link:../rudder/packages/live` → `link:../rudder/packages/sync`) and dynamic-import strings. See `docs/plans/2026-04-26-rename-live-to-sync.md` Phase 7.

## 0.0.7

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.0.6

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/core@0.1.0

## 0.0.5

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.4

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.2

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/core@0.0.9
