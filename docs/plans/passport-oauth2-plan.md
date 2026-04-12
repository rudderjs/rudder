# @rudderjs/passport — OAuth 2 Server Plan

Full OAuth 2 server for RudderJS, equivalent to Laravel Passport. Turns your application into an OAuth 2 provider so third-party apps, machine-to-machine services, and remote AI agents can authenticate against your API.

**Status:** Not started (parked — future initiative)

**Package:** `@rudderjs/passport` (new)

**Depends on:**
- `@rudderjs/auth` — session guards, user model
- `@rudderjs/orm` — token/client/auth-code persistence via Prisma
- `@rudderjs/core` — service provider, DI, middleware

**Related:**
- MCP OAuth 2.1 (`Mcp.web().oauth2()`) will use Passport under the hood once this ships
- `@rudderjs/auth` handles sessions/guards; Passport handles OAuth 2 token issuance
- Sanctum-style simple API tokens (if needed) would be a separate lightweight package

---

## Goal

After this plan:

1. Third-party apps can authenticate via standard OAuth 2 flows (authorization code, PKCE, client credentials, device authorization).
2. Users can create personal access tokens for API usage.
3. Scopes control fine-grained access to routes.
4. `@rudderjs/mcp` can add `.oauth2()` on web servers that validates Passport-issued tokens.
5. CLI commands manage clients, keys, and token cleanup.

---

## Non-Goals

- **Replacing `@rudderjs/auth`.** Auth handles sessions and guards. Passport handles OAuth 2 token issuance. They're complementary.
- **SAML / LDAP / OpenID Connect.** OAuth 2 only. OIDC could be a future extension.
- **Implicit grant.** Deprecated in OAuth 2.1 — not implementing.
- **Password grant.** Deprecated — not recommended for new apps. May add as opt-in later.

---

## Architecture

### Database Tables (Prisma)

| Table | Purpose |
|---|---|
| `oauth_clients` | Registered OAuth 2 client applications (name, secret hash, redirect URIs, grant types) |
| `oauth_access_tokens` | Issued access tokens (user, client, scopes, expires_at, revoked) |
| `oauth_refresh_tokens` | Refresh tokens linked to access tokens |
| `oauth_auth_codes` | Authorization codes for the auth code grant (short-lived) |
| `oauth_device_codes` | Device codes for the device authorization grant |

### Key Management

RSA keypairs for JWT signing:
- Generate via `rudder passport:keys`
- Or load from environment: `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY`
- Keys stored in `storage/` (gitignored) or env vars for production

### Token Format

JWTs signed with the RSA private key. Expiration is encoded in the token itself — `expires_at` in the database is display-only. Revocation requires marking the token as revoked in the DB.

---

## Phase 1 — Core Token Infrastructure

### Files to create:

```
packages/passport/
├── src/
│   ├── index.ts              # Exports + PassportProvider
│   ├── Passport.ts           # Static config (scopes, lifetimes, key paths)
│   ├── token.ts              # JWT creation + validation (sign/verify with RSA)
│   ├── models/
│   │   ├── OAuthClient.ts    # Client model
│   │   ├── AccessToken.ts    # Access token model
│   │   ├── RefreshToken.ts   # Refresh token model
│   │   ├── AuthCode.ts       # Authorization code model
│   │   └── DeviceCode.ts     # Device code model
│   ├── middleware/
│   │   ├── bearer.ts         # Extract + validate Bearer token from request
│   │   └── scope.ts          # Scope enforcement middleware
│   ├── routes.ts             # /oauth/* route registration
│   └── commands/
│       ├── keys.ts           # passport:keys — generate RSA keypair
│       ├── client.ts         # passport:client — create clients interactively
│       └── purge.ts          # passport:purge — remove expired tokens
├── prisma/
│   └── passport.prisma       # Multi-file Prisma schema for oauth tables
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── README.md
```

### What it does:

- `Passport.tokensCan({ 'read': 'Read data', 'write': 'Write data' })` — define scopes
- `Passport.tokensExpireIn(ms)` / `refreshTokensExpireIn(ms)` — configure lifetimes
- Bearer token middleware extracts token from `Authorization` header, validates JWT signature + expiration + revocation
- Scope middleware: `.middleware([scope('read', 'write')])` — rejects if token lacks required scopes
- `user.createToken('name', ['read'])` — personal access tokens via `HasApiTokens` mixin
- `user.tokens()` — list user's tokens
- `token.revoke()` — revoke a specific token

---

## Phase 2 — Grant Types

### Authorization Code Grant (+ PKCE)

Standard third-party OAuth 2 flow:

1. Client redirects user to `GET /oauth/authorize?client_id=X&redirect_uri=Y&response_type=code&scope=read&state=Z`
2. User sees consent screen (view — React/Vue/vanilla via `@rudderjs/view`)
3. User approves → redirect back with `?code=ABC&state=Z`
4. Client exchanges code at `POST /oauth/token` → receives access + refresh tokens

PKCE variant: client sends `code_challenge` + `code_challenge_method` on authorize, `code_verifier` on token exchange. No client secret needed.

### Client Credentials Grant

Machine-to-machine, no user context:

```
POST /oauth/token
  grant_type=client_credentials
  client_id=X
  client_secret=Y
  scope=read
```

### Device Authorization Grant

For browserless devices:

1. Device requests code from `POST /oauth/device/code`
2. Returns `device_code`, `user_code`, `verification_uri`
3. User visits verification URI, enters user code, approves
4. Device polls `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`

### Refresh Token Grant

Exchange refresh token for new access + refresh token pair.

---

## Phase 3 — OAuth Routes

| Method | Path | Description |
|---|---|---|
| GET | `/oauth/authorize` | Show authorization consent screen |
| POST | `/oauth/authorize` | Approve authorization |
| DELETE | `/oauth/authorize` | Deny authorization |
| POST | `/oauth/token` | Issue tokens (all grant types) |
| POST | `/oauth/token/refresh` | Refresh access token |
| DELETE | `/oauth/tokens/:id` | Revoke specific token |
| DELETE | `/oauth/tokens` | Revoke all user tokens |
| GET | `/oauth/scopes` | List available scopes (JSON) |
| GET | `/oauth/personal-access-tokens` | List personal tokens |
| POST | `/oauth/personal-access-tokens` | Create personal token |
| DELETE | `/oauth/personal-access-tokens/:id` | Revoke personal token |
| POST | `/oauth/device/code` | Request device code |

---

## Phase 4 — CLI Commands

| Command | Description |
|---|---|
| `rudder passport:keys` | Generate RSA keypair in `storage/` |
| `rudder passport:client` | Interactive client creation (prompts for name, redirect URIs, grant type) |
| `rudder passport:client --public` | Create PKCE client (no secret) |
| `rudder passport:client --device` | Create device authorization client |
| `rudder passport:client --personal` | Create personal access token client |
| `rudder passport:purge` | Remove expired/revoked tokens from DB |

---

## Phase 5 — MCP OAuth 2.1 Integration

Once Passport ships, wire it into MCP:

```ts
Mcp.web('/mcp/weather', WeatherServer)
  .oauth2()  // ← validates Bearer token via Passport middleware
```

The `.oauth2()` helper pushes Passport's bearer token middleware onto the MCP endpoint's middleware stack. The MCP spec's OAuth 2.1 discovery (RFC 9728) can be served from `/.well-known/oauth-authorization-server`.

---

## Phase 6 — Customization

| Config | Purpose |
|---|---|
| `Passport.useTokenModel(CustomToken)` | Custom token model |
| `Passport.useClientModel(CustomClient)` | Custom client model |
| `Passport.authorizationView(viewFn)` | Custom consent screen (works with `@rudderjs/view`) |
| `Passport.loadKeysFrom(path)` | Custom key file location |
| `Passport.ignoreRoutes()` | Disable auto-registered routes for manual wiring |

---

## Configuration Example

```ts
// config/passport.ts
export default {
  keyPath: 'storage/',
  tokensExpireIn: 15 * 24 * 60 * 60 * 1000,        // 15 days
  refreshTokensExpireIn: 30 * 24 * 60 * 60 * 1000,  // 30 days
  personalAccessTokensExpireIn: 6 * 30 * 24 * 60 * 60 * 1000, // ~6 months
  scopes: {
    'read': 'Read access to resources',
    'write': 'Write access to resources',
    'admin': 'Full administrative access',
  },
}
```

```ts
// bootstrap/providers.ts
import { passport } from '@rudderjs/passport'
export default [..., passport(configs.passport)]
```

```ts
// routes/api.ts
import { Route } from '@rudderjs/router'
import { scope } from '@rudderjs/passport'

Route.get('/user', (req, res) => {
  res.json(req.user)
}).middleware(['auth:api'])

Route.post('/orders', OrderController.store)
  .middleware(['auth:api', scope('write', 'place-orders')])
```

---

## User API

```ts
// HasApiTokens mixin on User model
const token = await user.createToken('my-app', ['read', 'write'])
console.log(token.accessToken) // JWT string

const tokens = await user.tokens()
await token.revoke()

// In a controller
if (req.user.tokenCan('write')) {
  // authorized
}
```

---

## Phase Order

| Phase | Description | Depends on |
|---|---|---|
| 1 | Core token infrastructure (JWT, models, middleware, keys) | — |
| 2 | Grant types (auth code, PKCE, client credentials, device) | Phase 1 |
| 3 | OAuth routes (/oauth/*) | Phase 2 |
| 4 | CLI commands (keys, client, purge) | Phase 1 |
| 5 | MCP OAuth 2.1 integration | Phase 3 + `@rudderjs/mcp` |
| 6 | Customization points | Phase 3 |

---

## Verification Checklist

- [ ] RSA key generation works
- [ ] Authorization code flow completes end-to-end
- [ ] PKCE flow works for public clients
- [ ] Client credentials grant issues tokens
- [ ] Device authorization flow works
- [ ] Personal access tokens created/listed/revoked
- [ ] Bearer middleware validates JWT signature + expiration
- [ ] Scope middleware rejects insufficient permissions
- [ ] Token revocation works
- [ ] `passport:purge` removes expired tokens
- [ ] MCP `.oauth2()` validates tokens
- [ ] Prisma schema integrates with multi-file setup
- [ ] `pnpm typecheck` clean across monorepo
