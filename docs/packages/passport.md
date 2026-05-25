# Passport

OAuth 2 server for Rudder. Turns your app into an OAuth 2 provider that issues RS256-signed JWT access tokens, refresh tokens, and personal access tokens. Also ships the `HasApiTokens` mixin for user models and the `RequireBearer` + `scope` middleware for protecting API routes.

## Install

```bash
pnpm add @rudderjs/passport @rudderjs/auth @rudderjs/orm-prisma
```

Publish the Prisma schema and apply it:

```bash
pnpm rudder vendor:publish --tag=passport-schema
pnpm rudder migrate
```

Generate the RSA keypair (required before issuing tokens):

```bash
pnpm rudder passport:keys
# → storage/oauth-private.key + storage/oauth-public.key
```

In production, load keys from env vars instead of the filesystem.

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
  refreshTokensExpireIn:        30 * 24 * 60 * 60 * 1000,
  personalAccessTokensExpireIn:  6 * 30 * 24 * 60 * 60 * 1000,
} satisfies PassportConfig
```

The provider is auto-discovered. The recommended layout splits the routes across the web and api groups so the consent flow gets session + CSRF, and the stateless token/device/scope endpoints stay on api:

```ts
// routes/web.ts — consent + revoke (needs session + signed-in user + CSRF)
import { registerPassportWebRoutes } from '@rudderjs/passport'
registerPassportWebRoutes(router)

// routes/api.ts — stateless endpoints
import { registerPassportApiRoutes } from '@rudderjs/passport'
registerPassportApiRoutes(router)
```

The legacy single-mount `registerPassportRoutes(router)` still works for single-group apps.

> **POST `/oauth/authorize` is CSRF-protected.** Mount `CsrfMiddleware()` on the entire `web` group (`m.web(CsrfMiddleware())` in `withMiddleware`) — that covers it along with every other state-changing web route. Don't also pass `[CsrfMiddleware()]` via `authorizeMiddleware`; double-mounting emits duplicate `Set-Cookie`s on GETs.

## Protecting API routes

`RequireBearer()` validates the JWT signature, expiration, and revocation. Pair it with `scope(...)` (AND — every listed scope required) or `scopeAny(...)` (OR — at least one):

```ts
import { RequireBearer, scope, scopeAny } from '@rudderjs/passport'

router.get ('/api/user',   [RequireBearer()],                            (req) => req.user)
router.get ('/api/posts',  [RequireBearer(), scope('read')],             listPosts)
router.post('/api/posts',  [RequireBearer(), scope('write')],            createPost)
router.get ('/api/feed',   [RequireBearer(), scopeAny('read', 'admin')], showFeed)  // either scope unlocks it
```

On success, `req.user` is populated. The wildcard scope `*` on a token grants every scope.

## OAuth grants

Four grants. All exchange via `POST /oauth/token`.

### Authorization Code + PKCE (web, SPA, mobile)

Standard 3-legged flow. PKCE is **required** for public clients; confidential clients may still use it.

```bash
GET /oauth/authorize?response_type=code&client_id=<id>&redirect_uri=...
  &scope=read+write&state=<csrf>&code_challenge=<s256>&code_challenge_method=S256

POST /oauth/token
  grant_type=authorization_code&code=<authcode>&client_id=<id>
  &client_secret=<secret>&redirect_uri=...&code_verifier=<pkce-verifier>
```

### Client Credentials (M2M)

```bash
POST /oauth/token
  grant_type=client_credentials&client_id=<id>&client_secret=<secret>&scope=read+write
```

### Refresh Token

Rotates the pair atomically — reusing an old refresh token returns `invalid_grant`.

```bash
POST /oauth/token
  grant_type=refresh_token&refresh_token=<jwt>&client_id=<id>&client_secret=<secret>
```

### Device Code (CLIs, smart TVs, IoT)

```bash
POST /oauth/device/code  → { device_code, user_code, verification_uri }
POST /oauth/device/approve   user_code=ABCD-1234&approved=true
POST /oauth/token            grant_type=urn:ietf:params:oauth:grant-type:device_code
                             &device_code=<opaque>&client_id=<id>
```

## Personal access tokens

Long-lived tokens — the user generates one from their account page, sees it once, uses it as a bearer token. Enable on the User model with the `HasApiTokens` mixin:

```ts
import { Model } from '@rudderjs/orm'
import { HasApiTokens } from '@rudderjs/passport'

export class User extends HasApiTokens(Model) {
  static table = 'user'
}
```

```ts
const { plainTextToken } = await user.createToken('my-cli', ['read', 'write'])
await user.tokens()              // all tokens for this user
await user.revokeAllTokens()
user.tokenCan('admin')           // current-request token's scope
```

Personal access tokens are issued against an internal `__personal_access__` OAuth client that Passport auto-creates on first use.

## Per-endpoint middleware

`registerPassportRoutes()` (and the web/api variants) accept per-endpoint middleware so you can layer rate limits or CSRF onto exactly the endpoints that need them:

```ts
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'

registerPassportRoutes(router, {
  // POST /oauth/token — the canonical brute-force target. Composite key
  // (ip + client_id) prevents one noisy client behind shared NAT from
  // exhausting the budget AND blocks IP-level churn through every client_id.
  tokenMiddleware: [
    RateLimit.perMinute(10).by((req) => `${req.ip}:${req.body?.client_id}`),
  ],

  // POST /oauth/device/* — tighter per-IP limit on top of the api-group rate limit.
  deviceMiddleware: [
    RateLimit.perMinute(5).by((req) => req.ip),
  ],

  // GET/POST /oauth/authorize — per-route CSRF when NOT running it on the whole web group.
  authorizeMiddleware: [
    CsrfMiddleware(),
  ],
})
```

> `RateLimit` requires `@rudderjs/cache` registered before middleware runs — without a cache provider the limiter silently passes through.

## JWT issuer (opt-in)

```ts
// config/passport.ts
export default {
  issuer: 'https://app.example.com',   // or Passport.useIssuer(url) at boot
}
```

When set, every new JWT carries this URL as the `iss` claim and `BearerMiddleware` / `RequireBearer` reject tokens whose `iss` doesn't match. Tokens minted before the issuer was configured carry no `iss` claim and stay verifiable during the migration window — same compat shape as `redirect_uri` and `familyId`. Single-issuer deployments don't need this; turn it on once you have more than one possible signer (multi-tenant, staging+prod sharing keys) per RFC 8725 §3.10.

> **Rotating the issuer URL invalidates every live token.** Plan changes as a forced sign-out window — same blast radius as rotating the RSA keypair.

## Device-flow polling cap

```ts
// config/passport.ts
export default {
  deviceMaxInterval: 60,   // seconds; default 60, floor 5 (clamped)
}
```

Device-code polling starts at 5 seconds and escalates by 5s per `slow_down` response per RFC 8628 §3.5. `deviceMaxInterval` caps the escalation. Raise it for machine-only / no-human-in-the-loop device flows where misbehaving clients warrant aggressive back-off. Values below 5 are clamped to the 5s floor — escalation must always be able to take effect.

## Key rotation grace window

`pnpm rudder passport:keys --force` rotates the RSA keypair and writes timestamped audit backups (`*.bak.<ISO-timestamp>`) plus a rolling `storage/oauth-previous-public.key`. Every JWT carries a `kid` header equal to the SHA-256 fingerprint of the public key that signed it; `verifyToken()` walks `[currentPublicKey, ...previousPublicKeys]` and accepts a match against any retained key, so **tokens minted before the rotation keep verifying until they expire naturally** — no global sign-out at rotation time.

One previous-slot is retained by design. Drop `oauth-previous-public.key` (or call `Passport.setPreviousPublicKey(null)`) once the old tokens have expired to close the window.

## Reaping expired tokens

`AuthCode`, `DeviceCode`, `AccessToken`, and `RefreshToken` are all `MassPrunable`, so `pnpm rudder model:prune` reaps expired/revoked rows automatically — no need to schedule `passport:purge` separately. `PassportProvider.boot()` registers the four classes with `ModelRegistry` eagerly so the prune walker sees them on day-1 fresh apps before any oauth flow has fired. `passport:purge` remains available for one-off cleanups.

## Customization

```ts
import { Passport, OAuthClient } from '@rudderjs/passport'
import { view } from '@rudderjs/view'

// Custom consent screen
Passport.authorizationView((ctx) => view('oauth.authorize', {
  client: ctx.client, scopes: ctx.scopes, redirectUri: ctx.redirectUri, state: ctx.state,
}))

// Custom models
class CustomOAuthClient extends OAuthClient { /* ... */ }
Passport.useClientModel(CustomOAuthClient)
// Also: useTokenModel, useRefreshTokenModel, useAuthCodeModel, useDeviceCodeModel

// Programmatic scopes
Passport.tokensCan({ read: 'Read', write: 'Write', admin: 'Admin' })

// Skip groups, mount custom routes
registerPassportRoutes(router, {
  except: ['authorize', 'scopes'],
  prefix: '/api/oauth',
})
```

Available groups: `authorize`, `token`, `revoke`, `scopes`, `device`.

## CLI

```bash
pnpm rudder passport:keys [--force]                              # generate RSA keypair
pnpm rudder passport:client "App Name"                           # confidential client
pnpm rudder passport:client "SPA" --public                       # public (PKCE required)
pnpm rudder passport:client "Service" --client-credentials       # M2M
pnpm rudder passport:client "TV App" --device                    # device flow
pnpm rudder passport:purge                                       # remove expired/revoked
```

`passport:client` prints the client ID and secret — secrets are SHA-256 hashed on write, so save the printed value immediately.

## Token shape

JWT claims: `jti` (token ID), `sub` (user ID), `aud` (client ID), `scopes`, `iat`, `exp`. Signed RS256 so third parties can verify without calling your server; revocation is DB-checked on each request via `jti`.

| Table | Purpose |
|---|---|
| `oauth_clients` | Registered client apps + hashed secrets |
| `oauth_access_tokens` | Issued tokens (revocation lookup) |
| `oauth_refresh_tokens` | Refresh tokens, 1:1 with access tokens |
| `oauth_auth_codes` | Short-lived authorization codes (10 min, single-use) |
| `oauth_device_codes` | Device flow state |

## Pitfalls

- **Missing RSA keys.** `passport.token()` throws. Run `pnpm rudder passport:keys` or set `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY`.
- **`scope(...)` / `scopeAny(...)` before `RequireBearer()`.** Scope middleware reads request state that `RequireBearer` sets. Order matters.
- **PKCE missing on public clients.** Public clients **must** send `code_challenge` + `code_challenge_method=S256`. Without PKCE → `invalid_request`.
- **Mounting `AuthMiddleware` globally for API.** `@rudderjs/auth` is `web`-only by design. Use `RequireBearer()` per-route on the `api` group.
- **`static table` on custom Models.** It's the Prisma delegate (camelCase, e.g. `oauthClient`), NOT the SQL table (`oauth_clients`).
- **`APP_KEY` rotation invalidates every peppered client secret.** When `APP_KEY` is set, `passport:client` stores client secrets as `peppered:<HMAC-SHA256(secret, APP_KEY)>`. Replace `APP_KEY` and the HMAC no longer reproduces — every confidential client fails token-endpoint authentication until you re-issue secrets via `passport:client`. Plan rotations as a coordinated re-issuance window with third-party integrations. Legacy plain-SHA-256 rows (minted before `APP_KEY` was set) are unaffected.
- **Don't trust `Host` / `X-Forwarded-Host` for OAuth URLs.** The device flow falls back to `${req.protocol}://${req.hostname}${prefix}/device` when `verificationUri` isn't configured — an attacker-controlled `Host` header steers users to a phishing origin. Always pass an explicit `verificationUri` (or derive OAuth URLs from `config('app.url')`) when registering passport routes behind a reverse proxy.

## Related

- [Authentication](/guide/authentication) — session-based web auth
- [Database](/guide/database) — ORM the OAuth tables build on
- [OAuth 2.1 draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-10) — the spec Passport targets
