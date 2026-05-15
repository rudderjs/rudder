# @rudderjs/router

## 1.2.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/contracts@1.6.1

## 1.2.0

### Minor Changes

- b506997: Add `router.fallback()` catch-all route. Fix locale-sensitive param sort in `_computeSignature` (use byte-order comparison for deterministic cross-locale signatures). Fix `timingSafeEqual` to check buffer lengths before calling (avoids throw/catch timing side-channel on malformed-length signatures). Document `router.resource()`, `router.bind()`, and `router.fallback()` in boost guidelines.

### Patch Changes

- Updated dependencies [f867181]
  - @rudderjs/contracts@1.4.0

## 1.1.2

### Patch Changes

- 7125676: Fix `Url.isValidSignature(req)` so signed URLs verify correctly behind any server adapter.

  Hono's `c.req.url` is a fully-qualified URL (`http://host/path?query`), not a bare path — that's what `server-hono` forwards as `req.url`. The previous verifier split `req.url` at the first `?` and treated the left half as the pathname, so the HMAC was computed over `http://host/path` while `Url.sign(path)` had hashed just `/path`. Pathnames never matched. Every signed-URL request returned 403 in production:

  - `serveTemporaryUrls()` (signed file downloads)
  - `ValidateSignature()` middleware (any custom signed route)
  - `Url.signedRoute(...)` use cases including the email-verification flow shipped by `@rudderjs/auth`

  `isValidSignature` now parses `req.url` through `new URL(req.url, base)` so both fully-qualified URLs and bare paths collapse to the same pathname + searchParams pair the signer used. Existing tests cover both forms, plus tampered-pathname / tampered-query / expired-signature / round-trip-via-signedRoute. No change to `Url.sign(path, ...)` — it has always taken paths.

## 1.1.1

### Patch Changes

- f86849a: Two follow-up fixes on the routing surface from the Laravel-13 parity rollout (#213/#214/#215):

  - **Balanced-brace scanner is now escape- and character-class-aware.** The `:param{regex}` block scanner used by both `route()` URL generation and route-binding param extraction tracked depth via `{` / `}` only. Two real edge cases bit through:

    - `whereIn(['a}b'])` regex-escapes `}` to `\}`. The naive scanner treated the `\}` as a block terminator, mis-extracted the param name (`:idc)}` instead of `:id`), and emitted broken URLs from `route()`.
    - `where(/[^}]+/)` then a follow-up `where(...)` call: the inner `}` inside `[^}]` would terminate the block early, leaving `]+}` junk in the rewritten path.

    Both `stripRegexSegments()` and `RouteBuilder.where()`'s scanner now share a single `consumeBraceBlock()` helper that recognises `\<char>` escape pairs and `[ ... ]` character-class context. Built-in shortcuts (`whereNumber`, `whereUuid`, etc.) are unchanged because none of their patterns hit either edge case.

  - **`RouteBuilder.where()` docstring now matches code reality.** The previous wording claimed `^` / `$` anchors were "ignored, since Hono anchors per-segment" — only flags are dropped automatically (via `RegExp.source`). Anchors pass through; Hono's per-segment anchoring makes them harmless redundancy. Updated to describe what actually happens.

## 1.1.0

### Minor Changes

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

- ca63e78: Add Laravel-style `Route::resource` / `apiResource` / `singleton` to `@rudderjs/router` and `make:controller --resource`/`--api`/`--singleton` flags to `@rudderjs/cli` (Laravel parity #5, PR3 of 3).

  **Public API on `Router`:**

  - `router.resource(name, Ctrl, opts?)` — registers the seven canonical RESTful routes (`index`/`create`/`store`/`show`/`edit`/`update`/`destroy`). The `update` route is registered for both `PUT` and `PATCH` at the same path.
  - `router.apiResource(name, Ctrl, opts?)` — same as `resource` but skips `create` + `edit` (no HTML form pages).
  - `router.singleton(name, Ctrl, opts?)` — registers `show`/`edit`/`update` only. The returned `SingletonRegistration` exposes `.creatable()` (adds `GET /<name>/create` + `POST /<name>`) and `.destroyable()` (adds `DELETE /<name>`).

  ```ts
  class PostController {
    async index(ctx) {
      /* … */
    }
    async show(ctx) {
      /* … */
    }
    async store(ctx) {
      /* … */
    }
    // …
  }

  router.resource("posts", PostController);
  router.apiResource("posts", PostController, { only: ["index", "show"] });
  router.singleton("profile", ProfileController).creatable().destroyable();
  ```

  **Controller convention:** plain class, no decorators. Methods are matched by name to the canonical verbs. **Methods the controller doesn't implement are silently skipped** — a controller with only `index`/`show` works without an `only` or `except` filter.

  **`ResourceOptions`:** `only`, `except`, `parameters` (override `:param` segment name), `names` (override generated route names), `middleware`.

  **Default route names:** `<resource>.<verb>` (e.g. `posts.index`, `posts.show`). Default `:param` name is a naive singular of `name` (`posts → post`, `categories → category`, `boxes → box`); irregular plurals must use the `parameters` option.

  **Per-route customisation:** the returned `ResourceRegistration` exposes the underlying `RouteBuilder[]` in declaration order. Apply `where*()` or per-route middleware to a single verb without affecting the rest:

  ```ts
  const reg = router.resource("posts", PostController);
  reg.builders[3].whereNumber("post"); // constrain show route only
  ```

  **Scaffolder support:** `make:controller` accepts three mutually-exclusive flags:

  ```bash
  pnpm rudder make:controller PostController --resource     # full 7-verb plain class
  pnpm rudder make:controller PostController --api          # 5-verb (no create/edit)
  pnpm rudder make:controller ProfileController --singleton # show/edit/update only
  ```

  Default `make:controller` (no flag) still emits the decorator-based stub.

  This completes the router parity sweep (#5). PR1 added `where*()` constraints; PR2 added `router.group()` / subdomain routing / `.missing()`. No changes to the public surface of any other package.

  **Internal note:** `MakeSpec.stub` callback now receives the parsed CLI opts as a second argument (`(className, opts) => string`), enabling per-flag stub dispatch. Existing single-arg callbacks continue to type-check.

- fcca26b: Add Laravel-style `where*()` constraint shortcuts to `RouteBuilder` (Laravel parity #5, PR1 of 3).

  **Public API on `RouteBuilder`:**

  - `where(param, regex)` — base method; accepts a string pattern or a `RegExp` (uses `.source`).
  - `whereNumber(param)` — `[0-9]+`.
  - `whereAlpha(param)` — `[A-Za-z]+`.
  - `whereAlphaNumeric(param)` — `[A-Za-z0-9]+`.
  - `whereUuid(param)` — UUID of any version.
  - `whereUlid(param)` — Crockford base32 ULID (26 chars).
  - `whereIn(param, values)` — alternation over regex-escaped literal values.

  ```ts
  router.get("/users/:id", handler).whereNumber("id").name("users.show");
  // → /users/:id{[0-9]+}, named users.show
  router
    .get("/posts/:status", handler)
    .whereIn("status", ["draft", "published"]);
  ```

  Mutates `definition.path` in place to Hono's `:param{regex}` syntax. Throws when the path has no `:param` segment, or when `whereIn` is given an empty values array. Order-independent against `.name()`: chaining `where*()` after `.name()` still updates the registered named-route path.

  **Exported pattern constants** — `ROUTE_PATTERN_NUMBER`, `_ALPHA`, `_ALPHANUM`, `_UUID`, `_ULID` — for apps that need to compose their own Hono constraint strings.

  **Internal:** `route()` URL generator and the route-binding param scanner now use a balanced-brace stripper so nested quantifier braces inside constraints (e.g. UUID's `{8}`/`{4}`) don't trip the `:param` regex.

  This is PR1 of the router parity sweep. Subdomain routing, `missing()`, `Route::resource`, and `make:controller --resource` follow in PR2/PR3.

### Patch Changes

- Updated dependencies [1805d0c]
- Updated dependencies [fcc57f9]
- Updated dependencies [a0b96f9]
  - @rudderjs/contracts@1.2.0

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

## 0.3.1

### Patch Changes

- Updated dependencies [be10c83]
  - @rudderjs/contracts@0.2.0

## 0.3.0

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

## 0.2.1

### Patch Changes

- dc37411: Ship `boost/guidelines.md` in the published npm tarball. Adds `"boost"` to the `files` field so downstream `boost:install` in consumer projects finds the per-package AI coding guidelines.

## 0.2.0

### Minor Changes

- 6fb47b4: Add `Router.has(name): boolean` — convenience alias for `getNamedRoute(name) !== undefined`. Matches Laravel's `Route::has('login')` idiom for rendering nav links conditionally on whether the route is registered.

## 0.1.0

### Minor Changes

- 9fa37c7: Add `Router.has(name): boolean` — convenience alias for `getNamedRoute(name) !== undefined`. Matches Laravel's `Route::has('login')` idiom for rendering nav links conditionally on whether the route is registered.

## 0.0.4

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

## 0.0.3

### Patch Changes

- Updated dependencies
  - @rudderjs/contracts@0.0.2
