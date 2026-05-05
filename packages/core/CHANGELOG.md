# @rudderjs/core

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
