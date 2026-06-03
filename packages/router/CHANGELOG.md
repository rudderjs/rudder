# @rudderjs/router

## 1.8.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

### Patch Changes

- Updated dependencies [e199f5e]
- Updated dependencies [fc97c10]
- Updated dependencies [7e6dc85]
- Updated dependencies [ad17e79]
- Updated dependencies [0b085a6]
- Updated dependencies [26b7acf]
- Updated dependencies [b08aa1d]
- Updated dependencies [c66e195]
- Updated dependencies [473dfd9]
- Updated dependencies [a93455e]
  - @rudderjs/contracts@1.10.0

## 1.7.1

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

## 1.7.0

### Minor Changes

- 78e7f56: Introspection commands: `event:list`, `config:show`, `route:list --verbose`

  Three small commands that close debugging loops you'd otherwise solve with
  grep + restart. Plan: `docs/plans/2026-05-23-introspection-commands.md`.

  **`pnpm rudder event:list`** — registered events with each listener's class
  name. Wildcard (`*`) listeners surface as their own row; anonymous
  inline handlers render as `<anonymous>`. Flags: `--filter <substring>`,
  `--json`. Backed by a new `EventDispatcher.inspect()` method (additive
  alongside the existing `list()` count-only method).

  **`pnpm rudder config:show [section[.key]]`** — resolved configuration tree
  with sensitive-value redaction. Keys whose final token is one of
  `key, secret, password, token, dsn, webhook, signing, salt, pepper,
credentials` (camelCase / snake_case / dotted all handled) print as
  `***`. `--raw` opts out with a stderr warning. `--json` round-trips
  through the redaction pass; pass `--raw --json` for unredacted output.
  No-arg form prints a section summary (section → key count).

  **`pnpm rudder route:list --verbose`** — extends the existing command with
  the resolved `[global → group → route]` middleware stack matching the
  request-time composition order. Backed by a new
  `RudderJS.middlewareSnapshot()` method that combines the user's
  `withMiddleware()` block with provider-registered group middleware
  (`appendToGroup()` calls during `boot()`). `--verbose --json` emits a
  `resolved: { global, group, route }` triple per api route. Default
  output unchanged. Also accepts `-v` as a short alias.

  All three commands are loaded via the cli's `tryImport` mechanism — no
  changes for users who don't invoke them. `Router.list()` output now
  includes the route's `group` tag (additive `group?: 'web' | 'api'`),
  already declared in `@rudderjs/contracts` and previously inert.

## 1.6.0

### Minor Changes

- 3aeba89: feat(router): freeze RouteBuilder after `mount()` + new `Route.lateRegister(fn)` for runtime registration

  Pipeline-hardening Phase 4 from the 2026-05-21 code-review sweep (`docs/plans/2026-05-21-framework-pipeline-hardening.md`).

  **The silent-failure class being closed**

  Once `router.mount(adapter)` has run, the server adapter has captured every registered route by reference. Until now, calling a RouteBuilder mutator (`.query`/`.body`/`.name`/`.where*`/`.domain`/`.missing`) _after_ mount silently no-op'd for some routes and partially propagated for others — `def.middleware.unshift(validator)` reaches the adapter for routes without route-binding middleware (the adapter holds the array reference), but routes WITH a binding land on the adapter through a fresh `[bindingMw, ...route.middleware]` array that the unshift can never reach. Cross-adapter divergence with no diagnostic.

  Same shape for post-mount registration (`Route.get`, `.post`, `.add`, `.registerController`, `.resource`, `.bind`, `.use`): the new routes / middleware get pushed to internal arrays but the adapter has already finalised its routing table, so they're invisible to incoming requests.

  **What changes**

  `Router.mount()` now flips a one-way `_mounted` flag and captures the adapter. After that:

  - Every RouteBuilder mutator throws on the captured definition: `.query() called on already-mounted route GET /users — define this before router.mount(), or wrap runtime registration in Route.lateRegister(() => Route.get(...).query(...))`. The message names the verb, path, and the escape hatch in one line.
  - Every Router registration entry point (`.get`/`.post`/`.put`/`.patch`/`.delete`/`.all`/`.add`/`.registerController`/`.resource`/`.apiResource`/`.singleton`/`.fallback`/`.bind`/`.use`) throws with the same shape unless wrapped in `lateRegister`.

  **The escape hatch**

  ```ts
  import { Route } from "@rudderjs/router";

  // Inside a dynamic provider's boot(), a feature-flag callback, etc.
  Route.lateRegister(() => {
    Route.get("/admin/foo", adminController.foo).query(adminQuerySchema);
  });
  ```

  `lateRegister(fn)`:

  - Throws if called before `mount()` — there's no adapter to register against.
  - Suspends the freeze for the duration of `fn()` (counter-based, so nested calls work too).
  - Mounts every route appended during the callback onto the captured adapter via the same code path `mount()` uses (route-binding middleware still gets composed correctly).
  - Seals those new routes against further mutation after `fn` returns — the leaked builder from inside the callback will throw on any subsequent `.query()` / `.name()` / etc. just like a module-load route would.
  - Decrements the counter via `try/finally`, so a throw inside `fn` leaves the router in a consistent post-mount state.

  **Other improvements**

  - `mount()` factored into a public driver + a private `_mountRoute(adapter, route)` so `lateRegister` and the initial mount take the same path — single source of truth for route-binding composition.
  - `reset()` now clears the mount state (`_mounted` / `_adapter` / `_mountedDefs` / `_inLateRegister`) so dev-mode HMR (`router.reset()` → loaders → `mount()`) and test fixtures rebuild cleanly between cases.

  **Migration**

  If you currently rely on post-mount mutation or registration, wrap the work in `Route.lateRegister(...)`. Decorator-based controllers (`@Controller` / `@Get`), `routes/web.ts` / `routes/api.ts` files, provider `boot()` methods that run before `_createHandler()`, and HMR-driven re-bootstrap (`reset()` + reload) are all unaffected — registration happens at module load or pre-mount in those paths.

  **Tests**

  23 new specs across three describe blocks in `packages/router/src/index.test.ts`:

  - RouteBuilder mutators throw post-mount: `.query`, `.body`, `.name`, `.where` (covers whereNumber/Alpha/Uuid/Ulid/In transitively), `.domain`, `.missing`, plus an assertion that the error message points at `Route.lateRegister(() => Route.<verb>(...).query(...))`.
  - Router registration entry points throw post-mount: each verb (`get`/`post`/`put`/`patch`/`delete`/`all`), `add`, `use`, `bind`, `registerController`, `resource`, `fallback`.
  - `Router.reset()` thaws the mount state; pre-mount `lateRegister()` throws; the captured adapter sees the new route; builders inside `lateRegister` can chain; sealed-after-return; route-binding middleware still attaches to late routes; nested `lateRegister` works; throw inside `fn` decrements the counter via `try/finally`.

  156 → 179 specs in the router test suite. Downstream test suites (`@rudderjs/core`, `@rudderjs/auth`, `@rudderjs/passport`, `@rudderjs/mcp`, `@rudderjs/server-hono`, `@rudderjs/middleware`) pass unchanged.

### Patch Changes

- Updated dependencies [6652117]
- Updated dependencies [3e60f95]
  - @rudderjs/contracts@1.8.0

## 1.5.0

### Minor Changes

- 34b008f: feat(router): typed `route(name, params)` URL generator

  Caps the typed-routes story from #482 + #564. The URL generator's `params` arg now type-checks against the path's `:params` once you declare your named routes in the `RouteRegistry` interface:

  ```ts
  // env.d.ts
  declare module "@rudderjs/router" {
    interface RouteRegistry {
      "users.show": "/users/:id";
      "comments.show": "/posts/:slug/comments/:cid";
    }
  }
  ```

  ```ts
  route("users.show", { id: 1 }); // ✓
  route("users.show", { id: 1, page: 2 }); // ✓ extras → query string
  route("comments.show", { slug: "hi", cid: 7 }); // ✓
  route("users.show", {}); // ✗ TS: missing 'id'
  route("users.show", { id: true }); // ✗ TS: id must be string|number
  ```

  **Soft name strictness, hard params strictness.** `name` stays `string` so framework internals + runtime-registered routes keep working. When the name matches a registered key, `params` narrows to the typed shape. Names not in the registry get the loose `Record<string, string | number>` — today's behavior, fully backward compatible. Apps wanting strict name-checks wrap `route()` in a `<N extends keyof RouteRegistry>` helper (documented).

  New exports from `@rudderjs/router`:

  - `RouteRegistry` — empty interface, augment via declaration merging
  - `ParamsForName<N>` — derived params type for a registered name

  Phase 3 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Phase 4 (`make:factory` + `make:seeder` scaffolders) still pending.

## 1.4.0

### Minor Changes

- ba49b95: feat: typed request bodies — `.body(zodSchema)` and `{ body: zodSchema }` opts form

  Completes the typed-routes story. Path params, query, AND body are now end-to-end typed from a single Zod schema declaration.

  ```ts
  Route.post(
    "/posts/:slug",
    { body: z.object({ title: z.string(), views: z.coerce.number() }) },
    (req) => {
      const slug: string = req.params.slug; // from the path
      const title: string = req.body.title; // from the body schema
      const views: number = req.body.views; // coerced
      return { slug, title, views };
    }
  );
  ```

  The opts form now supports three new shapes per verb:

  - `{ body: schema }` — types `req.body`, leaves `req.query` as `Record<string, string>`
  - `{ query: schema, body: schema }` — both typed
  - `.body(schema)` chainable — runtime validation only (closure already typed)

  Validators install in order `query → body → user middleware`. Parsed result replaces `req.body` in place so `z.coerce.*`, `z.transform()`, and `.default()` are visible at the handler. Validation failure surfaces as the same `ValidationError` → `422` path as `{ query }` and `FormRequest`, with errors keyed by Zod path.

  `TypedRequest<P, Q, B>` and `TypedHandler<P, Q, B>` gain a third generic `B = unknown` (defaulted for backward compatibility — bare-form routes keep their current `req.body: unknown` typing).

## 1.3.2

### Patch Changes

- 026af82: Hoist the `runWithGroup` / `currentGroup` "current group" slot to `globalThis`
  so it survives bundle duplication. Vite-built SSR apps can load
  `@rudderjs/router` twice: once via `@rudderjs/core`'s
  `await import('@rudderjs/router')` in `_taggedLoader` (resolves to the linked
  workspace dist) and once via the SSR chunk that the user's `routes/web.ts`
  statically imports (resolves to a vite-bundled copy). With a plain
  module-level `let _currentGroup`, `runWithGroup('web', loader)` wrote to one
  copy's slot and `currentGroup()` (called by `_rb` / `registerController` from
  the other copy) read `undefined` — every route silently got `group:
undefined`, and all web-group middleware (Session / Auth / RateLimit / Csrf)
  no-op'd for every request. Caught by the Phase 4 scaffolder auth-flow E2E:
  `POST /auth/sign-up/email` reached its handler without `AuthMiddleware` ever
  running, so `Auth.login()` → `currentAuth()` threw "No auth context" on a
  request that LOOKED routed correctly. Same pattern as #498/#500–#507/#516.

## 1.3.1

### Patch Changes

- 21bf38e: Route the module-singleton `router` (and its `Route` alias) through `globalThis` so the same `Router` instance is shared across duplicate module bundles. A bundled app's `entry.mjs` ships its own copy of `@rudderjs/router`; when a framework provider calls `resolveOptionalPeer('@rudderjs/router')` from inside that bundle, a second copy is loaded from `node_modules`, each with its own module-level `new Router()`. `McpProvider.boot()` was registering `/mcp/echo` on the node_modules-copy router while `server-hono` dispatched against the bundled-copy router, so every MCP web route silently 404'd in production builds.

  Same pattern as `groupMiddlewareStore` in `@rudderjs/core` and the static-state registries audited in #498 / #500–#506. No public API change.

## 1.3.0

### Minor Changes

- 7d7a4ab: Typed routes: `Route.get('/users/:id', handler)` now types the handler's `req.params` from the `:param` segments in the literal path — pure TypeScript template-literal types, no codegen, no scanner. Reading `req.params.userId` on a route with `:id` is now a compile error. Optional segments (`:name?`) produce optional keys; regex constraints (`:id{[0-9]+}`) are stripped from the captured name; paths with no params type as `{}`. Plus a new opts form on every shorthand verb — `Route.get('/users/:id', { query: zodSchema }, handler)` — installs a Zod validator middleware AND types the handler's `req.query` as `z.infer<typeof schema>`. The parsed result replaces `req.query` in place at request time so `z.coerce.number()` works end-to-end. The `.query(schema)` chain method is available too for runtime-only validation when type narrowing isn't needed. `ValidationError` moved from `@rudderjs/core` to `@rudderjs/contracts` so `@rudderjs/router` can throw it without a circular dependency; `@rudderjs/core` re-exports the class so existing imports keep working. Existing routes compile unchanged — all generics default to today's shapes.

### Patch Changes

- Updated dependencies [7d7a4ab]
  - @rudderjs/contracts@1.7.0

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
