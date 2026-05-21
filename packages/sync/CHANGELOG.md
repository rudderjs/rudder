# @rudderjs/live

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
