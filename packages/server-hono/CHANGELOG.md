# @rudderjs/server-hono

## 1.0.5

### Patch Changes

- 1f69791: Parse `application/x-www-form-urlencoded` request bodies on POST/PUT/PATCH (in addition to JSON). Required by RFC 6749 §3.2 for OAuth2 token endpoints — without this, `@rudderjs/passport`'s `/oauth/token`, `/oauth/device/code`, `/oauth/device/approve`, and POST/DELETE `/oauth/authorize` cannot accept spec-compliant clients (curl `-d`, Postman default, axios `URLSearchParams`, Spring Security, MSAL). Multipart/form-data is still left untouched (handlers parse via `c.req.parseBody()` when needed).

## 1.0.4

### Patch Changes

- 015e16e: Wire `req.token` properly and dedupe `updateLastUsed` writes (T1/T4).

  - `@rudderjs/sanctum` now augments `AppRequest` with `token?: PersonalAccessToken`. `@rudderjs/server-hono` installs a getter on the normalized request that reads from the Hono context, mirroring the existing `req.user` getter. Routes mounted behind `SanctumMiddleware()` / `RequireToken()` can read `req.token` directly — previously the docs promised this but the field was never wired.
  - `RequireToken()` reuses the token already validated by an upstream `SanctumMiddleware()` (read from `req.raw['__rjs_token']`). Stacks like `[SanctumMiddleware(), RequireToken('write')]` now issue exactly one `validateToken` call per request, halving the DB writes to `lastUsedAt` for authenticated API endpoints. `RequireToken()` still validates from scratch when used standalone.

## 1.0.3

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.

## 1.0.2

### Patch Changes

- a0b96f9: Add Laravel-style `router.group()`, subdomain routing, and `.missing()` 404 customisation (Laravel parity #5, PR2 of 3).

  **`router.group(opts, fn)`** — apply a `prefix`, `domain`, or `middleware` stack to every route registered in the callback. Nested groups concatenate prefixes and middleware; the innermost defined `domain` wins.

  ```ts
  router.group({ prefix: "/admin", middleware: [adminAuth] }, () => {
    router.get("/users", listUsers); // GET /admin/users (with adminAuth)
  });

  router.group({ domain: ":tenant.example.com", prefix: "/api" }, () => {
    router.get("/me", me); // GET :tenant.example.com/api/me
  });
  ```

  Distinct from `runWithGroup('web' | 'api', …)` — that tags routes with their middleware-group label, this is the user-facing scoping primitive. Both can be active at the same time.

  **`RouteBuilder.domain(template)`** — restrict a route to a host. Templates accept `:param` segments that capture into `req.params` alongside path params. Mismatched hosts return 404. Per-route `.domain()` overrides any `domain` set by an active group.

  ```ts
  router.get("/users", listUsers).domain("api.example.com");
  router.get("/me", me).domain(":tenant.example.com"); // req.params.tenant
  ```

  **`RouteBuilder.missing(fn)`** — custom response when an explicit `router.bind('user', User)` resolves to `null`. Receives `(req, err)` and returns any value a route handler may return: `Response`, plain object → JSON, string → body, or `undefined` (callback wrote to `res` directly). Optional bindings do NOT trigger `.missing()`.

  ```ts
  router
    .get("/users/:user", show)
    .missing((_req, err) =>
      Response.json({ error: err.message }, { status: 404 })
    );
  ```

  **Contract additions (`@rudderjs/contracts`)** — `RouteDefinition` gains two optional fields: `host?: string` and `missing?: (req, err) => unknown | Promise<unknown>`. The `err` is duck-typed (`httpStatus`, `param`, `value`, `model`) so contracts stays free of `@rudderjs/router`.

  **`@rudderjs/server-hono`** — pre-handler host gate (`matchHost()`) returns 404 on host mismatch and stashes captured subdomain `:param` segments on the Hono context. `normalizeRequest()` merges them into `req.params`; path params win on collision.

  This is PR2 of the router parity sweep. `Route::resource` / `apiResource` / `singleton` and `make:controller --resource` follow in PR3.

- Updated dependencies [1805d0c]
- Updated dependencies [fcc57f9]
- Updated dependencies [a0b96f9]
  - @rudderjs/contracts@1.2.0

## 1.0.1

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

## 0.1.1

### Patch Changes

- Updated dependencies [be10c83]
  - @rudderjs/contracts@0.2.0

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

## 0.0.7

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

## 0.0.5

### Patch Changes

- Add `@universal-middleware/core` as a direct dependency so apps no longer need to list it explicitly.

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/contracts@0.0.2
