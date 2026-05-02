# @rudderjs/telescope

## 12.0.0

### Patch Changes

- Updated dependencies [1d81533]
- Updated dependencies [1d81533]
  - @rudderjs/console@1.0.0
  - @rudderjs/sync@1.0.0
  - @rudderjs/ai@1.0.0
  - @rudderjs/core@1.0.1
  - @rudderjs/mcp@5.0.0

## 11.0.0

### Patch Changes

- Updated dependencies [8ca33a1]
  - @rudderjs/http@1.0.0

## 10.1.0

### Minor Changes

- 8634415: Migrate Telescope `JobCollector` and Pulse `QueueRecorder` from the legacy `dispatch()` monkey-patch to `queueObservers.subscribe()` (the cross-process event surface shipped in `@rudderjs/queue@4.1.0` for Horizon).

  **Why it matters under BullMQ:** the old wrapper only ran in the dispatching process, so worker-side `completed` and `failed` events were invisible. Telescope showed jobs as `dispatched` with no follow-up; Pulse `queue_throughput` undercounted and `queue_wait_time` actually measured enqueue duration, not the queue-to-active wait.

  **Behavior changes:**

  - **Telescope** — now records one entry per terminal lifecycle state (`dispatched` from the dispatcher process, `completed`/`failed` from the worker process). Each entry carries `jobId`, so dispatcher and worker rows for the same job correlate by id. Sync driver still records the same data, just routed through the observer instead of a wrapped method.
  - **Pulse** — `queue_wait_time` now records `startedAt - dispatchedAt` on `job.active` (true wait time). `queue_throughput` increments on terminal states (`completed` / `failed`), not on enqueue, so the metric is jobs-per-minute _processed_. `failed_job` entries gain `queue`, `jobId`, and `attempts` fields.

  No config changes required — both collectors auto-register as before. For BullMQ users, this is the visibility fix you'd expect to hit when first wiring up Pulse/Telescope against a real worker.

## 10.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/ai@1.0.0
  - @rudderjs/broadcast@1.0.0
  - @rudderjs/cache@1.0.0
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/log@1.0.0
  - @rudderjs/mail@1.0.0
  - @rudderjs/middleware@1.0.0
  - @rudderjs/notification@1.0.0
  - @rudderjs/orm@1.0.0
  - @rudderjs/router@1.0.0
  - @rudderjs/schedule@1.0.0
  - @rudderjs/auth@4.0.0
  - @rudderjs/mcp@4.0.0
  - @rudderjs/queue@4.0.0
  - @rudderjs/sync@0.2.2

## 9.0.1

### Patch Changes

- Updated dependencies [8411cd5]
  - @rudderjs/console@0.0.4
  - @rudderjs/core@0.1.4
  - @rudderjs/ai@0.1.1
  - @rudderjs/broadcast@0.0.9
  - @rudderjs/sync@0.2.1
  - @rudderjs/mcp@3.1.1

## 9.0.0

### Patch Changes

- Updated dependencies [2caae8c]
  - @rudderjs/ai@0.1.0
  - @rudderjs/core@0.1.3

## 8.0.0

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [ad6bb9d]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/mcp@3.1.0
  - @rudderjs/contracts@0.2.0
  - @rudderjs/orm@0.1.2
  - @rudderjs/auth@3.2.1
  - @rudderjs/middleware@0.0.14
  - @rudderjs/router@0.3.1

## 7.0.0

### Major Changes

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

### Patch Changes

- Updated dependencies [3a1e5c7]
  - @rudderjs/sync@0.2.0
  - @rudderjs/broadcast@0.0.8

## 6.0.0

### Patch Changes

- Updated dependencies [5239815]
  - @rudderjs/auth@3.2.0

## 5.0.1

### Patch Changes

- Updated dependencies [5ca3e29]
  - @rudderjs/queue@3.0.2
  - @rudderjs/auth@3.1.1

## 5.0.0

### Patch Changes

- Updated dependencies [e720923]
- Updated dependencies [d3d175c]
  - @rudderjs/core@0.1.1
  - @rudderjs/auth@3.1.0
  - @rudderjs/ai@0.0.7
  - @rudderjs/broadcast@0.0.7
  - @rudderjs/cache@0.0.12
  - @rudderjs/live@0.0.7
  - @rudderjs/log@0.0.7
  - @rudderjs/mail@0.0.11
  - @rudderjs/mcp@3.0.1
  - @rudderjs/notification@0.0.12
  - @rudderjs/queue@3.0.1
  - @rudderjs/schedule@0.0.12
  - @rudderjs/middleware@0.0.13

## 4.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0
  - @rudderjs/auth@3.0.0
  - @rudderjs/middleware@0.0.12
  - @rudderjs/orm@0.1.1
  - @rudderjs/mcp@3.0.0
  - @rudderjs/queue@3.0.0
  - @rudderjs/ai@0.0.6
  - @rudderjs/broadcast@0.0.6
  - @rudderjs/cache@0.0.11
  - @rudderjs/live@0.0.6
  - @rudderjs/log@0.0.6
  - @rudderjs/mail@0.0.10
  - @rudderjs/notification@0.0.11
  - @rudderjs/schedule@0.0.11

## 3.0.0

### Patch Changes

- 8b0400f: Add `ModelRegistry.all()`, `.register()`, and `.onRegister()` so framework components can discover registered Model classes.

  Models are auto-registered on first `query()` or `find()`/`all()`/`first()`/`where()`/`count()`/`paginate()` call. Use `ModelRegistry.register(MyModel)` in a service provider to register eagerly before the first request hits.

  Telescope's model collector now subscribes via `onRegister()` so it also picks up models that appear after its own boot.

- Updated dependencies [8b0400f]
  - @rudderjs/orm@0.1.0
  - @rudderjs/notification@0.0.10

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/queue@2.0.1
  - @rudderjs/auth@2.0.1
  - @rudderjs/core@0.0.12
  - @rudderjs/mcp@2.0.1
  - @rudderjs/ai@0.0.5
  - @rudderjs/broadcast@0.0.5
  - @rudderjs/cache@0.0.10
  - @rudderjs/live@0.0.5
  - @rudderjs/log@0.0.5
  - @rudderjs/mail@0.0.9
  - @rudderjs/notification@0.0.9
  - @rudderjs/schedule@0.0.10
  - @rudderjs/middleware@0.0.11

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
- Updated dependencies [6fb47b4]
  - @rudderjs/auth@2.0.0
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11
  - @rudderjs/mcp@2.0.0
  - @rudderjs/queue@2.0.0
  - @rudderjs/ai@0.0.4
  - @rudderjs/broadcast@0.0.4
  - @rudderjs/cache@0.0.9
  - @rudderjs/live@0.0.4
  - @rudderjs/log@0.0.4
  - @rudderjs/mail@0.0.8
  - @rudderjs/notification@0.0.8
  - @rudderjs/schedule@0.0.9
  - @rudderjs/middleware@0.0.10

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
- Updated dependencies [9fa37c7]
  - @rudderjs/auth@1.0.0
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10
  - @rudderjs/mcp@1.0.0
  - @rudderjs/queue@1.0.0
  - @rudderjs/ai@0.0.3
  - @rudderjs/broadcast@0.0.3
  - @rudderjs/cache@0.0.8
  - @rudderjs/live@0.0.3
  - @rudderjs/log@0.0.3
  - @rudderjs/mail@0.0.7
  - @rudderjs/notification@0.0.7
  - @rudderjs/schedule@0.0.8
  - @rudderjs/middleware@0.0.9

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
  - @rudderjs/ai@0.0.2
  - @rudderjs/auth@0.2.1
  - @rudderjs/broadcast@0.0.2
  - @rudderjs/cache@0.0.7
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
  - @rudderjs/http@0.0.2
  - @rudderjs/live@0.0.2
  - @rudderjs/log@0.0.2
  - @rudderjs/mail@0.0.6
  - @rudderjs/mcp@0.0.2
  - @rudderjs/middleware@0.0.8
  - @rudderjs/notification@0.0.6
  - @rudderjs/orm@0.0.7
  - @rudderjs/queue@0.0.6
  - @rudderjs/router@0.0.4
  - @rudderjs/rudder@0.0.3
  - @rudderjs/schedule@0.0.7
