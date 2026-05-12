# @rudderjs/session

## 1.1.0

### Minor Changes

- 2670dc3: Follow up on #391 — adopt the page-context enhancer pattern in two more packages so views read framework state directly from `pageContext`:

  - **`@rudderjs/session`** registers an enhancer that sets `pageContext.flash` to the flash bag from the previous request. New `Session.allFlash()` (static) + `SessionInstance.allFlash()` accessor return a copy of all flash entries; the existing per-key `getFlash(key)` API is unchanged. `Vike.PageContext.flash?: Record<string, unknown>` augmentation auto-applies when both `@rudderjs/session` and `@rudderjs/vite` are installed.
  - **`@rudderjs/localization`** registers an enhancer that sets `pageContext.locale` to the active request locale via `getLocale()`. Falls back to the config default outside the ALS context. `Vike.PageContext.locale?: string` augmentation auto-applies similarly.

  Both registrations are lazy + try/catch around the optional `@rudderjs/vite` peer — no behavior change for API-only apps that don't install it.

  No API breaks. New optional peer: `@rudderjs/vite` on both packages.

### Patch Changes

- Updated dependencies [937cdac]
  - @rudderjs/vite@1.1.0

## 1.0.5

### Patch Changes

- 9b33c2c: Tier 2 quality sweep — error guards, timing safety, lock parity, CORS fix.

  - **crypt**: `decrypt()` / `decryptString()` now throw descriptive errors on malformed base64 or non-JSON input instead of an opaque `SyntaxError`
  - **auth**: `handleEmailVerification()` uses `timingSafeEqual` for email hash comparison; `PasswordResetConfig` gains an optional `secret` field so stored token hashes can be bound to APP_KEY
  - **cache**: `RedisAdapter.get()` catches corrupt JSON entries, evicts them, and returns `null`; `MemoryLock.acquire()` returns `false` for zero-TTL (matches `RedisLock` behaviour)
  - **session**: `verify()` replaces manual XOR loop with `crypto.timingSafeEqual`
  - **middleware**: `CorsMiddleware` reflects the matched request origin from an allowlist instead of joining all origins with `', '` (browsers require a single origin value — the old behaviour was silently broken)

- Updated dependencies [f867181]
- Updated dependencies [0f69018]
  - @rudderjs/contracts@1.4.0
  - @rudderjs/core@1.1.3

## 1.0.4

### Patch Changes

- b436a02: Driver hygiene fixes for `@rudderjs/session`. No API changes; behavior is identical for the happy path.

  - **S4: RedisDriver caches the connect-promise, not the client.** The previous lazy init (`if (!this.client) this.client = new Redis(...)`) was racy — two concurrent first-request callers each fell through the guard and constructed a separate ioredis instance, leaking the first one's FD and retry timer. We now cache `Promise<Client>` so concurrent callers all await the same in-flight connect; rejected promises are dropped so a transient connect failure can be retried on the next call.
  - **S5: `SessionMiddleware()` reuses the container-bound singleton.** The factory previously called `sessionMiddleware(config)` on each call, building a fresh driver per route — every api-route opt-in spawned an independent RedisDriver. It now returns `app().make('session.middleware')`, the singleton bound by `SessionProvider.boot()`, so per-route mounts share the same connection as the auto-installed web group.
  - **S6: `SessionInstance` tolerates legacy/corrupt payloads.** The constructor unconditionally read `payload.flash_next`, throwing on entries that omitted the field (legacy redis writes, third-party producers, manual `redis-cli` edits). Missing `flash_next` and `data` now default to `{}`.
  - **S7: Documented cookie-driver `regenerate()` / `destroy()` limitation.** The cookie driver is stateless — there is no server-side store to delete from, so `regenerate()` cannot invalidate the previous signed cookie before its `Max-Age` expires. JSDoc and a new "Driver tradeoffs" table in the README now spell this out, so apps that need true post-logout invalidation know to use the redis driver.

- 5bafd13: Security fixes for the session middleware. Redis-driver users will be silently logged out once on upgrade — existing unsigned cookies fail verification and a fresh signed cookie is issued on the next request.

  - **Redis driver: HMAC-sign the cookie value.** The redis driver previously stored the raw session UUID in the cookie and used it as the redis key. An attacker who guessed, sniffed, or enumerated a UUID could hijack the session — true bearer-token semantics, despite the README emphasising signed cookies. The cookie value is now `${id}.${hmac}` (HMAC-SHA256 over the id, keyed by `session.secret`) and `RedisDriver.load()` verifies the signature before touching redis.
  - **Redis driver: cache miss no longer fixates on the cookie-supplied id.** The previous behaviour returned an empty session keyed by the cookie value (`emptyWithId(cookieValue)`), letting an attacker plant an id, wait for the victim to log in under it, and then replay the cookie. Cache misses now mint a fresh UUID, so a planted (or expired-then-replayed) id can never carry forward into a new session.
  - **Middleware: persist session on error.** `await _als.run(session, next); await session.save(res)` skipped `save()` when `next()` threw, dropping flash messages on error redirects and never writing `Set-Cookie` for new sessions on error responses. `session.save()` now runs in a finally-style block; errors from `save()` only surface when `next()` did not already throw, so the original handler exception is never masked.

- d2d3e2d: Add OAuth state generation/validation to `@rudderjs/socialite` (O5 — closes the login-CSRF / state-fixation gap across every provider).

  Previously, `getRedirectUrl(state?)` accepted an optional `state` but the framework neither generated nor validated it — `user(req)` ignored `query.state` entirely. Laravel Socialite (the inspiration) auto-generates and validates by default; this port had dropped that. Without state validation, an attacker can swap their authorization code into a victim's callback and link the victim's session to the attacker's social account.

  What changed:

  - **Stateful by default.** `redirect()` / `getRedirectUrl()` mints a 40-hex-char CSPRNG token, stores it on the session under `socialite_state:<provider>`, and embeds it in the OAuth URL. `user(req)` extracts the returned `state` from the query (or, for Apple's `form_post` callback, from the request body), compares with `crypto.timingSafeEqual` against the session-stored value, and throws `InvalidStateException` on mismatch / missing state / no session in context.
  - **One-time use.** Both successful and failed validation clear the session slot — a leaked or sniffed `state` cannot be replayed.
  - **Per-provider namespace.** `socialite_state:github`, `socialite_state:google`, etc. — concurrent OAuth flows on the same session don't collide.
  - **`.stateless()` opt-out.** For OAuth flows that can't reach the session (mobile, S2S token grants), `.stateless()` returns `this` and disables both generation and validation. Call-site equivalent of Laravel's `->stateless()`.
  - **`@rudderjs/session` is now a peer dep.** Stateful default needs the session in context. Apps using `@rudderjs/socialite` on the `web` group already have it (auto-installed by `SessionProvider`).

  `@rudderjs/session`: adds `_runWithSession(session, fn)` test-only helper so other packages can exercise code that goes through the `Session` static facade in unit tests without standing up the full middleware. Marked `@internal`; not part of the runtime contract.

  Migration notes:

  - Apps already on the `web` group with `@rudderjs/session` registered get the protection automatically — no code changes.
  - Apps that mount Socialite routes in the `api` group (no session) need to either opt into session-per-route or call `.stateless()` on each driver call. Stateless mode is appropriate for token-grant flows but **don't** use it on browser-initiated OAuth redirects without your own state implementation.
  - Existing callers passing `state` explicitly to `getRedirectUrl(state)` keep working — caller-supplied state always wins and skips the generator.

## 1.0.3

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.
- Updated dependencies [4c8cd07]
  - @rudderjs/core@1.1.2

## 1.0.2

### Patch Changes

- 2ea4acf: Fix multi-value `Set-Cookie` collapse on web-group routes

  When middleware on the `web` group wrote multiple cookies cooperatively
  (canonically: `CsrfMiddleware` setting `csrf_token` + `SessionMiddleware`
  setting `rudderjs_session`), only one survived to the browser. Two
  distinct bugs were involved:

  1. `normalizeResponse` in server-hono tracked headers as a
     `Record<string, string>`, so two `res.header('Set-Cookie', ...)` calls
     would clobber each other.
  2. When the handler returned a `ViewResponse` or raw `Response`, server-hono
     set `c.res = ...` directly bypassing `res.json()/res.send()`, so the
     wrapper's pending headers never got applied to the response.
  3. `session.save()` cloned the existing response via
     `new Response(body, { headers: existingHeaders })` to append its own
     cookie — Node's undici-backed `Response` constructor collapses
     multi-value `Set-Cookie` down to one when init.headers is a `Headers`
     instance, dropping any cookies (e.g. CSRF) that earlier middleware wrote.

  Fix: track Set-Cookie as an array in `normalizeResponse`, merge pending
  headers into `c.res` after view/raw paths set it, and have `session.save()`
  mutate `c.res.headers` in place via `headers.append('Set-Cookie', value)`
  instead of cloning.

  Visible symptom on the playground: GET /register returned only one
  Set-Cookie, so the browser never received `csrf_token` and every form
  POST 419'd with `CSRF token mismatch`.

## 1.0.1

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
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0

## 0.1.2

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.1.0

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
  - @rudderjs/core@0.1.0

## 0.0.9

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.8

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.7

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.6

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
