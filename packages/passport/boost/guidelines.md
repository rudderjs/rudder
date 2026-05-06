# @rudderjs/passport

## Overview

OAuth 2 server package — issues JWT access tokens, refresh tokens, and personal access tokens. Ships four grants (authorization code + PKCE, client credentials, refresh token, device code), a `HasApiTokens` mixin for user models, and `RequireBearer` + `scope` middleware for protecting API routes. JWTs are RS256-signed, so third parties can verify them without calling the server.

## When to Use Passport vs Auth

`@rudderjs/auth` covers **session-based web auth** — login forms, cookies, password reset, email verification. `@rudderjs/passport` covers **token-based API auth** — OAuth flows for third-party integrations, M2M service auth, personal access tokens.

Most apps need both:

- **Web routes** (`m.web` group): `AuthMiddleware` runs automatically — read `req.user` directly.
- **API routes** (`m.api` group): stateless by default. Opt in per-route with `RequireBearer()` + `scope(...)`, or mount `AuthMiddleware('api')` + `RequireAuth('api')` with a token guard.

**Don't** mount `AuthMiddleware` globally via `m.use(...)`. API routes must stay stateless so they don't depend on session ALS context.

## Key Patterns

### Protecting API Routes

```ts
import { RequireBearer, scope } from '@rudderjs/passport'

router.get('/api/user',   [RequireBearer()],                 (req) => req.user)
router.get('/api/posts',  [RequireBearer(), scope('read')],  listPosts)
router.post('/api/posts', [RequireBearer(), scope('write')], createPost)
```

`RequireBearer()` validates the JWT signature, checks expiration, and confirms the token hasn't been revoked in the DB. A valid token attaches the user to `req.user` (same shape as session-based routes).

`scope(...)` must run **after** `RequireBearer()` — it reads token scopes from request state set by the bearer middleware. Wildcard `*` grants everything.

### Personal Access Tokens (HasApiTokens)

```ts
import { Model } from '@rudderjs/orm'
import { HasApiTokens } from '@rudderjs/passport'

export class User extends HasApiTokens(Model) {
  static table = 'user'
}

// Issue — plain-text JWT is shown ONCE
const { plainTextToken, token } = await user.createToken('my-cli', ['read', 'write'])

// Manage
await user.tokens()            // all tokens for this user
await user.revokeAllTokens()   // revokes all, returns count
user.tokenCan('admin')         // checks current-request token's scope (inside RequireBearer route)
```

Personal access tokens are issued against an internal `__personal_access__` OAuth client that Passport auto-creates on first use.

### Route Registration

```ts
// routes/api.ts
import { registerPassportRoutes } from '@rudderjs/passport'

export default (router) => {
  registerPassportRoutes(router)           // mounts /oauth/* endpoints
}

// Or selectively skip groups:
registerPassportRoutes(router, {
  except: ['authorize', 'scopes'],  // mount custom consent + scopes endpoints
  prefix: '/api/oauth',             // default is '/oauth'
})
```

Available groups: `authorize`, `token`, `revoke`, `scopes`, `device`.

### Customization Hooks

All hooks live on the `Passport` static singleton. Call them from a provider's `boot()` method, before routes register:

```ts
import { Passport, OAuthClient } from '@rudderjs/passport'
import { view } from '@rudderjs/view'

// Custom consent screen (default returns JSON)
Passport.authorizationView((ctx) => {
  return view('oauth.authorize', {
    client: ctx.client,
    scopes: ctx.scopes,
    redirectUri: ctx.redirectUri,
    state: ctx.state,
  })
})

// Swap any model (add columns, override behavior)
class CustomOAuthClient extends OAuthClient { /* ... */ }
Passport.useClientModel(CustomOAuthClient)
// Also: useTokenModel, useRefreshTokenModel, useAuthCodeModel, useDeviceCodeModel

// Disable automatic route registration entirely
Passport.ignoreRoutes()  // registerPassportRoutes() becomes a no-op

// Scopes can also be defined here instead of config
Passport.tokensCan({ read: 'Read access', write: 'Write access' })
```

### Config Shape

```ts
// config/passport.ts
import type { PassportConfig } from '@rudderjs/passport'

export default {
  scopes: { read: 'Read', write: 'Write', admin: 'Admin' },

  // Keys — prefer env vars in production
  privateKey: process.env.PASSPORT_PRIVATE_KEY,
  publicKey:  process.env.PASSPORT_PUBLIC_KEY,
  // OR filesystem:
  keyPath:    'storage',  // reads storage/oauth-{private,public}.key

  // Lifetimes (ms)
  tokensExpireIn:               15 * 24 * 60 * 60 * 1000,
  refreshTokensExpireIn:        30 * 24 * 60 * 60 * 1000,
  personalAccessTokensExpireIn: 6 * 30 * 24 * 60 * 60 * 1000,
} satisfies PassportConfig
```

### CLI Commands

```bash
pnpm rudder passport:keys [--force]                    # generate RSA keypair
pnpm rudder passport:client "App Name" [--public|--client-credentials|--device|--personal]
pnpm rudder passport:purge                             # remove expired/revoked records
pnpm rudder make:passport-client                       # scaffold a client seeder
```

## Common Pitfalls

- **Missing RSA keys** — run `pnpm rudder passport:keys` before issuing tokens, or set `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` env vars. Without keys, `passport.token()` throws.
- **Prisma schema not copied** — `@rudderjs/passport` ships 5 Prisma models in `schema/passport.prisma`. Copy that file into the app's multi-file Prisma schema directory and run `prisma db push`. The provider does not migrate for you.
- **Mounting `AuthMiddleware` globally breaks API routes** — `@rudderjs/auth`'s `AuthMiddleware` auto-installs on the `web` group only. API routes stay stateless; opt into auth per-route with `RequireBearer()`. Never call `m.use(AuthMiddleware())` — it reintroduces the old global-install problem.
- **Scope middleware before bearer** — `scope('read')` must come after `RequireBearer()` in the middleware array; it reads the token scopes the bearer middleware attaches to the request.
- **PKCE required for public clients** — public clients (created with `--public`) must send `code_challenge` + `code_challenge_method=S256`. Missing PKCE → `invalid_request`.
- **Refresh token reuse** — rotation revokes the old refresh token atomically. Retrying with the old one returns `invalid_grant`.
- **ORM returns records, not Model instances** — `AccessToken.where(...).first()` returns a plain data object. Prototype methods don't work on query results. Use `@rudderjs/passport`'s `models/helpers.ts` helpers (e.g. `accessTokenHelpers.can(token, scope)`) rather than calling methods on the record.
- **Custom model `static table`** — use the Prisma delegate name (camelCase, e.g. `oauthClient`), NOT the `@@map`'d SQL name (`oauth_clients`). Wrong table name → `[RudderJS ORM] Prisma has no delegate for table "oauth_clients"`.
- **Consent screen needs session** — `POST /oauth/authorize` and `POST /oauth/device/approve` both require `req.user`. If you mount OAuth routes on the `api` group, these two routes will 401. Either keep consent + device-approve on the `web` group, or mount `SessionMiddleware()` + `AuthMiddleware()` per-route.
- **Personal access client cache** — `_personalClientId` is cached module-level. `resetPersonalAccessClient()` is test-only; don't call it in production code.
- **Don't store plain-text JWTs** — `user.createToken()` returns `plainTextToken` once. The DB stores only the record (used for revocation lookup via `jti`). Show the JWT to the user; they must save it themselves.

## Key Imports

```ts
// Middleware
import { RequireBearer, BearerMiddleware, scope } from '@rudderjs/passport'

// Personal access tokens (user model mixin)
import { HasApiTokens } from '@rudderjs/passport'

// Customization
import { Passport } from '@rudderjs/passport'

// Route registration
import { registerPassportRoutes } from '@rudderjs/passport'
import type { PassportRouteOptions, PassportRouteGroup } from '@rudderjs/passport'

// Grant primitives (for custom route handlers)
import {
  validateAuthorizationRequest,
  issueAuthCode,
  exchangeAuthCode,
  clientCredentialsGrant,
  refreshTokenGrant,
  requestDeviceCode,
  pollDeviceCode,
  approveDeviceCode,
  OAuthError,
} from '@rudderjs/passport'

// Models
import { OAuthClient, AccessToken, RefreshToken, AuthCode, DeviceCode } from '@rudderjs/passport'

// JWT primitives
import { createToken, verifyToken, unsafeDecodeToken } from '@rudderjs/passport'
// `decodeToken` is kept as a deprecated alias for `unsafeDecodeToken`. The
// `unsafe` prefix is intentional — the function does NOT verify the
// signature, so its output cannot be trusted for auth decisions. Use
// `verifyToken` whenever you need an authenticated payload.

// Types
import type { PassportConfig, PassportScope, NewPersonalAccessToken } from '@rudderjs/passport'
```
