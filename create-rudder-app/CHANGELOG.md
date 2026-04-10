# create-rudder-app

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
