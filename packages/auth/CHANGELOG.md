# @rudderjs/auth

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
