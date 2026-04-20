# @rudderjs/passport

OAuth 2 server for RudderJS — the Laravel Passport equivalent. Turns your app into an OAuth 2 provider that issues RS256-signed JWT access tokens, refresh tokens, and personal access tokens. Also ships the `HasApiTokens` mixin for user models and the `RequireBearer` + `scope` middleware for protecting API routes.

For the narrative guide, see [MCP & AI ↔ Passport](/guide/mcp). This page is the API reference.

## Installation

```bash
pnpm add @rudderjs/passport @rudderjs/auth @rudderjs/orm-prisma
```

Copy the Prisma schema into your app:

```bash
# @rudderjs/passport/schema/passport.prisma → your project's prisma/schema/passport.prisma
pnpm exec prisma generate
pnpm exec prisma db push
```

Generate the RSA keypair (required before issuing tokens):

```bash
pnpm rudder passport:keys
# → storage/oauth-private.key + storage/oauth-public.key
```

In production, skip the filesystem and load keys from env vars instead — see Configuration below.

## Setup

```ts
// config/passport.ts
import type { PassportConfig } from '@rudderjs/passport'

export default {
  scopes: {
    read:  'Read access',
    write: 'Write access',
    admin: 'Full administrative access',
  },
  tokensExpireIn:               15 * 24 * 60 * 60 * 1000,   // 15 days
  refreshTokensExpireIn:        30 * 24 * 60 * 60 * 1000,   // 30 days
  personalAccessTokensExpireIn:  6 * 30 * 24 * 60 * 60 * 1000, // ~6 months
} satisfies PassportConfig
```

Add the provider — auto-discovered after `pnpm rudder providers:discover`, or register explicitly:

```ts
// bootstrap/providers.ts
import { PassportProvider } from '@rudderjs/passport'

export default [
  // ...auth, session, orm first
  PassportProvider,
]
```

Register the OAuth routes. API routes are the right home — the `/oauth/token`, `/oauth/scopes`, and `/oauth/device/code` endpoints are stateless. The `/oauth/authorize` consent endpoint and `/oauth/device/approve` both need `req.user`, so mount them on the `web` group if you use them:

```ts
// routes/api.ts
import { registerPassportRoutes } from '@rudderjs/passport'

registerPassportRoutes(router)
```

## Protecting API routes

```ts
import { RequireBearer, scope } from '@rudderjs/passport'

router.get('/api/user',   [RequireBearer()],                 (req) => req.user)
router.get('/api/posts',  [RequireBearer(), scope('read')],  listPosts)
router.post('/api/posts', [RequireBearer(), scope('write')], createPost)
```

`RequireBearer()` validates the JWT signature, checks expiration, and confirms the token isn't revoked. On success, `req.user` is populated same as under session auth.

`scope(...)` runs after `RequireBearer()` and reads the token's scopes from request state. Wildcard `*` on a token grants everything.

## OAuth grants

Four grants shipped. All go through `POST /oauth/token`.

### Authorization Code + PKCE (web apps, SPAs, mobile)

Standard 3-legged flow. User redirected to `/oauth/authorize`, approves, client exchanges the code at `/oauth/token`.

```bash
# 1. Browser redirect:
GET /oauth/authorize?response_type=code&client_id=<id>&redirect_uri=...&scope=read+write
  &state=<csrf>&code_challenge=<s256>&code_challenge_method=S256

# 2. After user approves (POST /oauth/authorize):
#    browser lands at redirect_uri?code=<authcode>&state=<csrf>

# 3. Client exchanges:
POST /oauth/token
  grant_type=authorization_code&code=<authcode>&client_id=<id>
  &client_secret=<secret>&redirect_uri=...&code_verifier=<pkce-verifier>
```

PKCE is **required** for public clients; confidential clients may still use it.

### Client Credentials (M2M)

For service-to-service auth, confidential clients only.

```bash
POST /oauth/token
  grant_type=client_credentials&client_id=<id>&client_secret=<secret>&scope=read+write
```

### Refresh Token

Rotates the token pair atomically — reusing a refresh token returns `invalid_grant`.

```bash
POST /oauth/token
  grant_type=refresh_token&refresh_token=<jwt>&client_id=<id>&client_secret=<secret>
```

### Device Code (CLIs, smart TVs, IoT)

```bash
# Device:
POST /oauth/device/code
  client_id=<id>&scope=read
# → { device_code, user_code, verification_uri, expires_in, interval }

# User (browser):
POST /oauth/device/approve
  user_code=ABCD-1234&approved=true

# Device polls:
POST /oauth/token
  grant_type=urn:ietf:params:oauth:grant-type:device_code
  &device_code=<opaque>&client_id=<id>
```

## Personal access tokens

GitHub-style long-lived tokens — the user generates one from their account page, sees it once, uses it as a bearer token.

Enable on the User model with the `HasApiTokens` mixin:

```ts
import { Model } from '@rudderjs/orm'
import { HasApiTokens } from '@rudderjs/passport'

export class User extends HasApiTokens(Model) {
  static table = 'user'
}
```

```ts
// Issue — plain-text JWT is shown ONCE
const { plainTextToken, token } = await user.createToken('my-cli', ['read', 'write'])

// Manage
await user.tokens()              // all tokens for this user
await user.revokeAllTokens()     // returns count

// Check current-request token's scope (inside a RequireBearer route)
user.tokenCan('admin')
```

Personal access tokens are issued against an internal `__personal_access__` OAuth client that Passport auto-creates on first use.

## Customization hooks

All hooks live on the `Passport` static singleton. Call them in a provider's `boot()` before routes register:

```ts
import { Passport, OAuthClient } from '@rudderjs/passport'

// Custom consent screen (default returns JSON)
import { view } from '@rudderjs/view'

Passport.authorizationView((ctx) => view('oauth.authorize', {
  client: ctx.client,
  scopes: ctx.scopes,
  redirectUri: ctx.redirectUri,
  state: ctx.state,
}))

// Custom models (add columns, override behavior)
class CustomOAuthClient extends OAuthClient { /* ... */ }
Passport.useClientModel(CustomOAuthClient)
// Also: useTokenModel, useRefreshTokenModel, useAuthCodeModel, useDeviceCodeModel

// Define scopes programmatically
Passport.tokensCan({ read: 'Read', write: 'Write', admin: 'Admin' })

// Disable auto route registration — wire OAuth routes manually
Passport.ignoreRoutes()
```

## Selective route registration

Skip groups you want to handle yourself:

```ts
registerPassportRoutes(router, {
  except: ['authorize', 'scopes'],   // mount custom consent + scopes endpoints
  prefix: '/api/oauth',              // default is '/oauth'
})
```

Available groups: `authorize`, `token`, `revoke`, `scopes`, `device`.

## Configuration

### Key management

```ts
// Option 1 — env vars (production)
{ privateKey: process.env.PASSPORT_PRIVATE_KEY, publicKey: process.env.PASSPORT_PUBLIC_KEY }

// Option 2 — custom directory
{ keyPath: 'secure/keys' }   // reads secure/keys/oauth-{private,public}.key

// Option 3 — default (storage/oauth-{private,public}.key)
```

### Lifetimes (ms)

| Option | Default | Purpose |
|---|---|---|
| `tokensExpireIn` | 15 days | Access token lifetime |
| `refreshTokensExpireIn` | 30 days | Refresh token lifetime |
| `personalAccessTokensExpireIn` | ~6 months | Personal access token lifetime |

## CLI commands

```bash
pnpm rudder passport:keys [--force]                                     # generate RSA keypair
pnpm rudder passport:client "App Name"                                  # confidential client
pnpm rudder passport:client "SPA" --public                              # public (PKCE required)
pnpm rudder passport:client "Service" --client-credentials              # M2M
pnpm rudder passport:client "TV App" --device                           # device flow
pnpm rudder passport:purge                                              # remove expired/revoked
pnpm rudder make:passport-client                                        # scaffold a seeder
```

`passport:client` prints the client ID and (for confidential clients) the secret — secrets are SHA-256 hashed on write, so store the printed value immediately.

## Architecture

Tables in `schema/passport.prisma`:

| Table | Purpose |
|---|---|
| `oauth_clients` | Registered client apps + secrets |
| `oauth_access_tokens` | Issued access tokens (for revocation lookup) |
| `oauth_refresh_tokens` | Refresh tokens, linked 1:1 to an access token |
| `oauth_auth_codes` | Short-lived authorization codes (single-use, 10 min) |
| `oauth_device_codes` | Device flow state |

**JWT shape**: `jti` (token ID), `sub` (user ID), `aud` (client ID), `scopes`, `iat`, `exp`. Signed with RSA-SHA256 so third parties can verify without calling your server. Revocation is DB-checked on every request via `jti`.

---

## Common pitfalls

- **Missing RSA keys.** `passport.token()` throws — run `pnpm rudder passport:keys` or set `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY`.
- **Schema not migrated.** Copy `schema/passport.prisma` into your project's Prisma schema directory and run `prisma db push`.
- **Mounting `AuthMiddleware` globally breaks API routes.** `@rudderjs/auth` auto-installs on the `web` group only — don't call `m.use(AuthMiddleware())`. Use `RequireBearer()` per-route on api.
- **`scope(...)` before `RequireBearer()`.** The scope middleware reads token scopes from request state that `RequireBearer` sets. Order matters.
- **PKCE missing on public clients.** Public clients MUST send `code_challenge` + `code_challenge_method=S256`. No PKCE → `invalid_request`.
- **Refresh token replay.** Rotation revokes the old pair atomically. Reusing an old refresh token returns `invalid_grant`.
- **ORM returns plain records, not Model instances.** `AccessToken.where(...).first()` gives a data object — prototype methods don't exist. Use the helpers in `@rudderjs/passport`'s `models/helpers.ts` or static `Model.update(id, { revoked: true })`.
- **`static table` on a custom Model.** Must be the Prisma delegate name (camelCase, e.g. `oauthClient`), NOT the `@@map`'d SQL name (`oauth_clients`).

---

## Related

- [`@rudderjs/auth`](./auth/) — session-based web auth (login, register, password reset, Gate/Policy)
- [`@rudderjs/orm`](./orm/) — ORM for the OAuth models
- [OAuth 2.1 draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10) — the spec Passport targets
