# @rudderjs/server-hono

## 1.3.2

### Patch Changes

- c566cc8: Bump `hono` to `^4.12.4` and `@hono/node-server` to `^1.19.10` to clear security advisories (GHSA-hm8q-7f3q-5f36 and the `@hono/node-server` serveStatic advisory).

## 1.3.1

### Patch Changes

- ff64900: Fix the dev error page showing the wrong source line for thrown route handlers. In dev, route handlers run through Vite's SSR module runner as `eval`'d code, so V8 reports line numbers in transformed-code coordinates (a throw at source line 235 could surface as ~140) — and the Ignition page's text heuristic couldn't recover when the wrong line happened to land on unrelated real code, highlighting a completely different route.

  `@rudderjs/vite` now registers a dev-only `globalThis.__rudderjs_fix_stacktrace__` hook (Vite's `ssrFixStacktrace`), and `@rudderjs/server-hono` applies it to the error at the top of `onError` — before the app's error handler, the Ignition page, and logging all read the stack. The reported location, highlighted source line, stack frames, and any JSON debug trace now point at the true throw site. The existing line heuristic remains as a fallback for cases with no sourcemap remap (e.g. `tsx`-run CLI errors). No effect in production (the hook is only registered under `vite dev`).

## 1.3.0

### Minor Changes

- b58db48: feat(server-hono): mount Vike config-declared middlewares as direct routes

  `createFetchHandler` now passes Vike's config middlewares (https://vike.dev/middleware)
  to `vike(app, …)`, so they mount as their own routes ahead of the SSR catch-all
  instead of only being dispatched from inside the catch-all's `renderPageServer`.

  This is load-bearing for React Server Components: `vike-react-rsc` declares a
  `/_rsc` middleware that itself calls `renderPageServer`. Reached only via the
  catch-all, that became a re-entrant `renderPageServer` (catch-all renders, then
  dispatches `/_rsc`, which renders again) — which tripped Vike's dev request
  logger and 500'd `"use server"` actions. A direct route renders `/_rsc` once.

  No-op for renderers without config middlewares (e.g. `vike-react`): `vike(app, [])`
  is identical to `vike(app)`. Resolution is best-effort — if Vike's global context
  isn't ready at setup time, the catch-all (which still dispatches config
  middlewares internally) is used as before.

## 1.2.1

### Patch Changes

- 3e60f95: fix(server-hono): malformed request body → 400 (was a silent `{}`)

  A `POST` / `PUT` / `PATCH` with `Content-Type: application/json` (or `application/x-www-form-urlencoded`) and a truncated or otherwise unparseable body used to silently become `req.body = {}`. Handlers and validators then saw a request that "looked fine" and emitted cryptic "field required" errors — masking a malformed-request as a missing-field problem.

  The body-parse block in `server-hono` now throws a `MalformedBodyError` on parse failure. The central exception pipeline in `@rudderjs/core` recognizes its `httpStatus = 400` and renders a clean 400 response with the parse-error context.

  **Behavior change**

  | Scenario                                             | Before               | After                                                                                           |
  | ---------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
  | `application/json` + parseable body                  | parsed object        | parsed object                                                                                   |
  | `application/json` + truncated / invalid body        | `req.body = {}`, 200 | `400 — Malformed request body (Content-Type: application/json)`                                 |
  | `application/json` + empty body                      | `req.body = {}`, 200 | `req.body` stays `null`, request proceeds; validators emit their normal "field required" errors |
  | `application/x-www-form-urlencoded` + parseable body | parsed object        | parsed object                                                                                   |
  | `application/x-www-form-urlencoded` + empty body     | `req.body = {}`, 200 | `req.body` stays `null`                                                                         |

  The empty-body case used to look like an empty object; it now leaves `req.body` at the normalizer default so validators handle "no body" the same way they handle "GET with no body" — emitting standard missing-field errors instead of cryptic JSON parse messages.

  **API**

  `@rudderjs/contracts` now exports `MalformedBodyError extends Error`:

  ```ts
  import { MalformedBodyError } from "@rudderjs/contracts";

  err.httpStatus; // 400 (duck-typed; recognized by core's exception pipeline)
  err.contentType; // 'application/json' | 'application/x-www-form-urlencoded'
  err.cause; // the underlying SyntaxError, when applicable
  ```

  Plan: `docs/plans/2026-05-21-framework-pipeline-hardening.md`, Phase 2.

- 8355027: fix(server-hono): SPA navigation to parameterised controller views no longer degrades to full reloads

  Pipeline-hardening Phase 1 from the 2026-05-21 code-quality sweep (`docs/plans/2026-05-21-framework-pipeline-hardening.md`).

  A controller route like `Route.get('/users/:id', ...)` that returns `view(...)` used to silently fall back to a full reload whenever a user clicked through to it from another view in the SPA. Vike's client router would emit a `/users/42/index.pageContext.json` request, and the outer fetch handler's gate for "is this a controller-view URL?" was an O(1) Set lookup that only tracked **static** paths — parameterised routes were excluded by design (the previous comment admitted: "only exact-match paths are tracked — parameterized routes (`/users/:id`) are not supported as controller views in v1"). The Set missed, the rewrite never fired, Vike's middleware saw an unrecognised pageContext URL, and the browser fell back to a full reload with no diagnostic.

  **What changes**

  `HonoAdapter` now maintains a second index alongside `controllerViewPaths`:

  ```ts
  readonly controllerViewPatterns: Array<{ regex: RegExp; path: string }> = []
  ```

  Routes whose path contains `:` are compiled to a regex once at `registerRoute()` time and appended. The new internal `_matchesControllerView(path)` walks the static Set first (O(1) hot path) and falls back to the regex array (O(n) over the dynamic-route count, which is tiny per app). The Vike SPA-nav rewrite branch now calls `_matchesControllerView` instead of `Set.has(...)`.

  Wildcard-only routes (`*` with no `:`) stay excluded from both indexes — they're catch-all fallbacks, not view returns, and the pre-fix Set lookup never matched them against dynamic URLs either. Preserving that opt-out shape.

  **Path compiler**

  The compiler handles every shape `RouteBuilder` produces:

  | Pattern                              | Regex (conceptually)                     | Matches                                                  |
  | ------------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
  | `/users/:id`                         | `^/users/[^/]+$`                         | `/users/42`, `/users/john-doe`                           |
  | `/users/:id?`                        | `^/users(?:/[^/]+)?$`                    | `/users`, `/users/42` (slash folded into optional group) |
  | `/users/:id{[0-9]+}`                 | `^/users/[0-9]+$`                        | `/users/42` only — letters rejected                      |
  | `/users/:id{[0-9a-fA-F]{8}-...{12}}` | passes the custom regex through verbatim | full UUID pattern                                        |
  | `/posts/:slug/comments/:cid`         | nested params, each one segment          | `/posts/hello/comments/42`                               |
  | `/posts/v1.0`                        | metachars escaped                        | `/posts/v1.0` only — `.` is literal, not any-char        |

  `RouteBuilder.where()` ships its own balanced-brace consumer for the `:param{regex}` syntax; this file ships a private local copy (`consumeBraceBlockLocal`) under the same contract so the two paths produce equivalent regex segments without a circular import on `@rudderjs/router`.

  **API**

  `compileControllerViewRegex(path: string): RegExp` is exported for the unit tests; not advertised as a public surface (`HonoAdapter` fields aren't either). No breaking changes — the existing `controllerViewPaths` Set remains as the static fast path.

  **Tests**

  16 new specs in `packages/server-hono/src/index.test.ts` across two describe blocks:

  - `compileControllerViewRegex()` — 7 specs covering static paths, single `:param`, multiple/nested params, optional `:param?` after a slash, `:param{custom-regex}` (UUID + number constraints), regex-metachar escaping, root path.
  - `HonoAdapter — controllerViewPatterns` — 9 specs covering Set vs Patterns index correctness, wildcard-only opt-out, non-GET filtering, `_matchesControllerView` lookup, plus three end-to-end fetch-handler regressions: parameterised SPA-nav rewrites land in the controller, static SPA-nav still works, and an unregistered `.pageContext.json` path is **not** rewritten into the controller.

  76 → 92 specs in the server-hono test suite. Full-repo typecheck across 93 packages clean. Downstream packages tested clean (`router`, `core`, `auth`, `passport`, `mcp`, `middleware`).

- Updated dependencies [6652117]
- Updated dependencies [3e60f95]
  - @rudderjs/contracts@1.8.0

## 1.2.0

### Minor Changes

- 22d4f6c: feat: editor-launch on dev error-page stack frames

  Stack frames in the Ignition-style dev error page are now clickable — clicking any `file:line` jumps your editor to that location via the platform's URL scheme. Picked by the `APP_EDITOR` env var (default `vscode`):

  | `APP_EDITOR`                     | URL scheme                                          |
  | -------------------------------- | --------------------------------------------------- |
  | `vscode` (default)               | `vscode://file/<path>:<line>`                       |
  | `cursor`                         | `cursor://file/<path>:<line>`                       |
  | `webstorm` / `phpstorm` / `idea` | `<product>://open?file=<path>&line=<line>`          |
  | `sublime`                        | `subl://open?url=file://<path>&line=<line>`         |
  | `atom`                           | `atom://core/open/file?filename=<path>&line=<line>` |
  | `none`                           | Plain text (no anchor wrapping)                     |

  Unknown values fall back to `vscode` with a single dev-time warning. Windows paths are forward-slashed before being embedded in the URL.

  Phase 2 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Phase 3 (typed `route()` URL generator) and Phase 4 (`make:factory` + `make:seeder`) still pending.

## 1.1.4

### Patch Changes

- d9b673c: Clone the raw Web `Request` before consuming its body for JSON / form-urlencoded pre-parsing. Hono's `c.req.json()` / `c.req.text()` go straight through to `raw.text()` and consume the underlying `ReadableStream`, so handlers that need to read `c.req.raw.body` themselves get a locked / empty stream. The canonical case is `@rudderjs/mcp`'s `WebStandardStreamableHTTPServerTransport`, which parses the JSON-RPC payload directly off the raw stream — every POST to a mounted MCP endpoint hung waiting for a body that server-hono had already drained.

  With `c.req.raw.clone().json()`, the original stream survives for the handler while the clone gets consumed for `req.body`. No behavior change for handlers that only read `req.body`; existing form-urlencoded OAuth, JSON API, and multipart paths are unaffected.

## 1.1.3

### Patch Changes

- 4e4792a: Silence Vite's "dynamic import cannot be analyzed" warning on the `@rudderjs/view` prewarm path by annotating it with `/* @vite-ignore */`. The string-variable indirection in `import(viewModuleSpecifier)` is intentional — `@rudderjs/view` is an optional peer and the indirection avoids a hard TS build-time resolution. The warning was cosmetic, no behavior change.

## 1.1.2

### Patch Changes

- beea0f9: First-render perf: prewarm `vike/server` during application bootstrap so its ~100 ms module-load cost no longer stalls the first user-visible request. `@rudderjs/view` now exposes `prewarmVikeServer()` (memoized lazy loader); `@rudderjs/server-hono` fires it as a module-load side-effect of its own index module — t≈0 in the cold-boot timeline — so by request-time the import is fully cached. On a fresh-scaffold minimal app, first-render drops from ~182 ms to ~96 ms (−47%); RudderJS now beats Next.js on first-render and lands within 20 ms of Nuxt. Trade-off: cold boot bumps ~86 ms (the load happens during boot now). Net spawn-to-first-content is the same; in production this is a clear win because cold-boot hides behind the load-balancer's health check while users always see the request time. Also adds env-gated `[perf]` request-lifecycle traces in both packages (enabled via `RUDDER_PERF_TRACE=1`; zero overhead when unset).

## 1.1.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/contracts@1.6.1

## 1.1.0

### Minor Changes

- 758a89f: feat(server-hono): add Copy-as-Markdown button to the dev error page

  Adds a one-click button on the Ignition-style dev error page that copies the
  full error context as Markdown — heading, location, request, source context
  (with `>` marker on the error line), stack frames, and headers — formatted
  for pasting directly into an AI chat to debug. Vendor frames are wrapped in
  a collapsed `<details>` block so the primary signal stays visible.

  The Markdown is pre-rendered server-side and embedded as a JSON-stringified
  JS literal in an inline `<script>` block. `<`, `>`, `&`, U+2028, and U+2029
  are unicode-escaped (`<`, etc.) so an attacker-controlled error message
  or URL can't break out of the script tag — the existing XSS regression
  tests for the visible HTML now also cover this path. Clipboard API is used
  directly (secure-context only — dev page already requires localhost/https).

  Exports `buildErrorMarkdown(error, req, parts)` for callers that want the
  same shape outside the rendered page (e.g. logging the markdown directly).

### Patch Changes

- 3190a8e: ui(server-hono): move Copy-as-Markdown button next to the H1 title

  Tweak of the button position landed in #441. Previously the button lived on its own row above the badges, which felt visually disconnected from the error itself. Now it sits inline with the H1 title via a flex `title-row` container — same convention as Laravel Ignition's "Share" / "Copy as text" controls.

  No behavior change. The button still copies the same Markdown payload; tests unchanged.

- 68ac948: fix(server-hono): widen error-page source-line scan + skip section when no throw found

  The dev error page's "Exception Source" section sometimes highlighted an unrelated line (often a comment block) when running under Vite SSR. Root cause: Vite's Module Runner evaluates SSR modules via `new Function()`, which sidesteps Node's `--enable-source-maps`, and `ssr.sourcemap: 'inline'` is silently ignored. The result is stack-trace line numbers that are off by 40–90+ lines from the actual throw site.

  `resolveErrorLine()` already compensated by scanning forward for a `throw` keyword, but the window was 20 lines (too narrow for typical Vite offsets) and the fallback was "first non-empty line" — which lands on a comment when the actual throw is further out.

  Fix:

  - Window expanded to 150 lines.
  - Trigger pattern broadened to match `throw `, `throw new`, and `abort(` — with a word-boundary regex so mid-line `throw new` inside an `if {...}` block matches too.
  - Comment lines (`//`, `*`, `/*`) are skipped during the scan rather than terminating it.
  - When no trigger is found in the window, the function now returns `null` and the renderer drops the source-context section entirely — better than misleading with an unrelated line.

  `resolveErrorLine` is now exported with an `@internal` tag so the regression coverage can pin specific offset/comment/abort scenarios.

## 1.0.6

### Patch Changes

- 0da46c7: Fix `req.ip` ignoring `trustProxy` config (always read XFF/XRI regardless of setting), fix body parsing on `ALL`-method routes (`route.method` was registration-time value, not actual HTTP method), fix hardcoded version `'0.0.2'` in dev error page, and correct two inaccurate boost/guidelines.md claims (socket address fallback, lazy body parsing).
- Updated dependencies [f867181]
  - @rudderjs/contracts@1.4.0

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
