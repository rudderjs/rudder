# @rudderjs/vite

## 2.0.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5

## 2.0.0

### Major Changes

- 4ce1e09: **Breaking — `rudderjs()` no longer registers Vike.** You must add `vike()` to your `vite.config.ts` plugins array yourself.

  Previously, `rudderjs()` dynamically imported `vike/plugin` inside its own async IIFE and prepended Vike's plugins to its return value. That wrapped Vike's plugin IIFE inside ours and tripped a microtask race against Vike's `isOnlyResolvingUserConfig` flag in `loadViteConfigFile` — failing deterministically on Ubuntu Node 20 and ~50% on Ubuntu Node 22 CI runners with the misleading `[vike@…][Bug] You stumbled upon a Vike bug` error wrapper. Upstream discussion: vikejs/vike#3258.

  **Migration — two-line diff:**

  ```diff
    import { defineConfig } from 'vite'
  + import vike from 'vike/plugin'
    import rudderjs from '@rudderjs/vite'
    // …

    export default defineConfig({
      plugins: [
        rudderjs(),
  +     vike(),
        // …
      ],
    })
  ```

  Note the order: **`rudderjs()` before `vike()`**. The views-scanner writes auto-generated stubs to `pages/__view/` during plugin construction, and Vike scans `pages/` during its own construction, so the stubs must exist before `vike()` is called.

  Other API changes:

  - `rudderjs()` now returns `Plugin[]` synchronously instead of `Promise<Plugin[]>`. Existing `await rudderjs()` calls continue to work (await on a non-Promise is a no-op), but TypeScript signatures change.
  - The `_vikeVitePluginOptions` self-detection marker is no longer attached to the return value — we don't register Vike, so there's nothing to flag.
  - `vike` is still listed in `peerDependencies` and remains required.

## 1.1.0

### Minor Changes

- 937cdac: Adopt three Vike framework-author hooks landed in 2025 for unified DX:

  - **`+onCreatePageContext`** — `@rudderjs/vite` now ships a process-wide page-context enhancer registry. Framework packages register a function via `registerPageContextEnhancer(fn)` and it runs on every page render. The first user: `@rudderjs/auth` populates `pageContext.user` automatically — views no longer need a `+data.ts` to read the current user. The augmentation is typed via the `Vike.PageContext` global namespace.

  - **`+onError`** — Vike SSR errors are now routed through `@rudderjs/core`'s `report()` so they hit the same reporter/renderer chain as HTTP route errors. `@rudderjs/core` is an optional peer; the hook falls back to `console.error` when it's not installed.

  - **`+headersResponse`** — `view('id', props, { headers })` is the new third arg. Pass per-page response headers (`Cache-Control`, CSP, etc.) directly from the controller. The headers can be a plain object or a function (`() => Record<string, string>`) for per-request values like CSP nonces. Framework-owned headers (`set-cookie`, `vary`, anything starting with `x-rudderjs-`) are silently dropped to prevent collisions with server-hono's response pipeline.

  ### Mechanism

  The Vike hooks are wired by the `@rudderjs/vite` views scanner — it writes three one-line re-export stubs to `pages/+onCreatePageContext.ts`, `pages/+onError.ts`, and `pages/+headersResponse.ts` on first sync. These files are user-overwritable: re-running the scanner won't clobber edits. (Vike's `Config.extends` mechanism doesn't support scoped packages, so the scanner generates files that Vike picks up via its native page discovery instead.)

  ### Migration

  - Existing apps: run `pnpm dev` or `pnpm build` once. The scanner emits the three hook stubs to `pages/` automatically. Commit them. No code changes required.
  - The `pages/__view/+config.ts` scanner output now also adds `viewHeaders` to `passToClient`, so view components can read response-header context if they need to.
  - `pageContext.user` types automatically when both `@rudderjs/auth` and `@rudderjs/vite` are installed.

  ### Out of scope (deferred follow-ups)

  - `@rudderjs/session` flash enhancer (`pageContext.flash`) — adopt the same `registerPageContextEnhancer` pattern.
  - `@rudderjs/localization` locale enhancer (`pageContext.locale`) — same shape.
  - Typed `+rudderRoute` meta — current `export const route = '/...'` works.
  - `+onHookCall` (beta) telescope integration — wait until telescope's request collector is stable.

  ### No API breaks

  - `view(id, props)` (2-arg) still works; the `options` arg is optional.
  - `req.user` flow on HTTP routes is unchanged.
  - No new required dependencies; `@rudderjs/core` is added as an optional peer of `@rudderjs/vite`, and `@rudderjs/vite` is added as an optional peer of `@rudderjs/auth`.

## 1.0.2

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.
- 6c93f36: Add `@rudderjs/orm-prisma` to SSR externals, fix WS pending-buffer socket leak on 10s timeout (destroy queued sockets rather than silently dropping them), fix HMR log missing closing `)`, and correct boost/guidelines.md plugin name (`rudderjs:views` → `rudderjs:views-scanner`) and ORM externals list.

## 1.0.1

### Patch Changes

- 285ac77: fix: auto-generated `+Page.tsx` stub uses `ReactNode` from `react` instead of
  the global `JSX.Element`. The global `JSX` namespace was removed in
  `@types/react@19`; the previous stub only typechecked when an older copy of
  `@types/react` happened to be hoisted into a path TypeScript walks. Fresh
  installs against React 19 now typecheck cleanly without that accident.

## 1.0.0

### Major Changes

- 1d81533: Graduate to 1.0.0.

  The `rudderjs()` Vite plugin is now stable. Calling it returns the full plugin bundle that powers every RudderJS app:

  - `rudderjs:config` — SSR externals for server-only packages, `@/` and `App/` path aliases
  - `rudderjs:ip` — dev-only `x-real-ip` header injection from the Node socket
  - `rudderjs:ws` — WebSocket upgrade handler shared by `@rudderjs/broadcast` and `@rudderjs/sync`
  - `rudderjs:routes` — HMR watcher that invalidates SSR modules and clears framework singletons when `routes/`, `bootstrap/`, or `app/` changes
  - `rudderjs:views` — view scanner that discovers `app/Views/**` and generates Vike pages under `pages/__view/`, with auto-detection for `vike-react` / `vike-vue` / `vike-solid` / vanilla HTML-string mode

  Every playground build and every scaffolded app has exercised this plugin daily — the API has been frozen-in-practice for some time. 1.0 just makes that contract explicit.

## 0.0.7

### Patch Changes

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

## 0.0.6

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

## 0.0.4

### Patch Changes

- Add database driver packages (`pg`, `mysql2`, `better-sqlite3`, `@prisma/adapter-*`, `@libsql/client`) to SSR externals so they are never bundled into the client build.

## 0.0.3

### Patch Changes

- Suppress "Sourcemap points to missing source files" warnings for @rudderjs/\* packages in dev server output

## 0.0.2

### Patch Changes

- Fix `virtual:` ESM URL scheme error when scaffolded app serves pages

  Add `@rudderjs/server-hono` to `ssr.noExternal` so Vite processes it through its module runner rather than loading it natively. When loaded natively, its dynamic `import('@photonjs/hono')` also loads `@photonjs/hono` natively, which causes static imports of `virtual:photon:get-middlewares:*` virtual modules to fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. This fix ensures the virtual import is handled by Vite's plugin system.
