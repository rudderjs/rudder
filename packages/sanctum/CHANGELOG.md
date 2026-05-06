# @rudderjs/sanctum

## 7.0.0

### Minor Changes

- 015e16e: Fix Sanctum's hardwiring to the session driver (T2/T7).

  - `AuthManager.createProvider(name?)` is now public. With no `name`, it falls back to the default guard's configured provider; with a `name`, it resolves any provider in `auth.providers` independently of any guard. Pure-API apps can now use Sanctum without registering `@rudderjs/session` or a session guard.
  - `SanctumServiceProvider.boot()` resolves the user provider through `manager.createProvider(config.provider)` instead of `manager.guard().provider`. The previous code instantiated a `SessionGuard` just to read its provider, which threw on any non-session default guard. The catch around `app.make('auth.manager')` now narrows to "binding not found" only — provider-resolution errors propagate verbatim instead of being rewritten to "No auth manager found".
  - `SanctumConfig.provider?: string` overrides which entry in `auth.providers` Sanctum uses. Required for pure-API apps; optional in mixed (web + API) setups.

### Patch Changes

- 015e16e: Stop leaking sensitive user columns into `req.user` (T5).

  - `userToPlain(user)` is now exported from `@rudderjs/auth`. Always strips functions plus `password`, `rememberToken`, and `remember_token` (the last two cover both Prisma camelCase and Drizzle/raw-Laravel snake_case schema choices). The previous filter only removed functions and `password`, so columns like `remember_token`, `two_factor_secret`, and `email_verification_token` could surface in `req.user`.
  - `Authenticatable.getHidden?(): string[]` is a new optional method on the contract — Laravel's `$hidden` array. User models that implement it can name app-specific sensitive columns (`two_factor_secret`, `email_verification_token`, …) and `userToPlain` will strip them on top of the always-hidden defaults.
  - `@rudderjs/sanctum`'s middleware now delegates to the shared `userToPlain` instead of inlining a near-duplicate filter loop, so sanctum-authenticated requests inherit the same protection.
  - Fixed a pre-existing bug in `userToPlain` where the spread of the original record was placed _after_ the explicit `String(...)` conversions for `id` / `name` / `email`, silently overriding them. The conversions now win on collision so `id`, `name`, and `email` are guaranteed strings as the `AuthUser` type promises.

- 015e16e: Two small correctness fixes in `Sanctum.validateToken` (T3/T6).

  - Token expiry comparison is now `<=` instead of `<`. A token whose `expiresAt` equals the current millisecond is no longer accepted — both technically correct (the millisecond it expires it's no longer valid) and a fix for flaky millisecond-boundary tests.
  - Bearer prefix matching is case-insensitive per RFC 6750 §2.1. `bearer foo`, `BEARER foo`, and `Bearer foo` are all accepted; some HTTP libraries lowercase header values and the previous strict-case match rejected them.

- 015e16e: Wire `req.token` properly and dedupe `updateLastUsed` writes (T1/T4).

  - `@rudderjs/sanctum` now augments `AppRequest` with `token?: PersonalAccessToken`. `@rudderjs/server-hono` installs a getter on the normalized request that reads from the Hono context, mirroring the existing `req.user` getter. Routes mounted behind `SanctumMiddleware()` / `RequireToken()` can read `req.token` directly — previously the docs promised this but the field was never wired.
  - `RequireToken()` reuses the token already validated by an upstream `SanctumMiddleware()` (read from `req.raw['__rjs_token']`). Stacks like `[SanctumMiddleware(), RequireToken('write')]` now issue exactly one `validateToken` call per request, halving the DB writes to `lastUsedAt` for authenticated API endpoints. `RequireToken()` still validates from scratch when used standalone.

- Updated dependencies [e8cee45]
- Updated dependencies [942bd78]
- Updated dependencies [015e16e]
- Updated dependencies [231d7f6]
- Updated dependencies [015e16e]
  - @rudderjs/auth@5.0.0

## 6.0.1

### Patch Changes

- dfba4df: Include `boost/` directory in the published npm tarball so `@rudderjs/boost`'s MCP server can resolve `guidelines://<pkg>` resources from `node_modules/@rudderjs/<pkg>/boost/guidelines.md` in user apps. Previously only `ai`, `auth`, and `core` shipped their guidelines — the other 17 framework packages had `boost/guidelines.md` in the workspace but excluded from publish, leaving Boost-aware AI assistants with empty guideline resources for ~85% of the framework. No code change; manifest-only.
- Updated dependencies [4c8cd07]
  - @rudderjs/auth@4.0.3
  - @rudderjs/core@1.1.2

## 6.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/auth@4.0.0

## 5.0.1

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/auth@3.2.1

## 5.0.0

### Patch Changes

- Updated dependencies [5239815]
  - @rudderjs/auth@3.2.0

## 4.0.1

### Patch Changes

- Updated dependencies [5ca3e29]
  - @rudderjs/auth@3.1.1

## 4.0.0

### Patch Changes

- Updated dependencies [e720923]
- Updated dependencies [d3d175c]
  - @rudderjs/core@0.1.1
  - @rudderjs/auth@3.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/core@0.1.0
  - @rudderjs/auth@3.0.0

## 2.0.1

### Patch Changes

- @rudderjs/auth@2.0.1
- @rudderjs/core@0.0.12

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/auth@2.0.0
  - @rudderjs/core@0.0.11

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/auth@1.0.0
  - @rudderjs/core@0.0.10

## 0.0.2

### Patch Changes

- Updated dependencies [e1189e9]
  - @rudderjs/auth@0.2.1
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
