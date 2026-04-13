# @rudderjs/passport

OAuth 2 server — Laravel Passport equivalent. Turns your app into an OAuth 2 provider with JWT tokens.

## Key Files

- `src/index.ts` — All exports + `PassportProvider`
- `src/Passport.ts` — Static config singleton (scopes, lifetimes, RSA keys)
- `src/token.ts` — JWT creation/verification using RS256
- `src/personal-access-tokens.ts` — `HasApiTokens` mixin for user models
- `src/routes.ts` — `registerPassportRoutes()` for `/oauth/*` endpoints
- `src/grants/` — OAuth 2 grant implementations:
  - `authorization-code.ts` — Auth code + PKCE
  - `client-credentials.ts` — Machine-to-machine
  - `refresh-token.ts` — Token rotation
  - `device-code.ts` — Device authorization flow
  - `issue-tokens.ts` — Shared token issuance (DB + JWT)
- `src/models/` — ORM models: `OAuthClient`, `AccessToken`, `RefreshToken`, `AuthCode`, `DeviceCode`
- `src/middleware/bearer.ts` — `BearerMiddleware()`, `RequireBearer()`
- `src/middleware/scope.ts` — `scope('read', 'write')` enforcement
- `src/commands/` — `generateKeys()`, `createClient()`, `purgeTokens()`
- `schema/passport.prisma` — 5 OAuth tables

## Architecture Rules

- **JWT signed with RSA-SHA256** — private key signs, public key verifies. Third parties can verify without calling your server.
- **Keys from env or filesystem** — `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` env vars, or files at `storage/oauth-{private,public}.key`
- **Client secrets are SHA-256 hashed** — never stored in plain text
- **Auth codes are single-use** — revoked on exchange, expire in 10 minutes
- **PKCE required for public clients** — enforced in `validateAuthorizationRequest()`
- **Refresh tokens revoke the old pair** — prevents replay attacks
- **Device codes rate-limited** — 5-second polling interval enforced server-side
- **Personal access tokens** — auto-create an internal `__personal_access__` OAuth client on first use

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## CLI Commands (registered in provider boot)

- `rudder passport:keys [--force]` — Generate RSA keypair
- `rudder passport:client <name> [--public|--device|--personal]` — Create OAuth client
- `rudder passport:purge` — Remove expired/revoked tokens

## Usage

```ts
// config/passport.ts
export default {
  scopes: { read: 'Read access', write: 'Write access' },
  tokensExpireIn: 15 * 24 * 60 * 60 * 1000,
}

// routes/api.ts
import { RequireBearer, scope } from '@rudderjs/passport'
router.get('/user', [RequireBearer(), scope('read')], handler)

// User model with personal tokens
import { HasApiTokens } from '@rudderjs/passport'
class User extends HasApiTokens(Model) { ... }
const { plainTextToken } = await user.createToken('my-app', ['read'])
```

## Pitfalls

- Must run `rudder passport:keys` before issuing tokens (or set env vars)
- Prisma schema must be added to playground's multi-file schema setup
- `BearerMiddleware` must run after auth middleware (needs user provider)
- `exactOptionalPropertyTypes` requires careful handling of optional fields in grant responses
