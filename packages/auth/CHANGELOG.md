# @rudderjs/auth

## 6.0.0

### Patch Changes

- Updated dependencies [4ce1e09]
  - @rudderjs/vite@2.0.0
  - @rudderjs/session@2.0.0

## 5.1.1

### Patch Changes

- 79eadf7: `PasswordBroker` now throws on construction when `auth.passwords.secret` is unset and `NODE_ENV === 'production'`. Previously it silently used a hardcoded fallback (`'password-reset'`), which made stored token hashes predictable across deployments. Dev and test still boot — they get a one-time `console.warn` and the hardcoded fallback.

  Apps already setting `auth.passwords.secret` (typically derived from `APP_KEY`) are unaffected. Apps relying on the silent fallback in production must set the secret before upgrading.

- Updated dependencies [690fa00]
  - @rudderjs/session@1.1.1

## 5.1.0

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

### Patch Changes

- d0db9f0: **`@rudderjs/boost`** — overhauled the generated agent guidelines output.

  Inspired by Laravel Boost's recent shape. Concrete changes:

  - **`CLAUDE.md` is now ~135 lines, down from ~1,350.** Replaced the inline content dump of every package guideline with structured pointers to `.ai/guidelines/<package>.md`. The full per-package content still lives in `.ai/guidelines/` — agents load it on demand.
  - **New structure** in `CLAUDE.md`: XML wrapper (`<rudderjs-boost-guidelines>`), `=== foundation rules ===` / `=== boost rules ===` / `=== skills activation ===` dividers, a Foundational Context section listing installed `@rudderjs/*` versions, a Boost MCP Tools section listing every exposed tool, and a Skills Activation section with explicit `**ACTIVATE when:** …` / `**SKIP when:** …` heuristics per skill.
  - **Skill frontmatter enriched.** Each `SKILL.md` now declares `license`, `appliesTo`, `metadata.author`, plus the new `trigger` and `skip` fields that drive the CLAUDE.md activation section. `appliesTo` is the new filter — skills install only when at least one of their target packages is present (override with `--include-all-skills`).
  - **Three skills modularized** into `SKILL.md` + `rules/*.md`:
    - `orm-models` (`@rudderjs/orm`) — split into 5 rule files (defining-models, querying, crud-and-observers, factories, resources).
    - `auth-setup` (`@rudderjs/auth`) — split into 5 rule files (provider-setup, guards-and-handlers, auth-views, gates-and-policies, email-and-password-reset).
    - `mcp-servers` (`@rudderjs/mcp`) — split into 5 rule files (tools, resources-and-prompts, server-assembly, transports, testing-and-di).
    - Each `SKILL.md` is now a compact Quick Reference (~40 lines) linking to the matching rule file. Rule files use paired Incorrect/Correct examples consistently.
  - **`boost.json`** now records the active skill list under a `skills` field.

  Migration: run `pnpm rudder boost:update` (or `boost:install`) to regenerate the new CLAUDE.md / boost.json / skill files. The old output is fully replaced — local edits to `CLAUDE.md` will be overwritten, same as before. Per-package guidelines and skills install paths are unchanged.

  No API breaks. The `@rudderjs/*` package bumps are guideline / skill content changes for packages that ship `boost/` directories.

- b74fc57: Add `@rudderjs/middleware/client` subpath export for browser-safe helpers. `getCsrfToken()` now lives at this subpath so it can be imported from view code without dragging `@rudderjs/cache`, `node:crypto`, and the rate-limit machinery into the client bundle.

  The main entry still re-exports `getCsrfToken` for backward compatibility, but browser code should import from `@rudderjs/middleware/client`. The four vendored auth views (`Login`, `Register`, `ForgotPassword`, `ResetPassword` under `packages/auth/views/react/`) are updated to use the new subpath — fresh `create-rudder-app` projects will pick up the fix on next install.

  Also replaces `randomUUID` from `node:crypto` with `globalThis.crypto.randomUUID()` in `@rudderjs/cache`'s lock implementation. Both Node 18+ and modern browsers expose the Web Crypto API, so the module no longer crashes when transitively pulled into a client bundle. Fixes the `Module "node:crypto" has been externalized for browser compatibility` runtime error on `/login` and other CSRF-protected forms.

- Updated dependencies [d0db9f0]
- Updated dependencies [2670dc3]
- Updated dependencies [937cdac]
  - @rudderjs/view@1.1.0
  - @rudderjs/session@1.1.0
  - @rudderjs/vite@1.1.0

## 5.0.1

### Patch Changes

- 9b33c2c: Tier 2 quality sweep — error guards, timing safety, lock parity, CORS fix.

  - **crypt**: `decrypt()` / `decryptString()` now throw descriptive errors on malformed base64 or non-JSON input instead of an opaque `SyntaxError`
  - **auth**: `handleEmailVerification()` uses `timingSafeEqual` for email hash comparison; `PasswordResetConfig` gains an optional `secret` field so stored token hashes can be bound to APP_KEY
  - **cache**: `RedisAdapter.get()` catches corrupt JSON entries, evicts them, and returns `null`; `MemoryLock.acquire()` returns `false` for zero-TTL (matches `RedisLock` behaviour)
  - **session**: `verify()` replaces manual XOR loop with `crypto.timingSafeEqual`
  - **middleware**: `CorsMiddleware` reflects the matched request origin from an allowlist instead of joining all origins with `', '` (browsers require a single origin value — the old behaviour was silently broken)

- Updated dependencies [f867181]
- Updated dependencies [0f69018]
- Updated dependencies [b506997]
- Updated dependencies [9b33c2c]
  - @rudderjs/contracts@1.4.0
  - @rudderjs/core@1.1.3
  - @rudderjs/router@1.2.0
  - @rudderjs/session@1.0.5

## 5.0.0

### Major Changes

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

### Minor Changes

- 015e16e: Stop leaking sensitive user columns into `req.user` (T5).

  - `userToPlain(user)` is now exported from `@rudderjs/auth`. Always strips functions plus `password`, `rememberToken`, and `remember_token` (the last two cover both Prisma camelCase and Drizzle/raw-Laravel snake_case schema choices). The previous filter only removed functions and `password`, so columns like `remember_token`, `two_factor_secret`, and `email_verification_token` could surface in `req.user`.
  - `Authenticatable.getHidden?(): string[]` is a new optional method on the contract — Laravel's `$hidden` array. User models that implement it can name app-specific sensitive columns (`two_factor_secret`, `email_verification_token`, …) and `userToPlain` will strip them on top of the always-hidden defaults.
  - `@rudderjs/sanctum`'s middleware now delegates to the shared `userToPlain` instead of inlining a near-duplicate filter loop, so sanctum-authenticated requests inherit the same protection.
  - Fixed a pre-existing bug in `userToPlain` where the spread of the original record was placed _after_ the explicit `String(...)` conversions for `id` / `name` / `email`, silently overriding them. The conversions now win on collision so `id`, `name`, and `email` are guaranteed strings as the `AuthUser` type promises.

- 015e16e: Fix Sanctum's hardwiring to the session driver (T2/T7).

  - `AuthManager.createProvider(name?)` is now public. With no `name`, it falls back to the default guard's configured provider; with a `name`, it resolves any provider in `auth.providers` independently of any guard. Pure-API apps can now use Sanctum without registering `@rudderjs/session` or a session guard.
  - `SanctumServiceProvider.boot()` resolves the user provider through `manager.createProvider(config.provider)` instead of `manager.guard().provider`. The previous code instantiated a `SessionGuard` just to read its provider, which threw on any non-session default guard. The catch around `app.make('auth.manager')` now narrows to "binding not found" only — provider-resolution errors propagate verbatim instead of being rewritten to "No auth manager found".
  - `SanctumConfig.provider?: string` overrides which entry in `auth.providers` Sanctum uses. Required for pure-API apps; optional in mixed (web + API) setups.

### Patch Changes

- 942bd78: Fix two observability inconsistencies in `Gate`:

  - `_getGateObservers()` no longer caches `null`. The previous lazy accessor cached the global lookup on first call; if `Gate.allows()` ran before `gate-observers.ts` was imported, the cache trapped `null` permanently and downstream subscribers (e.g. Telescope's `GateCollector`) never received events even after they subscribed. The lookup is one property read, so dropping the cache costs nothing measurable.
  - `Gate.forUser(user).allows(ability, model)` now reports `resolvedVia: 'policy'` (with the policy name) when the policy is registered but the ability method is missing — matching the static `Gate.allows()` path. The previous `resolvedVia: 'default'` contradicted the static path and miscategorised the event in Telescope.

- Updated dependencies [b436a02]
- Updated dependencies [5bafd13]
- Updated dependencies [d2d3e2d]
  - @rudderjs/session@1.0.4

## 4.0.3

### Patch Changes

- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [dfba4df]
- Updated dependencies [4c8cd07]
  - @rudderjs/hash@1.0.1
  - @rudderjs/session@1.0.3
  - @rudderjs/core@1.1.2

## 4.0.2

### Patch Changes

- 550518c: Auth views now send `X-CSRF-Token` on form submission

  The vendored React views (`Login`, `Register`, `ForgotPassword`,
  `ResetPassword`) under `views/react/` previously POST'd credentials
  without a CSRF token. Now that `CsrfMiddleware` runs on the `web` group
  by default (the routes registered by `registerAuthRoutes()` live on the
  web group), every POST needs to send the token.

  The views now import `getCsrfToken` from `@rudderjs/middleware` and
  attach `X-CSRF-Token` to the `fetch()` headers. Existing apps that
  vendored the previous views continue to work — they just need to either
  re-vendor (`cp -R node_modules/@rudderjs/auth/views/react/. app/Views/Auth/`)
  or add the header themselves.

- Updated dependencies [2ea4acf]
  - @rudderjs/session@1.0.2

## 4.0.1

### Patch Changes

- 5fbd6e5: Fix `appendToGroup` auto-install in WebContainer / restrictive runtimes

  Both `AuthProvider.boot()` and `SessionProvider.boot()` previously used a
  dynamic `await import('@rudderjs/core')` wrapped in a silent `try/catch` to
  grab `appendToGroup`. The dynamic import was unnecessary — both files
  already statically import other symbols from `@rudderjs/core` — and the
  catch swallowed any module-resolution error without logging.

  In WebContainer (StackBlitz) the dynamic import fails for reasons related
  to pnpm symlink resolution under WASI-Node, so the catch silently dropped
  the auto-install. Apps ended up booting without `SessionMiddleware` and
  `AuthMiddleware` on the `web` group, causing `auth().user()` to throw
  "No auth context" on any web route.

  Use the static import. No catch.

- Updated dependencies [5fbd6e5]
  - @rudderjs/session@1.0.1

## 4.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/hash@1.0.0
  - @rudderjs/router@1.0.0
  - @rudderjs/session@1.0.0
  - @rudderjs/view@1.0.0

## 3.2.1

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/router@0.3.1
  - @rudderjs/session@0.1.2

## 3.2.0

### Minor Changes

- 5239815: Make Tailwind optional in create-rudder-app and refactor auth views to semantic class names.

  `create-rudder-app` now ships two `app/index.css` variants from a single JSX source: a Tailwind `@apply` version (default) and a hand-authored plain CSS version with CSS variables + `prefers-color-scheme` dark mode. Answer "No" to the `Add Tailwind CSS?` prompt to scaffold a zero-Tailwind project that still looks styled out of the box — landing page, auth forms, and error page all render against the plain variant.

  `@rudderjs/auth` React views (Login / Register / ForgotPassword / ResetPassword) are refactored to use the same semantic vocabulary (`auth-wrap`, `form-card`, `form-input`, `auth-link`, …). The visual output is unchanged for Tailwind apps; apps that vendored the previous React auth views will need to re-vendor (`pnpm rudder vendor:publish --tag=auth-views --force` or copy from `node_modules/@rudderjs/auth/views/react/`) and either keep Tailwind or bring their own CSS for the new selectors.

## 3.1.1

### Patch Changes

- 5ca3e29: Fix type-system contravariance errors that rejected common subclass patterns.

  **`@rudderjs/queue`** — `Job.dispatch`'s `this: new (...args: unknown[]) => T` constraint rejected every subclass with a typed constructor (`constructor(public name: string, public email: string)`). Parameter types are contravariant, so a narrower signature can't satisfy `unknown[]`. Relaxed to `new (...args: any[]) => T`; `ConstructorParameters<typeof this>` still enforces arg-level type safety at the call site.

  **`@rudderjs/auth`** — `Gate.define(ability, callback)` accepted only `(user, ...args: unknown[])` callbacks. A typed callback like `(user, post: Post) => …` failed the same contravariance check. Made `Gate.define` generic on the args tuple so callers can narrow without casting:

  ```ts
  Gate.define<[Post]>("edit-post", (user, post) => user.id === post.authorId);
  ```

  The stored callback is widened to the internal `AbilityCallback` type; narrowing only matters at the call site.

  Both fixes add regression tests covering the subclass-constructor / typed-arg patterns. No runtime behavior change — pure typing fix.

## 3.1.0

### Minor Changes

- d3d175c: Add `BaseAuthController` + restructure scaffolded auth routes (Laravel Breeze-style).

  **`@rudderjs/auth`** — new `BaseAuthController` abstract class. Ship the five standard auth POST handlers (`sign-in/email`, `sign-up/email`, `sign-out`, `request-password-reset`, `reset-password`) as decorated methods on a base class. Subclasses set `userModel`, `hash`, and `passwordBroker`; override any method to customize. Decorator metadata is inherited through the prototype chain — `Route.registerController(YourAuthController)` picks up all five routes without re-decorating.

  New exports: `BaseAuthController`, `AuthUserModelLike`, `AuthHashLike`.

  **`create-rudder-app`** — two fixes rolled together:

  1. **Bug fix.** The session-mutating auth handlers were emitted into `routes/api.ts`, but `SessionMiddleware` is only auto-installed on the **web** group. `Auth.attempt/login/logout` calls `session.regenerate()`, which threw `No session in context` on sign-up. Auth submit handlers now live on the web group.

  2. **Shape change.** Scaffolded apps now get a real `app/Controllers/AuthController.ts` (extends `BaseAuthController`) instead of ~60 lines inlined in `routes/web.ts`. `routes/web.ts` shrinks to `registerAuthRoutes(Route, { middleware: webMw })` (GETs) + `Route.registerController(AuthController)` (POSTs). Welcome page uses the cleaner `auth().user()` helper — no manual `runWithAuth` / `app().make<AuthManager>()` wrapping.

  Customization path: edit `app/Controllers/AuthController.ts` — subclass `BaseAuthController` methods you want to change, or add new ones. The class-level `@Middleware([authLimit])` decorator applies rate limiting to every POST.

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1
  - @rudderjs/hash@0.0.7
  - @rudderjs/session@0.1.1

## 3.0.0

### Minor Changes

- ba543c9: Middleware groups — `web` vs `api`, Laravel-style.

  Routes loaded via `withRouting({ web })` are tagged `'web'`; via `withRouting({ api })` tagged `'api'`. The server adapter composes the matching group's middleware stack before per-route middleware. Framework packages install into a group during `boot()` via the new `appendToGroup('web' | 'api', handler)` export on `@rudderjs/core`, instead of calling `router.use(...)` globally.

  - **`MiddlewareConfigurator`** — adds `.web(...handlers)` and `.api(...handlers)` alongside the existing `.use(...)`. Use `m.use(...)` for truly global middleware (logging, request-id), `m.web(...)` / `m.api(...)` for group-scoped middleware.
  - **`@rudderjs/session`** — `sessionMiddleware` now auto-installs on the `web` group. Apps no longer need `m.use(sessionMiddleware(cfg))` in `bootstrap/app.ts`.
  - **`@rudderjs/auth`** — `AuthMiddleware` now auto-installs on the `web` group (was a global `router.use()`). `req.user` is populated on web routes only; api routes are stateless by default and must opt into bearer auth (e.g. `RequireBearer()` from `@rudderjs/passport`).
  - **`SessionGuard.user()`** — soft-fails when no session ALS is in context (returns `null` instead of throwing). Matches Laravel's `Auth::user()` semantics — removes the trap where api routes would 500 with "No session in context" when auth was installed but session was not.
  - **`RouteDefinition.group?: 'web' | 'api'`** — new optional field exposed via `@rudderjs/contracts`. Server adapters may implement `applyGroupMiddleware(group, handler)` to support the feature; adapters without it ignore group tags and behave as before.

  **Breaking:** `req.user` is now `undefined` on api routes unless a bearer/token guard middleware runs. This is intentional — the previous behavior (AuthMiddleware running globally) forced session to be load-bearing on every request, including stateless APIs.

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0
  - @rudderjs/session@0.1.0
  - @rudderjs/hash@0.0.6

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/view@0.0.3
  - @rudderjs/core@0.0.12
  - @rudderjs/hash@0.0.5
  - @rudderjs/session@0.0.9

## 2.0.0

### Patch Changes

- 6fb47b4: `registerAuthRoutes()` now names its routes: `login`, `register`, `password.forgot`, `password.reset`. This enables callers to check `Route.has('login')` (Laravel's `Route::has()` idiom) — useful for rendering nav links conditionally based on whether the auth package registered its routes.
- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11
  - @rudderjs/hash@0.0.4
  - @rudderjs/session@0.0.8

## 1.0.0

### Patch Changes

- 9fa37c7: `registerAuthRoutes()` now names its routes: `login`, `register`, `password.forgot`, `password.reset`. This enables callers to check `Route.has('login')` (Laravel's `Route::has()` idiom) — useful for rendering nav links conditionally based on whether the auth package registered its routes.
- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10
  - @rudderjs/hash@0.0.3
  - @rudderjs/session@0.0.7

## 0.2.1

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
  - @rudderjs/hash@0.0.2
  - @rudderjs/router@0.0.4
  - @rudderjs/session@0.0.6
  - @rudderjs/view@0.0.2

## 0.1.0

### Minor Changes

- Rename `betterAuth()` to `auth()` (old name kept as deprecated alias). Simplify `BetterAuthConfig` — remove `database` and `databaseProvider` fields. The provider now auto-discovers the PrismaClient from the DI container (registered by `prismaProvider`) or creates its own from the optional `dbConfig` second argument. Add optional deps for Prisma adapters.

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.5

## 0.0.2

### Patch Changes

- Updated dependencies
  - @rudderjs/contracts@0.0.2
  - @rudderjs/core@0.0.4
  - @rudderjs/router@0.0.3
