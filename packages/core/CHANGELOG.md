# @rudderjs/core

## 1.4.1

### Patch Changes

- 4c4e669: Fix dev HMR re-boot wedging when `APP_ENV` isn't `development`. The re-boot reset (`router.reset()` + `rudder.reset()` + group-middleware reset) was gated on `isDevelopment()`, which reads `APP_ENV` (default `production`). A `vike dev` server without `APP_ENV=development` (e.g. a fresh checkout with no `.env`, or `APP_ENV=production`) still re-boots on every file edit, but the reset was skipped — leaving the router mounted from the first boot, so a provider that registers routes in `boot()` (e.g. `@rudderjs/horizon`) threw `get() called after router.mount()` on the second edit and wedged the dev server. The reset is now gated on "is this a re-boot" (a previous boot exists) rather than the environment, so shared state is reset before every re-boot regardless of `APP_ENV`. No effect in production (single boot).

## 1.4.0

### Minor Changes

- 6f3cb2a: Add a client-safe `@rudderjs/core/client` subpath. The main `@rudderjs/core` entry re-exports `@rudderjs/console` (whose `@clack/*` dependency statically imports `node:process`/`node:fs`) plus a few Node-only modules, so it crashes when bundled into the browser (`process is not defined`). Code reachable from both server and client — shared service classes, form requests, config/env access, DI — should import `app`, `Env`, `env`, `config`, `Container`, validation, exceptions, etc. from `@rudderjs/core/client`, which omits the console re-export and every Node-only module and is verified to evaluate in a browser by a new CI client-bundle smoke gate. The main `.` entry is unchanged (no breaking change).

### Patch Changes

- Updated dependencies [3bf71b9]
  - @rudderjs/support@1.4.0

## 1.3.3

### Patch Changes

- 724cb54: Dev HMR: drain in-flight renders before a re-boot mutates shared state (quiesce barrier).

  #652 single-flighted re-boots and gated each request's _start_ on the boot promise, but a request that already passed the gate could be **mid-render** when the next re-boot stomped process-shared state in place (`router.reset()`, provider `boot()`s repopulating registries). That render observed a half-booted graph — e.g. a resource list whose schema was missing its table element, so the data query was never issued and the page rendered its empty-state with no error (the "wedged empty table after a dev edit" residual).

  `_bootstrapProviders()` now awaits any in-flight render to finish (bounded by a 5s timeout so a hung render can't wedge the reload) before it resets/re-registers; `handleRequest()` marks a render as in-flight only while the handler runs. New requests already wait for the re-boot via the existing gate. Dev-only and a no-op in production (single boot, nothing in flight, no resets).

## 1.3.2

### Patch Changes

- 8ecf5f7: Dev HMR: reuse one PrismaClient across re-bootstraps instead of opening (and leaking) a fresh DB connection on every edit.

  Each dev re-boot re-ran `DatabaseProvider.boot()` → `PrismaAdapter.make()`, which built a brand-new `PrismaClient` and opened a new driver connection (a new better-sqlite3 handle, a new pg/mariadb pool, …) every time — and never disconnected the superseded one. Under Prisma 7's driver-adapter model the app owns the client lifecycle and Prisma performs no HMR de-duplication of its own, so abandoned connections piled up across edits.

  - **`@rudderjs/orm-prisma`** — `PrismaAdapter.make()` now caches the live `PrismaClient` on `globalThis`, keyed by the resolved connection signature (driver + url). The same signature reuses the live client (no new connection opened); a changed connection (a `config/database.ts` edit) builds a fresh client and `$disconnect()`s the superseded one so its handle is released. No-op in production (single boot → one client, built once). Apps passing their own `config.client` opt out entirely.
  - **`@rudderjs/core`** — under `RUDDER_HMR_TRACE=1`, `Application.create()` and the app-builder now log a per-re-boot construct counter, so the "one fresh instance per re-boot" invariant is observable when diagnosing HMR. Diagnostic only; no behavior change otherwise.

## 1.3.1

### Patch Changes

- ae30176: Dev HMR: fix half-booted responses served during the re-bootstrap window.

  Editing an `app/`, `routes/`, or `bootstrap/` file in dev triggers a full re-bootstrap. Requests that landed **while that async re-boot was still in flight** could be served against a half-booted app and render empty data — e.g. resource tables showing their empty-state ("No records yet") despite rows in the DB, while pure-config changes reflected fine. An editor's atomic-write / format-on-save made it reliable: the second write fired a _second_ concurrent re-boot that interleaved its `router.reset()` / provider boot / `ModelRegistry.set()` with the first.

  Three independent fixes close the window:

  - **`@rudderjs/vite` — debounce the watcher.** A burst of `change` events (atomic-write / format-on-save double-fire) is now coalesced into a single re-boot, removing the reliable trigger. One save = one reload.
  - **`@rudderjs/core` — single-flight the re-bootstrap.** Concurrent re-boots are chained via a promise on `globalThis.__rudderjs_boot__` and run strictly serially, so one boot never observes another mid-reset.
  - **`@rudderjs/core` — gate request handling on boot completion.** `handleRequest()` blocks on the latest in-flight re-boot before invoking the route handler, so in-window requests wait for a fully-booted graph instead of observing half-booted shared state. In production (a single boot) and in the steady state this is a no-op.

## 1.3.0

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

### Patch Changes

- Updated dependencies [78e7f56]
  - @rudderjs/router@1.7.0

## 1.2.0

### Minor Changes

- 1553c9a: feat(core): async-boot guard + cycle detection on deferred providers

  Pipeline-hardening Phase 3 from the 2026-05-21 code-review sweep (`docs/plans/2026-05-21-framework-pipeline-hardening.md`).

  Three silent-failure modes are closed in `@rudderjs/core`'s deferred-provider lifecycle (the `provides()` opt-in for lazy-init):

  **1. Async `boot()` + `provides()` now throws at registration**

  Deferred-provider boot runs inside the container's missing handler, which is itself a synchronous step inside `container.make()`. The old path detected an async boot, logged `[RudderJS] Deferred provider "X" returned a Promise from boot() ... will be dropped`, and silently moved on — the consumer of the deferred token got a half-booted service with no obvious cause. Now `_registerAll()` checks `_isAsyncFunction(provider.boot)` when classifying a deferred provider and throws with a clear error:

  ```
  [RudderJS] Deferred provider "MyProvider" has an async boot() — provides() requires
  synchronous boot because lazy resolution can't await across container.make(). Move
  async work into the bound services themselves (lazy-init pattern), or drop provides()
  if eager boot is acceptable.
  ```

  The async-function detector checks `fn.constructor.name === 'AsyncFunction'` first and falls back to `Object.prototype.toString.call(fn) === '[object AsyncFunction]'` to catch bound arrow forms.

  **2. Circular deferred resolution throws a real error instead of "Cannot resolve"**

  The previous "delete all my tokens at the top of the missing handler" mitigation only covered same-provider re-entry. Cross-provider chains where every token was still mid-registration bottomed out at the generic `Cannot resolve <token>` error from `container.make()`, masking the real cause. The missing-handler closure now tracks tokens currently in flight via a private `Set<string>` and throws on re-entry:

  ```
  [RudderJS] Circular deferred resolution: "a" requires itself during register/boot.
  Break the cycle by lazy-resolving via app().make("a") inside a method body instead
  of at register/boot time.
  ```

  `try/finally` cleanup so a throw during one resolve doesn't poison the next — verified by a regression test.

  **3. Deferred providers no longer eager-boot during `_bootAll()`**

  A latent bug surfaced while writing the happy-path test: `_bootAll()` iterated `this.providers` and awaited every provider's `boot()`, including the ones marked as deferred via `provides()`. The lazy missing handler then created a _fresh_ provider instance and ran its boot() _again_ — duplicate work, plus the eager `await` would silently land an async boot before the new validator above could catch it on a future re-bootstrap. Fixed by adding the original instance to `_bootedProviders` at the deferred branch in `_registerAll()`, so `_bootAll()` skips it. The "deferred" claim documented in `service-provider.ts` (`register()` and `boot()` are not called during bootstrap but lazily when one of the returned tokens is first resolved) now holds end-to-end.

  **Tests**

  9 new specs in `packages/core/src/index.test.ts` under a new `Application — deferred provider lifecycle (provides())` describe block:

  - Happy path: sync boot + provides() registers lazily on first make(); idempotent on second resolve
  - Async boot + provides() throws at registration
  - Error message names the lazy-init pattern as the migration path
  - Sync arrow-function boot is accepted (AsyncFunction detection edge case)
  - Non-deferred providers with async boot are unaffected (scope check)
  - Self-cycle (`provider.register() → make('self')`) throws "Circular deferred resolution"
  - Cross-provider cycle (`A.register → make(b)`, `B.register → make(a)`) throws cycle error
  - Legitimate cross-provider chain (`A.boot → make(b)` where B is independent) still works
  - Throw during one resolve doesn't poison the next — `try/finally` cleanup

  233 → 242 specs in the core test suite. Downstream test suites (`router`, `auth`, `passport`, `mcp`, `server-hono`, `middleware`, `ai` 839, `orm`, `queue`) pass unchanged. Full-repo typecheck across 93 packages clean.

  **Migration**

  No production providers in the framework or playground use `provides()` today — this is a hardening of a documented capability that nobody currently relies on. Apps that defined a deferred provider with an async `boot()` will now get a clear error at registration instead of a silent half-booted service; the fix is to move async work into the bound service (lazy-init) or drop `provides()` if eager boot is acceptable.

### Patch Changes

- Updated dependencies [6652117]
- Updated dependencies [3aeba89]
- Updated dependencies [3e60f95]
  - @rudderjs/contracts@1.8.0
  - @rudderjs/router@1.6.0

## 1.1.7

### Patch Changes

- 69ad453: Route 5 cross-bundle singletons through `globalThis` so duplicate bundles of these packages share state. Defensive sweep of the same "module-scoped state ≠ bundle-split-survival" pattern that produced #498 / #500–#506 (static-state registries) and #507 (router) and #514 (mcp metadata symbols).

  | Singleton       | Package              | Global key                        | Risk if unfixed                                                                                                                             |
  | --------------- | -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | `container`     | `@rudderjs/core`     | `__rudderjs_core_container__`     | Defensive — only `Application` imports today, but a direct cross-bundle import would split                                                  |
  | `dispatcher`    | `@rudderjs/core`     | `__rudderjs_core_dispatcher__`    | Multiple packages re-export `dispatch()` — events fired from one bundle don't reach listeners in another                                    |
  | `schedule`      | `@rudderjs/schedule` | `__rudderjs_schedule_singleton__` | User registers tasks in `routes/console.ts`; cron runner + telescope's ScheduleCollector read from a different bundle's Scheduler → no jobs |
  | `customDrivers` | `@rudderjs/log`      | `__rudderjs_log_custom_drivers__` | Public `extendLog('sentry', ...)` API — write to one bundle's Map, read from another → "Unknown driver" on every channel                    |
  | `_chainStates`  | `@rudderjs/queue`    | `__rudderjs_queue_chain_states__` | Chain.dispatch() stamps state on each job; worker reads via `getChainState(this)` — split = state silently lost                             |

  No public API change. Same shape as `groupMiddlewareStore` (long-standing globalThis precedent in `@rudderjs/core`).

  Out-of-scope: `queue/_locks` (documented process-local fallback — "use cache for production"), `server-hono/perf-boundaries` (single-module scope, no cross-bundle access).

## 1.1.6

### Patch Changes

- 7d7a4ab: Typed routes: `Route.get('/users/:id', handler)` now types the handler's `req.params` from the `:param` segments in the literal path — pure TypeScript template-literal types, no codegen, no scanner. Reading `req.params.userId` on a route with `:id` is now a compile error. Optional segments (`:name?`) produce optional keys; regex constraints (`:id{[0-9]+}`) are stripped from the captured name; paths with no params type as `{}`. Plus a new opts form on every shorthand verb — `Route.get('/users/:id', { query: zodSchema }, handler)` — installs a Zod validator middleware AND types the handler's `req.query` as `z.infer<typeof schema>`. The parsed result replaces `req.query` in place at request time so `z.coerce.number()` works end-to-end. The `.query(schema)` chain method is available too for runtime-only validation when type narrowing isn't needed. `ValidationError` moved from `@rudderjs/core` to `@rudderjs/contracts` so `@rudderjs/router` can throw it without a circular dependency; `@rudderjs/core` re-exports the class so existing imports keep working. Existing routes compile unchanged — all generics default to today's shapes.
- Updated dependencies [7d7a4ab]
  - @rudderjs/router@1.3.0
  - @rudderjs/contracts@1.7.0

## 1.1.5

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/console@1.0.2
  - @rudderjs/contracts@1.6.1
  - @rudderjs/router@1.2.1
  - @rudderjs/support@1.2.2

## 1.1.4

### Patch Changes

- 93b4582: fix(core): restore Ignition-style dev error page on unhandled exceptions

  Re-throw unhandled errors from `buildHandler()` when `app.debug` is true AND
  the client wants HTML, so the adapter's rich dev error page (server-hono's
  Ignition-style `renderErrorPage` with stack frames + source context) fires
  instead of the plain card-style fallback.

  The card page in `exceptions.ts::htmlPage()` was always meant to be a
  production-safe last resort. From 2026-04-06 (when the central error
  pipeline landed) until now, every unhandled 500 went through it — even in
  dev with `APP_DEBUG=true` — because step 6 of the pipeline returned a
  `Response` instead of bubbling. The adapter's dev page was effectively
  dead code.

  Prod (`debug === false`) and JSON-accepting clients (regardless of debug)
  keep their current behavior: prod uses the safe card page (no source
  leak), JSON clients get a structured 500. Recognized exception types
  (`HttpException`, `ValidationError`, custom renderers via
  `.withExceptions((e) => e.render(...))`) bypass step 6 entirely and are
  unaffected.

  `wantsJson` is now exported from `@rudderjs/core/exceptions` with an
  `@internal` tag so the pipeline can route on it. Not part of the public
  API surface — adapter authors and userland should not depend on it.

## 1.1.3

### Patch Changes

- 0f69018: Fix XSS in HTML error pages, double provider registration before bootstrap, fictional `events` export in docs, and FormRequest pipeline order docs. Add `EventFake` documentation. Warn on async deferred provider boot.
- Updated dependencies [95e9f4a]
- Updated dependencies [f867181]
- Updated dependencies [b506997]
- Updated dependencies [95b588f]
  - @rudderjs/console@1.0.1
  - @rudderjs/support@1.2.0
  - @rudderjs/contracts@1.4.0
  - @rudderjs/router@1.2.0

## 1.1.2

### Patch Changes

- 4c8cd07: Fix fictional factory-function references in package READMEs — same drift class PR #233 fixed in `boost/guidelines.md`. Replaces non-existent `pkg(configs.pkg)` factory calls with the actual `*Provider` classes (e.g. `import { CacheProvider } from '@rudderjs/cache'` + `[CacheProvider]`), corrects auth's `authProvider(...)` → `AuthProvider` in setup + prose, fixes core's dynamic-registration example to use the real `CacheProvider` class, and updates ai's setup example to import `AiProvider` from the `/server` subpath. Documentation only; no code changes.

## 1.1.1

### Patch Changes

- 158f7ee: Three fixes to the `FormRequest` pipeline (`packages/core/src/validation.ts`).

  - **`prepareForValidation` now runs before `authorize()` — Laravel parity.** Previously the pipeline was `authorize → prepare → rules`, opposite of Laravel's `FormRequest::validateResolved` order. Subclasses that normalized input for the auth check (e.g., lowering an identifier, parsing a route key into a model) silently saw the unprepared input. Now: `prepare → authorize → rules → after → passed`.

    Soft behavior change — if you previously relied on `prepareForValidation` being skipped when `authorize()` returned false (e.g., to avoid a DB lookup in prepare for unauthorized users), guard the work inside `prepareForValidation` instead. Most subclasses won't notice.

  - **`prepareForValidation` is now awaited.** The signature widened from `Record | void` to `Record | void | Promise<Record | void>`; sync overrides keep working. Without the await, a returned Promise passed `typeof === 'object'` and was assigned directly to `input`, then the schema failed with a confusing "Expected object, received object" Zod error. Now async normalization works the same way it does for `passedValidation`.

  - **`messages()` override key for top-level errors is `'root'`, matching the rendered error key.** `zodIssuesToErrors` reports path-less issues under `'root'`, but the override map looked them up under `''`. A user reading `errors.root` from the response who wrote `messages() { return { root: 'Custom' } }` got no override; only the literal `''` key worked. Both sides now use `'root'`.

  Adds four tests covering each fix: prepare-before-authorize ordering, authorize reading prepare's normalized state, async `prepareForValidation`, and `messages.root` override on a top-level `refine()` issue.

- Updated dependencies [7125676]
  - @rudderjs/router@1.1.2

## 1.1.0

### Minor Changes

- 6c03c74: Add container `extend` / `rebinding` / `@Tag` decorator + `tagToken` (Laravel parity #7, PR2).

  - `container.extend<T>(token, fn)` — wrap the value resolved for `token`. Chains in registration order, applied eagerly to any cached singleton/instance so existing consumers see the wrap on the next `make()`. Singletons cache the wrapped form; transient bindings re-wrap per `make()`; scoped bindings re-wrap per scope.
  - `container.rebinding<T>(token, fn)` — register a listener that fires whenever an existing binding is replaced via `bind` / `singleton` / `scoped` / `instance`. Listeners receive the freshly-resolved value (not the stale singleton cache). Does not fire on the initial bind. Useful for test hot-swaps and `app->refresh()` parity.
  - `@Tag(name)` parameter decorator — inject the array of bindings tagged with `name` directly into a constructor parameter. Constructor-only (esbuild drops `design:paramtypes` on method decorators).
  - `tagToken(name)` — stable `Symbol.for`-backed sentinel for `when().needs(tagToken('group')).give(...)` contextual bindings.
  - `bind` / `singleton` / `scoped` now drop any cached singleton instance when overwriting an existing binding (previously the stale instance survived the rebind).
  - `reset()` clears extenders and rebinders.

  Pure additions; existing API unchanged.

- 3ccac5d: Add container tagging and conditional binding helpers (Laravel parity #7, PR1).

  - `container.tag(tokens, tags)` — group bindings under one or more tag names. Both args accept either single values or arrays. Additive; tagging the same token twice is a no-op. Tagging an unbound token is allowed.
  - `container.tagged<T>(tag)` — resolve every token under a tag via `make()`. Returns `[]` for unknown tags. Insertion order. Singletons stay singletons across calls.
  - `container.bindIf` / `singletonIf` / `scopedIf` — bind only if the token is currently unbound. Lets framework providers register defaults that app providers can override by binding first.
  - `reset()` clears tags.

  Pure additions; existing API unchanged. Decorator (`@Tag`) + `extend` + `rebinding` ship in the next PR.

- 5447fa9: Add `FormRequest` lifecycle hooks (Laravel parity #6).

  `FormRequest` now supports five optional protected methods that mirror Laravel's lifecycle:

  - `prepareForValidation(input)` — mutate merged input pre-parse (sync). Lowercase emails, trim strings, etc.
  - `messages()` — per-request error message overrides keyed by dot-path. Static string or `(issue) => string`.
  - `after()` — array of cross-field check closures with `addError(path, msg)`. Run serially after parse; all errors collected in one round-trip.
  - `passedValidation(data)` — final transform on parsed data (sync or async); return value replaces resolved data.
  - `failedValidation(errors)` — override the throw. Default throws `ValidationError`; return a Web `Response` to short-circuit (wrapped in a new `ValidationResponse` sentinel that the framework's exception handler unwraps).

  Existing `FormRequest` subclasses keep working unchanged — the hooks have empty default implementations.

  The `make:request` stub now includes commented-out hook signatures to aid discovery.

### Patch Changes

- Updated dependencies [1805d0c]
- Updated dependencies [fcc57f9]
- Updated dependencies [a0b96f9]
- Updated dependencies [ca63e78]
- Updated dependencies [fcca26b]
  - @rudderjs/contracts@1.2.0
  - @rudderjs/router@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [1d81533]
  - @rudderjs/console@1.0.0

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
  - @rudderjs/router@1.0.0
  - @rudderjs/support@1.0.0

## 0.1.4

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
  - @rudderjs/console@0.0.4

## 0.1.3

### Patch Changes

- 2caae8c: Make `@rudderjs/ai` runtime-agnostic via subpath exports. The main entry now works
  in any `fetch`-capable JS runtime — Node, browser, Electron (main and renderer),
  React Native — with zero `node:*` static imports (enforced by an isomorphism guard
  test). Node-only filesystem helpers (`documentFromPath`, `imageFromPath`,
  `transcribeFromPath`) move to `@rudderjs/ai/node`. The `AiProvider` `ServiceProvider`
  moves to `@rudderjs/ai/server` and `@rudderjs/core` is now an optional peer — only
  `/server` consumers pull it in.

  `@rudderjs/core` gains a new `rudderjs.providerSubpath` field on the provider
  manifest. When set, `defaultProviders()` imports the provider class from the given
  subpath (`@rudderjs/ai` declares `"./server"`) instead of the package's main entry.
  This is fully auto-discovered — no app changes needed.

  **Breaking changes (uncommon import paths only):**

  - `import { AiProvider } from '@rudderjs/ai'` → `from '@rudderjs/ai/server'` (most apps use `defaultProviders()` which finds it automatically)
  - `Image.fromPath()` / `Document.fromPath()` / `Transcription.fromPath()` removed — use `imageFromPath` / `documentFromPath` / `transcribeFromPath` from `@rudderjs/ai/node`
  - `AI.transcribe(path: string)` is now `AI.transcribe(bytes: Uint8Array)` — load paths via `transcribeFromPath` from `@rudderjs/ai/node`
  - `Transcription.fromBuffer(Buffer)` aliased to `Transcription.fromBytes(Uint8Array)` (Buffer extends Uint8Array, existing Node callers keep working)
  - `SpeechToTextOptions.audio` narrowed from `Buffer | string` to `Uint8Array`

## 0.1.2

### Patch Changes

- f0b3bae: Fix the dev-mode "providers loaded" boot log occasionally not printing. The cached list of last-loaded provider entries lived in a module-level `let`, which Vite SSR can isolate across module instances — `defaultProviders()` would write to one copy and `Application._bootstrapProviders()` would read an empty array from another, silently skipping the log. Moved the cache to `globalThis['__rudderjs_last_loaded_providers__']`, matching the pattern already used for the singleton app instance and other cross-module state.
- Updated dependencies [be10c83]
  - @rudderjs/contracts@0.2.0
  - @rudderjs/router@0.3.1

## 0.1.1

### Patch Changes

- e720923: Move the provider group-middleware store from module scope to `globalThis`.

  `appendToGroup()` and `resetGroupMiddleware()` in `@rudderjs/core` used to
  persist middleware in a module-level `const` — which silently broke any time
  the consumer app loaded two `@rudderjs/core` instances (e.g. pnpm-linked
  workspace package + installed npm copy of any framework package). Each core
  instance had its own private store: provider `boot()` wrote to store A, the
  server read store B, middleware silently vanished. The user-visible symptom
  was `No auth context. Use AuthMiddleware.` when linking a workspace auth
  package into a consumer app that had the rest of `@rudderjs/*` from npm.

  The store is now pinned on `globalThis.__rudderjs_group_middleware__` so
  every `@rudderjs/core` instance shares one object — same pattern the
  `ai/mcp/http/gate/live` observer registries already use. Zero API change.
  Added three tests covering the new invariant + existing reset semantics.

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
  - @rudderjs/router@0.3.0

## 0.0.12

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1

## 0.0.11

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0

## 0.0.10

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0

## 0.0.9

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
  - @rudderjs/router@0.0.4
  - @rudderjs/rudder@0.0.3
  - @rudderjs/support@0.0.4

## 0.0.6

### Patch Changes

- Update @rudderjs/rudder dependency to 0.0.2 which exports Rudder and CancelledError.

## 0.0.5

### Patch Changes

- Updated dependencies
  - @rudderjs/rudder@0.0.2

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/support@0.0.3
  - @rudderjs/contracts@0.0.2
  - @rudderjs/router@0.0.3
