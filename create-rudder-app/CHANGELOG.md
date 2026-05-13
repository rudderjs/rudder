# create-rudder-app

## 0.11.1

### Patch Changes

- Updated dependencies [79eadf7]
  - @rudderjs/auth@5.1.1

## 0.11.0

### Minor Changes

- 1049e5d: **Scaffold a shared `SiteHeader` component and fix two latent hydration / CSRF bugs.**

  New single-framework scaffolds now ship `app/Components/SiteHeader.{tsx,vue}` — a shared header that reads the current user from `pageContext` (set by `@rudderjs/auth`'s enhancer) and owns the brand, Demos link, Login/Register links, and sign-out button. `Welcome.{tsx,vue}` and every demo view drop their inline `<nav className="page-nav">` block and use `<SiteHeader />` instead. The welcome route handler no longer resolves the current user or passes `loginUrl`/`registerUrl` props — `SiteHeader` sources them itself. Three framework variants (React / Vue / Solid), each with an auth-installed and a no-auth branch.

  Two bug fixes ride along:

  - **`pages/+config.ts` now lists `'user'`, `'locale'`, `'flash'` in `passToClient`.** Without this, the `@rudderjs/vite` pageContext enhancers drop on hydration: any view reading `usePageContext().user` rendered signed-in on the server and signed-out on the client, causing a visible flicker the moment React/Vue hydrated.

  - **Sign-out fetch now sends `X-CSRF-Token`** via `getCsrfToken()` from `@rudderjs/middleware/client`. The previous request was silently rejected by `CsrfMiddleware` on the web group (419), but the page reloaded as if it had worked, so the session wasn't actually destroyed. Applied to both the single-framework Welcome path and the multi-framework `pages/index/+Page.{tsx,vue}` path.

  Existing scaffolded apps are unaffected — files are captured at scaffold time. To pull these into an existing app, vendor `SiteHeader.tsx` from a fresh scaffold, add `passToClient: ['user', 'locale', 'flash']` to `pages/+config.ts`, and patch the sign-out fetch with `X-CSRF-Token`.

### Patch Changes

- 392f3fd: **Scaffold `pages/+config.ts` with the `vike#3251` workaround out of the box.**

  Fresh `create-rudder-app` projects previously generated `} satisfies Config` in their `pages/+config.ts`, `pages/index/+config.ts`, `pages/_error/+config.ts`, and any opt-in demo / AI-chat config. Under `exactOptionalPropertyTypes: true` (which the scaffolder also enables in `tsconfig.json`), `pnpm typecheck` failed on day 1 with a misleading "not assignable to `import:${string}:${string}`" error — see [vikejs/vike#3251](https://github.com/vikejs/vike/issues/3251).

  Templates now emit `} as unknown as Config` in all 4 generators (`pages/index.ts`, `pages/demo.ts`, `pages/error.ts`, `pages/ai-chat.ts`). Drop the `as unknown` cast once Vike fixes #3251 upstream.

  No other behavior change.

- Updated dependencies [d0db9f0]
- Updated dependencies [b74fc57]
- Updated dependencies [937cdac]
  - @rudderjs/auth@5.1.0

## 0.10.0

### Minor Changes

- 343c96d: **AI-agent detection + JSON output mode.** Inspired by Laravel Installer v5.27.

  When `create-rudder-app` runs inside an AI coding agent (Claude Code, Cursor, GitHub Copilot, Codex, Gemini CLI, Windsurf), it auto-detects via env vars and switches from interactive `@clack/prompts` to a flag-driven non-interactive flow with structured JSON output to stdout. Agents get a parseable success/failure result instead of garbled TTY redraws.

  - New flags: `--orm`, `--db`, `--packages`, `--frameworks`, `--primary-framework`, `--tailwind`, `--shadcn`, `--demos`, `--install`, `--json`, `--interactive`. Special values: `--packages=*` (all defaults), `--demos=*` (all gated-available), empty string for none.
  - Flags also work in interactive mode — pass `--orm=prisma` to skip just that prompt. Useful for CI templates and scripted setups.
  - Detection respects `RUDDER_NONINTERACTIVE=1` for explicit opt-in; `--interactive` forces the prompt UI back on.
  - On failure, JSON output includes `error`, `requiredFlags` (when validation fails), and `logFile`/`logTail` (when install crashes).

## 0.9.3

### Patch Changes

- Updated dependencies [9b33c2c]
  - @rudderjs/auth@5.0.1

## 0.9.2

### Patch Changes

- e8cee45: `BaseAuthController` is now mounted at `/auth/*` instead of `/api/auth/*` (BREAKING).

  The `/api/*` namespace is reserved for token-based API auth (Sanctum / Passport bearer routes); session-based auth lives on the `web` middleware group, matching Laravel's `/login` convention. The previous `/api/auth/*` prefix was a footgun — the URL implied the controller belonged in `routes/api.ts`, but its handlers depend on session/auth ALS context that's only auto-installed on the `web` group.

  What changed:

  - `@Controller('/api/auth')` → `@Controller('/auth')` on `BaseAuthController`. Subclasses inherit the new prefix.
  - The published auth views (`Login`, `Register`, `ForgotPassword`, `ResetPassword`) now default `submitUrl` to `/auth/sign-in/email` / `/auth/sign-up/email` / `/auth/request-password-reset` / `/auth/reset-password`.

  Upgrading an existing app:

  - If you vendored `@rudderjs/auth/views/react/*` into `app/Views/Auth/`, re-publish them (or do a quick find-and-replace from `/api/auth/` → `/auth/` on those files).
  - If you call `BaseAuthController` directly without any subclass URL override, you don't need to do anything else — the controller now serves `POST /auth/sign-in/email` etc. and the bundled views point at the new paths by default.
  - If you depend on the old `/api/auth/*` paths (e.g. external mobile clients, custom front-ends), pass explicit `submitUrl` props to the auth views, or add backwards-compatible alias routes in your `routes/web.ts`.

  `create-rudder-app`'s Welcome view + scaffolded `pages/index` sign-out fetch are updated to match the new paths.

- 231d7f6: Fix two bugs in email verification (`@rudderjs/auth`):

  - **Schema → interface alignment (BREAKING)**: published schemas (`schema/auth.prisma` + Drizzle PG / MySQL / SQLite) now expose a nullable `emailVerifiedAt` timestamp instead of the `emailVerified: boolean` they previously declared. The `EnsureEmailIsVerified` middleware and `MustVerifyEmail` interface have always documented `emailVerifiedAt`, so verified users would get 403s under the old schemas. Apps upgrading need to migrate the column (e.g. `ALTER TABLE user RENAME COLUMN emailVerified TO emailVerifiedAt; ALTER TABLE user ALTER COLUMN emailVerifiedAt TYPE timestamp USING (CASE WHEN emailVerifiedAt THEN now() ELSE NULL END);`) — adapt to your dialect.
  - **ESM `require()` removed**: `verification.ts` previously called `require('@rudderjs/router')` and `require('node:crypto')`, which throw `ReferenceError: require is not defined` in pure ESM consumers — making `verificationUrl()` and `handleEmailVerification()` non-functional. Both are now static ESM imports. `@rudderjs/router` is already a non-optional peer of `@rudderjs/auth`, so the previous try/catch fallback was unnecessary.

  `create-rudder-app`'s scaffolded Prisma + User-model templates are updated to match the new column.

- Updated dependencies [e8cee45]
- Updated dependencies [942bd78]
- Updated dependencies [015e16e]
- Updated dependencies [231d7f6]
- Updated dependencies [015e16e]
  - @rudderjs/auth@5.0.0

## 0.9.1

### Patch Changes

- Updated dependencies [4c8cd07]
  - @rudderjs/auth@4.0.3

## 0.9.0

### Minor Changes

- 58c0291: Align package-selection categories with the framework README + `/docs/packages` taxonomy.

  - `Auth & Users` → `Auth & Security` (now also holds `Crypt`)
  - `Product & Features` and `Utilities` → folded into a single `Developer Experience` (Pennant + HTTP + Process + Concurrency)
  - `Image` moves to its own `Media` group
  - `AI` → `AI & Tooling`

  Eight categories total, same 24 selectable packages — no behavioral change, just consistent labels across the framework README, scaffolder prompt, and rudderjs.com `/docs/packages` catalog.

## 0.8.0

### Minor Changes

- 150b7e3: feat(orm): polymorphic many-to-many — `morphToMany` and `morphedByMany`. Owning side reads/writes route through a shared pivot table carrying `{morphName}Id` + `{morphName}Type`; `attach` / `detach` / `sync` stamp and filter by the parent's discriminator. Inverse side declares one relation per concrete inverse target (`Tag.posts`, `Tag.videos`) — keeps lookup deterministic without an inverse-side types list. Auto-installed accessors mirror the `belongsToMany` shape; declare an explicit override (`tags() { return Model.morphToMany(this, 'tags') }`) for typed wrappers (do not use a class field — it shadows the prototype method). Playground `/demos/polymorphic` extended with the Tag fan-out; scaffolder cascades the same demo into newly created apps.

## 0.7.0

### Minor Changes

- 4708f99: Add `polymorphic` to the demo multiselect (gated on ORM, parallel to `todos`). Selecting it scaffolds Post/Video/Comment models with `morphMany`/`morphTo` relations, the Prisma block (camelCase `commentableId`/`commentableType` + index), the `/demos/polymorphic` controller, and six API endpoints exercising `Model.morph()` writes + `morphTo` resolution against a closed `types: () => [Post, Video]` list. Mirrors the playground demo from rudder #197.

## 0.6.1

### Patch Changes

- bdf2a29: docs: full sweep — scaffolder refresh + monitoring graduation + broken examples

  Brings 8 docs back into agreement with the post-Phase-6 / 1.0-graduation
  state. First three are the scaffolder refresh, next three are real
  copy-paste-broken examples uncovered while sweeping, last two are the
  roadmap/architecture status updates that lagged the recent monitoring work:

  - **create-rudder-app/README.md** — prompts table updated (10 steps with
    conditional Demos step); package checklist rewritten as 8 categories /
    25 rows (sanctum, socialite, image, http, process, concurrency, pulse,
    horizon, crypt, pennant, cashier-paddle added; Demos row removed since
    it's a separate prompt now); generated structure refreshed
    (`app/Http/`, MCP `EchoTool.ts`, demo support classes, `RudderSocket.ts`,
    `lang/`; `RequestIdMiddleware` removed); demos table covers all 14;
    smoke section lists all 4 profiles; test count `111 → 169`; new
    troubleshooting entry for the AES-256 32-byte appKey requirement.
  - **claude-notes/create-app.md** — full rewrite for the cascade-aware
    prompt flow, Tier A silent install, demos registry as single source of
    truth (incl. `create-rudder-app/demos-registry` subpath export), Phase 1
    module split layout, smoke profile catalogue, fresh-worktree Prisma
    generate gotcha. The previous version still mentioned `BKSocket`,
    `Live.tsx`, the dropped Todo-module prompt, and the pre-cascade flat
    package list.
  - **CLAUDE.md** — graduation status line updated (every `@rudderjs/*`
    package on npm is 1.0.0+ as of 2026-05-02); playground tree expanded
    to show the current `app/` directories (Http, Jobs, Mail, Notifications,
    Services, Commands, Events, Exceptions) and the Demos view directory.
  - **README.md (root)** — Events example used non-existent `events({...})`
    import → `eventsProvider({...})` with class refs (not instances) matching
    playground; broadcasting client snippet referenced the old `BKSocket` →
    `RudderSocket` (file/class renamed in PR #183); package count typo
    (heading "46", body "45" — both should say 46, verified by counting
    `packages/`).
  - **docs/guide/broadcasting.md** — six `BKSocket` references → `RudderSocket`.
    Vendor-publish destination path was also wrong: `src/lib/BKSocket.ts` →
    `src/RudderSocket.ts` (the command copies from the package's `client/`
    dir to the project's `src/`, not `src/lib/`).
  - **docs/guide/events.md** — "Using the dispatcher directly" code block
    imported a non-existent `events` export and called `events()` as a
    function with non-existent method `has()`. Real API is the `dispatcher`
    singleton with `hasListeners()`. This example would not type-check or
    run as written.
  - **ROADMAP.md** — last-updated date `2026-04-20 → 2026-05-03`. Plan 7.1
    (Pulse) and 7.3 (Horizon) flipped from `⬜ untested` to `✅` — both
    shipped at 1.0+ and browser-verified end-to-end through the
    cross-process queue collector saga (#144 / #146 / #149 / #151 / #153 /
    #156 / #158 / #160). Plan 7 Deliverables refreshed with concrete shipped
    feature counts (telescope's 19 collectors with overlap/divergence vs
    Laravel's 18, pulse's 7 aggregators, horizon's lifecycle scope).
    Execution order phase 6 status `partial → mostly done`. New Packages
    Summary pulse/horizon entries flipped to ✅.
  - **Architecture.md** — `packages/rudder/` → `packages/console/` (renamed
    in PR #97, line was the only stale ref left); scaffolder prompts
    description updated to the cascade flow + demos registry; bootstrap
    providers.ts example replaced manual provider list with the canonical
    `defaultProviders()` pattern (matches CLAUDE.md, README, scaffolder
    output) + a paragraph explaining the auto-discovery flow + opt-out
    paths; Roadmap Status table Plan 7 row updated to reflect Pulse +
    Horizon shipped (was "Telescope ✅, Pulse ⬜ untested, Horizon ⬜ untested").

  After this lands, sync rudderjs-com `/docs` (per the project's standard
  4-step sweep) — broadcasting.md and events.md changes propagate.

- 58d6507: fix: smoke `default`/`todos`/`demos-all` profiles use 32-byte appKey

  The three older smoke profiles passed `'smoke-test-app-key-padding-32-bytes!'`
  (36 bytes) base64-encoded. They didn't crash because all three set
  `crypt: false`, but flipping `crypt: true` (or copy-pasting one of these
  profiles to draft a new one with crypt enabled) immediately blew up with
  `APP_KEY must be 32 bytes for AES-256. Got 36 bytes.` from `CryptProvider.boot()`.

  All four profiles now use `'smoke-test-app-key-padding-32b!!'` (32 bytes
  exactly) — same value the `no-db` profile already used. No behavior change
  for current runs; defensive against future profile additions or smoke
  maintenance turning crypt on.

## 0.6.0

### Minor Changes

- 4c297ac: feat: single-source-of-truth DEMOS registry consumed by both scaffolder and playground

  Adds `description` (long card text), `packages` (rendered list of `@rudderjs/*`
  deps the demo exercises), and optional `title` (card title that can differ
  from the multiselect `label`) to `DemoSpec`. The scaffolder's `index-view.ts`
  template is rewritten to map over `DEMOS` instead of hand-coding the same
  14 cards inline, and a new `./demos-registry` subpath export lets the
  playground import the registry as a workspace dependency:

  ```ts
  import { DEMOS, demoHref, demoTitle } from "create-rudder-app/demos-registry";
  ```

  Adding a new demo now means editing one entry in `templates/demos/registry.ts`
  — the scaffolder's generated `/demos` index AND the playground's `/demos`
  page pick up the new card automatically. Previously the metadata was
  duplicated across three places (registry gating spec, scaffolder
  `index-view.ts`, playground `Index.tsx`); each demo addition required
  edits in all three or one would silently drift.

  The playground keeps its `Billing` demo as the only `playgroundExtras`
  entry — cashier-paddle was permanently dropped from the scaffolder
  (needs real Paddle vendor account + webhook URL), so it can't live in
  the shared registry. New playground-only entries follow the same
  one-liner pattern.

  Snapshot baseline unchanged (64 files, 65272 bytes, hash matches) —
  the refactor is byte-identical to the previous output.

### Patch Changes

- 52cbc9b: test: smoke profile for ORM=none + observability + utility packages (Phase 6)

  Adds a `no-db` smoke profile that scaffolds with ORM=none and every
  package that survives the multiselect's DB filter — telescope, pulse,
  horizon, queue, mail, notifications, storage, scheduler, image,
  localization, pennant, crypt, http, process, concurrency. All 36
  generated files boot through `rudder command:list` cleanly.

  The Phase 6 plan called for switching telescope/pulse to memory storage
  when ORM=none. Verified the configs already default to `'memory'`
  (updated during prior phases), and horizon already branches to memory
  when `QUEUE_CONNECTION=sync`. The remaining gap was the absence of
  smoke coverage to lock that behavior in. Now any future change that
  re-introduces a Prisma dependency in observability boot paths fails
  CI immediately.

  Run with:

  ```bash
  pnpm --filter create-rudder-app smoke --profile=no-db
  ```

## 0.5.0

### Minor Changes

- 418fee5: feat: port 5 playground demos into the scaffolder + drop cashier-paddle (Phase 4)

  The "Select demos" prompt now offers 8 demos, gated on the relevant
  Phase-2 packages:

  - **Todos** (requires ORM) — full CRUD via a self-contained
    `app/Modules/Todo/` (TodoSchema/TodoService/TodoServiceProvider) +
    Prisma `Todo` model in `prisma/schema/modules.prisma`.
    AppServiceProvider's `boot()` registers the module dynamically.
  - **Avatar resize** (requires Storage + Image) — file upload + 256×256
    WebP via `@rudderjs/image`, persisted to the `public` Storage disk so
    the URL is browser-reachable.
  - **Worker threads / Fibonacci** (requires Concurrency) — sequential vs
    `Concurrency.run([...])` parallel cost comparison.
  - **System info** (requires Process) — `git rev-parse HEAD`,
    `node --version`, `uptime` via `Process.run()` and `Process.pool()`.
  - **Feature flags / Pennant** (requires Pennant + Auth) — four feature
    shapes (boolean, value, scoped, lottery); `/demos/pennant/beta`
    guarded by `FeatureMiddleware('beta-dashboard')` to demo the 403 path.
    AppServiceProvider seeds the four definitions.

  The cascade-aware prompt (Phase 2) handles every gate: Todos hidden when
  ORM=none, Avatar hidden without Storage+Image, etc. AppServiceProvider's
  boot() switches to `async` only when at least one demo needs dynamic
  provider registration or feature seeding.

  **Removed `@rudderjs/cashier-paddle` from the scaffolder.** It was wired
  in Phase 2 as a dep + config + env keys, but with no demo to back it
  the scaffolded project shipped a "ghost" — `config/cashier.ts` was
  generated but no controllers ever imported it, so the package just sat
  in `node_modules` until the user manually wired it. Cashier requires a
  Paddle vendor account, webhook URL, product IDs, and sandbox/prod
  toggles that the scaffolder cannot meaningfully simulate, so a built-in
  demo would either fail on first click or balloon the README. Users who
  want billing should `pnpm add @rudderjs/cashier-paddle` post-scaffold
  and follow that package's own setup — same path as `@rudderjs/queue`
  drivers and other "needs external service" packages.

  Removed surface area: `cashierPaddle` package key, `config/cashier.ts`
  template, `PADDLE_*` env keys, `@rudderjs/cashier-paddle` dep wiring,
  "Cashier-Paddle" multiselect row, and the "auth, sanctum, passport,
  billing" → "auth, sanctum, passport" log message when ORM=none.

  Smoke profiles added: `--profile=todos` (single-demo lane) and
  `--profile=demos-all` (every Phase-4 demo at once). Both pass full boot.

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

## 0.4.0

### Minor Changes

- 87e9259: feat: cascade-aware prompt flow + categorized package multiselect (Phase 2)

  The package selection step now renders 25 packages across 8 categories
  (Auth & Users / Infrastructure / Communication / AI / Internationalization /
  Product & Features / Observability / Utilities) using clack's
  `groupMultiselect`. ORM=none filters out database-dependent rows
  (auth/sanctum/passport/cashier-paddle) before render.

  **Tier A silent install**: `@rudderjs/session`, `@rudderjs/hash`, and
  `@rudderjs/cache` are now installed unconditionally. They're peers of Auth
  and required by the default bootstrap's RateLimit middleware — making them
  silent prevents broken projects when Auth is unticked.

  **11 new packages** wired into the multiselect (deps + configs):
  sanctum, socialite, image, http, process, concurrency, pulse, horizon,
  crypt, cashier-paddle, pennant.

  **Demos extracted into a dedicated step**: replaces `packages.demos: boolean`
  with a top-level `demos: string[]`. The new "Select demos" prompt appears
  after the styling step and only shows demos whose package gates are
  satisfied (e.g. WebSocket chat hidden when Broadcast isn't selected).

  New env keys added when their package is selected:
  `APP_KEY` (crypt, auto-generated 32-byte base64), GitHub/Google OAuth
  (socialite), Paddle (cashier-paddle).

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
