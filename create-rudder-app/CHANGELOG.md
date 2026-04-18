# create-rudder-app

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
