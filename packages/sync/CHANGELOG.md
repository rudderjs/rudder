# @rudderjs/live

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
