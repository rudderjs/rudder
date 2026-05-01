# create-rudder-app

## 0.3.1

### Patch Changes

- Updated dependencies [550518c]
  - @rudderjs/auth@4.0.2

## 0.3.0

### Minor Changes

- 0a8f82a: Scaffolded `config/{cache,queue,mail,session}.ts` now gate their default driver on `isWebContainer()` so apps boot cleanly in StackBlitz/WebContainer without re-config (memory→cache, sync→queue, log→mail, cookie→session). On regular Node the gate returns `false` and the env-driven default is preserved exactly. Zero change for existing apps.

## 0.2.2

### Patch Changes

- Updated dependencies [5fbd6e5]
  - @rudderjs/auth@4.0.1

## 0.2.1

### Patch Changes

- @rudderjs/auth@4.0.0

## 0.2.0

### Minor Changes

- 2cd87b0: Two scaffolder cleanups:

  **1. `app/Http/{Controllers,Middleware,Requests}/` namespace.** Move HTTP-layer scaffolded files under `app/Http/` to match the existing `make:` CLI command target paths and Laravel's directory shape. Previously the scaffolder put files at `app/Controllers/` and `app/Middleware/` while `make:controller` and `make:middleware` wrote to `app/Http/Controllers/` and `app/Http/Middleware/` — the two paths now agree.

  **2. Drop `RequestIdMiddleware` from the scaffold.** It was example code that didn't actually do anything — it set `X-Request-Id` on responses but never propagated the id into the logger context, telescope's `batchId`, or any other downstream system. Telescope generates its own `batchId` and ignores incoming headers. Users who want a request-id middleware can copy the example from [the middleware guide](/docs/guide/middleware), where it's already documented as the canonical "writing middleware" example.

  **Migration for existing apps:** This is a convention move, not a forced rename. The framework has no path-bound discovery for controllers/middleware/requests — all routing is explicit (`router.get(path, handler)`, `Route.registerController(...)`), so existing files in `app/Controllers/`, `app/Middleware/`, `app/Requests/` keep working from wherever they live. Going forward, `make:*` and the scaffolder agree on `app/Http/`. To align an existing app, move the files manually (`git mv app/Controllers app/Http/Controllers` etc.) and update relative imports — no framework code change required. `RequestIdMiddleware` was decorative — leaving it in place changes nothing; deleting it changes nothing.

## 0.1.2

### Patch Changes

- @rudderjs/auth@3.2.1

## 0.1.1

### Patch Changes

- 424a189: Add a `Demos` multiselect option that scaffolds sample views under `/demos` — Contact (CSRF + Zod) always, plus WebSocket chat (`Ws.tsx` + `src/BKSocket.ts`) when `Broadcast` is selected and a Yjs collaborative editor (`Live.tsx` + a `y-websocket` runtime dep) when `Sync` is selected. Wires the matching controllers in `routes/web.ts` and a `POST /api/contact` handler (CSRF-gated when `Auth` is selected) plus `POST /api/ws/broadcast` + `GET /api/ws/ping` when `Broadcast` is selected. Demos use the existing semantic CSS classes so they work in both Tailwind and plain-CSS variants. Silently skipped when the primary framework isn't React (Vue/Solid variants aren't written yet).

## 0.1.0

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

## 0.0.31

### Patch Changes

- 228d165: Close plain-variant styling gap for todo, ai-chat, multi-framework index, and demo pages.

  The `--no-tailwind` scaffolder previously left todo lists, AI chat UIs, multi-framework index pages, and per-framework demo pages with raw HTML markup because they used shadcn-flavored Tailwind utilities (`text-muted-foreground`, `bg-primary`, `bg-muted`, etc.) that don't exist in the plain-CSS variant. They now use the same semantic class vocabulary as the welcome / auth / error pages, so `--no-tailwind` apps see styled output everywhere out of the box.

  New semantic classes shipped in both CSS variants: `form-inline`, `todo-list`, `todo-item` (+`is-done` modifier), `link-danger`, `empty-state`, `chat-wrap`, `chat-column`, `chat-header`, `chat-log`, `chat-row` (+`is-user`/`is-assistant`), `chat-bubble` (+`is-user`/`is-assistant`), `chat-input`.

## 0.0.30

### Patch Changes

- 5239815: Make Tailwind optional in create-rudder-app and refactor auth views to semantic class names.

  `create-rudder-app` now ships two `app/index.css` variants from a single JSX source: a Tailwind `@apply` version (default) and a hand-authored plain CSS version with CSS variables + `prefers-color-scheme` dark mode. Answer "No" to the `Add Tailwind CSS?` prompt to scaffold a zero-Tailwind project that still looks styled out of the box — landing page, auth forms, and error page all render against the plain variant.

  `@rudderjs/auth` React views (Login / Register / ForgotPassword / ResetPassword) are refactored to use the same semantic vocabulary (`auth-wrap`, `form-card`, `form-input`, `auth-link`, …). The visual output is unchanged for Tailwind apps; apps that vendored the previous React auth views will need to re-vendor (`pnpm rudder vendor:publish --tag=auth-views --force` or copy from `node_modules/@rudderjs/auth/views/react/`) and either keep Tailwind or bring their own CSS for the new selectors.

- Updated dependencies [5239815]
  - @rudderjs/auth@3.2.0

## 0.0.29

### Patch Changes

- d5b7150: Add `@rudderjs/telescope` to the package multiselect. Selecting it scaffolds `config/telescope.ts` (defaults to in-memory storage — no extra deps), wires it into `config/index.ts`, and surfaces a post-install hint pointing to the `/telescope` dashboard. Provider auto-discovery handles the rest.

## 0.0.28

### Patch Changes

- a458e47: Add `@rudderjs/boost` to the package multiselect as an opt-in devDependency. Surfaces a `rudder boost:install` hint in the post-scaffold "Done!" output so users can wire their AI coding assistant (Claude Code / Cursor / Copilot / etc.) to project internals via MCP.

## 0.0.27

### Patch Changes

- Updated dependencies [5ca3e29]
  - @rudderjs/auth@3.1.1

## 0.0.26

### Patch Changes

- d3d175c: Add `BaseAuthController` + restructure scaffolded auth routes (Laravel Breeze-style).

  **`@rudderjs/auth`** — new `BaseAuthController` abstract class. Ship the five standard auth POST handlers (`sign-in/email`, `sign-up/email`, `sign-out`, `request-password-reset`, `reset-password`) as decorated methods on a base class. Subclasses set `userModel`, `hash`, and `passwordBroker`; override any method to customize. Decorator metadata is inherited through the prototype chain — `Route.registerController(YourAuthController)` picks up all five routes without re-decorating.

  New exports: `BaseAuthController`, `AuthUserModelLike`, `AuthHashLike`.

  **`create-rudder-app`** — two fixes rolled together:

  1. **Bug fix.** The session-mutating auth handlers were emitted into `routes/api.ts`, but `SessionMiddleware` is only auto-installed on the **web** group. `Auth.attempt/login/logout` calls `session.regenerate()`, which threw `No session in context` on sign-up. Auth submit handlers now live on the web group.

  2. **Shape change.** Scaffolded apps now get a real `app/Controllers/AuthController.ts` (extends `BaseAuthController`) instead of ~60 lines inlined in `routes/web.ts`. `routes/web.ts` shrinks to `registerAuthRoutes(Route, { middleware: webMw })` (GETs) + `Route.registerController(AuthController)` (POSTs). Welcome page uses the cleaner `auth().user()` helper — no manual `runWithAuth` / `app().make<AuthManager>()` wrapping.

  Customization path: edit `app/Controllers/AuthController.ts` — subclass `BaseAuthController` methods you want to change, or add new ones. The class-level `@Middleware([authLimit])` decorator applies rate limiting to every POST.

- Updated dependencies [d3d175c]
  - @rudderjs/auth@3.1.0

## 0.0.25

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/auth@3.0.0

## 0.0.24

### Patch Changes

- @rudderjs/auth@2.0.1

## 0.0.23

### Patch Changes

- 6fb47b4: Welcome page now hides Log in / Register links when the auth package isn't installed, using Laravel's `Route::has('login')` idiom (`Route.getNamedRoute('login')` in RudderJS). Previously the links were always rendered even in minimal scaffolds, producing 404s on click. React, Vue, and Solid Welcome templates all updated.
- Updated dependencies [6fb47b4]
  - @rudderjs/auth@2.0.0

## 0.0.22

### Patch Changes

- 9fa37c7: Welcome page now hides Log in / Register links when the auth package isn't installed, using Laravel's `Route::has('login')` idiom (`Route.getNamedRoute('login')` in RudderJS). Previously the links were always rendered even in minimal scaffolds, producing 404s on click. React, Vue, and Solid Welcome templates all updated.
- Updated dependencies [9fa37c7]
  - @rudderjs/auth@1.0.0

## 0.0.21

### Patch Changes

- 6469541: Fix: generated `package.json` pointed `pnpm rudder` at `@rudderjs/cli/src/index.ts`, which only exists in the monorepo workspace — published `@rudderjs/cli` ships `dist/` only, so every `pnpm rudder` invocation in a scaffolded project crashed with `ERR_MODULE_NOT_FOUND`. This also broke the post-install `providers:discover` step. Switched to `dist/index.js`.

## 0.0.20

### Patch Changes

- 4cdc399: Refresh the npm package README with the post-launch positioning: value-first opening ("spin up a production-ready app in under 60 seconds"), explicit "What you get out of the box" section, troubleshooting entries for the most common gotchas (manifest stale, Prisma schema not pushed, Passport keys missing), `[name]` argument documented, de-Laravel'd tagline. Scaffolder functionality unchanged.

## 0.0.19

### Patch Changes

- 1171fab: Fix scaffolded auth flow — registration was failing with two latent bugs:

  - `prisma/schema/auth.prisma` used a better-auth-style schema (password on `Account`) while `routes/api.ts` and `app/Models/User.ts` expected `password` directly on `User`. The User model now matches the playground (User with `password`, `rememberToken` + `PasswordResetToken`), dropping the unused `Session`/`Account`/`Verification` models.
  - `config/auth.ts` emitted `providers.users.model: 'User'` as a string. `EloquentUserProvider.retrieveById` calls `this.model.find(id)` and needs the actual class. Now imports and passes the `User` class.

## 0.0.18

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/auth@0.2.1

## 0.0.17

### Patch Changes

- a67d180: Fix multiple scaffolder template bugs that broke generated apps:

  - Fix `${extraLinksStr}` and `${extraStr}` being written literally instead of interpolated (index page crashed with ReferenceError)
  - Align API auth routes with vendor auth pages: `/api/auth/sign-in/email`, `/api/auth/sign-up/email`, `/api/auth/sign-out`, `/api/auth/request-password-reset`, `/api/auth/reset-password`
  - Implement real sign-up flow with Hash + User.create + Auth.login
  - Add stubs for password reset endpoints

- 2ee6301: Update README usage examples to use `create rudder-app` instead of `create rudderjs-app`

## 0.0.16

### Patch Changes

- 4804d67: Fix auth template: add sessionMiddleware to bootstrap/app.ts when auth is enabled.

  The generated app was calling Auth.user() which requires session context,
  but sessionMiddleware was never registered in the middleware pipeline.

## 0.0.15

### Patch Changes

- 1777e0a: Fix auth templates to use RudderJS Auth API instead of BetterAuth

## 0.0.4

### Patch Changes

- Simplify generated app: remove unnecessary dependencies (`@better-auth/prisma-adapter`, `@photonjs/hono`, `@universal-middleware/core`, `hono`, `@prisma/adapter-*`, `pg`, `mysql2`). Simplify `config/auth.ts` — no more manual PrismaClient boilerplate. Update `bootstrap/providers.ts` to use `auth()` and put `prismaProvider` first.

## 0.0.3

### Patch Changes

- Fix multiple template issues discovered during end-to-end scaffolding test

  - Self-contained `tsconfig.json` (no longer extends `../tsconfig.base.json` which doesn't exist outside the monorepo)
  - All `@rudderjs/*` dependencies use `'latest'` dist-tag instead of `'^0.0.1'` (which pnpm semver treats as exact version)
  - Add `@better-auth/prisma-adapter` to dependencies (required by better-auth@1.5.3+)
  - Add `shadcn` to dependencies (required by generated `src/index.css` for `@import "shadcn/tailwind.css"`)
  - Add `pnpm.onlyBuiltDependencies` to allow native builds (required by pnpm v10)
  - Use `prismaProvider(configs.database)` instead of `DatabaseServiceProvider` in `bootstrap/providers.ts`
  - Add `session` config and provider to generated app
  - Fix `bootstrap/app.ts` middleware: `fromClass(RequestIdMiddleware)` instead of `new RequestIdMiddleware().toHandler()`

## 0.0.2

### Patch Changes

- Quality pass: bug fixes, expanded tests, and docs improvements across core packages.

  - `@rudderjs/support`: fix `ConfigRepository.get()` returning fallback for falsy values (`0`, `false`, `''`); add prototype pollution protection to `set()`; fix `Collection.toJSON()` returning `T[]` not a string; fix `Env.getBool()` to be case-insensitive; fix `isObject()` to correctly return `false` for `Date`, `Map`, `RegExp`, etc.
  - `@rudderjs/contracts`: fix `MiddlewareHandler` return type (`void` → `unknown | Promise<unknown>`)
  - `@rudderjs/middleware`: add array constructor to `Pipeline` — `new Pipeline([...handlers])` now works
  - `create-rudder-app`: remove deprecated `.toHandler()` from `RateLimit` in scaffolded templates; remove nonexistent `.withExceptions()` call
