# @rudderjs/broadcast

## 1.1.0

### Minor Changes

- 5ecb251: Harden WebSocket auth surface (Phase 5 of the 2026-05-22 eventing/realtime plan):

  - **Origin allowlist** on WS upgrade — configure `broadcast.allowedOrigins: string[]` to reject cross-origin connections with HTTP 403. Closes the CSRF-style attack against cookie-auth'd private/presence channels. When unset, all origins are accepted with a one-time startup warning (previous behaviour).
  - **Per-connection auth hook** — `Broadcast.authConnection(async (req) => boolean)` runs once at upgrade time, before the WebSocket handshake. Returning `false` rejects with HTTP 401. Useful for requiring a valid session/token before any subscribe is possible.
  - **Per-IP connection cap** — `broadcast.maxConnectionsPerIp: number` rejects upgrades from an IP that already has this many open connections (HTTP 429). Mitigates trivial FD-exhaustion DoS.
  - **Server-side heartbeat** — protocol-level PING every 30s with a 60s PONG deadline; sockets that fall silent are terminated. Configurable via `broadcast.heartbeat: { interval, timeout } | false`. Closes the dead-TCP-connection leak from NAT timeouts / client crashes.
  - **Per-socket message serialization** — `message` frames on a single socket now run sequentially via a chained promise. Closes the race window where a `client-event` could interleave with the same socket's pending `subscribe` auth callback.
  - **Observer event additions** — `upgrade.rejected` (origin / ip-cap / connection-auth), `message.error` (safety-net catch), and an optional `error` field on `subscribe` events when the auth callback throws. Telescope picks these up unchanged via the existing observer registry.

  All additions are backward-compatible: existing apps see no behaviour change beyond the one-time `allowedOrigins` warning. The heartbeat default (30s/60s) is well above any healthy round-trip and uses `unref()` so it doesn't keep the event loop alive.

## 1.0.4

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/core@1.1.5

## 1.0.3

### Patch Changes

- 704ae11: fix(storage,http,broadcast,log): Tier 4 quality sweep — S3 CopySource encoding, HTTP json() guard, WebSocket send guard, broadcast auth error surface, log cleanup error surface
- Updated dependencies [0f69018]
  - @rudderjs/core@1.1.3

## 1.0.2

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [4c8cd07]
  - @rudderjs/core@1.1.2

## 1.0.1

### Patch Changes

- fa9740c: feat: per-package demos for cache, queue, mail, notifications, localization, http (Phase 5)

  The "Select demos" prompt grows from 8 → 14 entries. Each new demo is a
  single view + one API endpoint, gated on the relevant package — same
  pattern as the Fibonacci/SystemInfo/Avatar entries from Phase 4.

  | Demo           | Gate                     | What it shows                                                                                                                          |
  | -------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
  | Cache counter  | always (Tier A)          | `Cache.get` + `Cache.set` round-trip with no TTL; default in-memory driver                                                             |
  | Queue dispatch | `queue`                  | Button → `ExampleJob.dispatch().send()` → handler logs to terminal                                                                     |
  | Mail send      | `mail`                   | `Mail.to(addr).send(new DemoMail(subject))` — log driver writes to terminal                                                            |
  | Notifications  | `notifications` + `mail` | `notify(Notification.route('mail', addr), new WelcomeNotification())` — on-demand notifiable, no DB row required                       |
  | Localization   | `localization`           | Locale switcher hits `/api/i18n?locale=…`; route uses `runWithLocale` + `setLocale` + `trans()`; ships `lang/{en,es,ar}/messages.json` |
  | HTTP client    | `http`                   | Server-side `Http.get(url).retry(3, 200).timeout(5000)` against jsonplaceholder + httpstat.us; the 500 endpoint exercises retry        |

  Net-new scaffolded files when each demo is selected:

  - `app/Views/Demos/Cache.tsx`, `Queue.tsx`, `Mail.tsx`, `Notifications.tsx`, `Localization.tsx`, `Http.tsx`
  - `app/Jobs/ExampleJob.ts` (queue)
  - `app/Mail/DemoMail.ts` (mail)
  - `app/Notifications/WelcomeNotification.ts` (notifications)
  - `lang/{en,es,ar}/messages.json` (localization)

  Smoke profile `--profile=demos-all` now exercises all 12 demos at once
  (Phase-4 ports + Phase-5 per-package). 64 files written, full bootApp()
  green via `rudder command:list`.

  **Bundled renames (cleanup):**

  - **`live` demo → `sync` demo** in the scaffolder. The Yjs collaboration
    demo kept the old `'live'` ID across the registry, view file
    (`Live.tsx` → `Sync.tsx`), URL (`/demos/live` → `/demos/sync`), view
    template name (`demos.live` → `demos.sync`), package-json gating, and
    snapshot baseline. The package was renamed `@rudderjs/live` →
    `@rudderjs/sync` back in 2026-04-27, but the demo identifier was
    never updated. Now consistent: package, demo ID, file name, and URL
    all use `sync`.

  - **`BKSocket` → `RudderSocket`** in `@rudderjs/broadcast/client/`,
    the playground (`playground/src/RudderSocket.ts`), and the scaffolder
    template (`create-rudder-app/src/templates/demos/rudder-socket.ts`).
    The class name was a leftover from when the framework was called
    "Boost Kit"; nothing else still uses that prefix. The file lives in
    `client/` (vendored template, not exported via `package.json` exports
    map) so this is not an API break for any consumer importing the
    package — but the file path inside the published tarball changes,
    hence the patch bump on `@rudderjs/broadcast`.

  Test count: 162 → 169 (+7 new demo gating tests). Snapshot baseline
  recaptured: 64 files, 65267 bytes (was 65227 — 40-byte delta from the
  RudderSocket symbol rename).

## 1.0.0

### Major Changes

- cd38418: ## RudderJS 1.0 — wave 1

  Graduate 29 framework packages from `0.x` to `1.0.0`. The first batch of `@rudderjs/*` packages is now public-API stable — breaking changes will require explicit major bumps and migration notes from here on.

  **No code changes** — this is a version-line reset. Existing `0.x` consumers need to update their `@rudderjs/*` ranges from `^0.x.y` to `^1.0.0`. The scaffolder (`create-rudder-app`) is updated to emit `1.x` ranges.

  **Why now.** Under semver caret rules, `^0.X.Y` is exact-minor — every minor bump on a `0.x` peer goes out of range and triggers a cascading major bump on every dependent. Even with the `onlyUpdatePeerDependentsWhenOutOfRange` flag in place, the `0.x` baseline keeps producing spurious cascades. Telescope's v9 is mostly that. Once at `1.0`, `^1.0.0` absorbs all `1.x` minor/patch updates — cascades only fire for actual breaking changes.

  **Cascade noise will drop significantly:**

  - `^1.0.0` absorbs all 1.x minor/patch updates
  - Cascade now only fires for actual breaking changes (real majors)

  **Packages graduating to 1.0.0 in this wave:**

  `@rudderjs/contracts`, `core`, `support`, `log`, `hash`, `crypt`, `context`, `testing`, `middleware`, `cache`, `session`, `broadcast`, `schedule`, `mail`, `notification`, `storage`, `localization`, `pennant`, `socialite`, `queue-bullmq`, `queue-inngest`, `router`, `server-hono`, `view`, `orm`, `orm-prisma`, `passport`, `boost`, `ai`.

  `@rudderjs/ai` was originally on the defer list (recent runtime-agnostic split), but it peer-depends on `@rudderjs/core` — graduating core forces ai to graduate via cascade regardless. Listing it explicitly so the version line is intentional rather than a side-effect.

  **Packages NOT yet graduated (still 0.x), to graduate individually as they stabilize:**

  - _Too new / not yet exercised in the dogfood loop:_ `@rudderjs/concurrency`, `image`, `process`, `http`, `console`
  - _Recent significant changes:_ `@rudderjs/orm-drizzle`, `sync`, `vite`

  These will only patch-bump in this release (cascade via regular `dependencies`, not `peerDependencies`).

  **Already past 1.0 (untouched by this release):** `@rudderjs/auth`, `cli`, `mcp`, `queue`, `horizon`, `pulse`, `sanctum`, `telescope`, `cashier-paddle`. These keep their existing version lines; no reset.

  **Expected cascade:** dependents like `telescope`, `pulse`, `horizon`, `cli`, `auth`, `mcp`, `queue`, `sanctum` will major-bump in this release because their peer/dep ranges shifted from `^0.x` to `^1.0.0`. This is the _last_ spurious cascade — future releases of those packages will patch-bump on in-range peer updates.

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0

## 0.0.9

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

## 0.0.8

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
