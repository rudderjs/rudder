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
- **Access tokens are JWT-only; the DB row holds metadata, not a hash** — by design (see below)
- **Client secrets are SHA-256 hashed** — never stored in plain text
- **Auth codes are single-use** — revoked on exchange, expire in 10 minutes
- **PKCE required for public clients** — enforced in `validateAuthorizationRequest()`
- **Refresh tokens revoke the old pair** — prevents replay attacks
- **Device codes rate-limited** — 5-second polling interval enforced server-side
- **Personal access tokens** — auto-create an internal `__personal_access__` OAuth client on first use

## Why we don't store hashed access tokens

Passport access tokens are JWTs signed with RS256. Each `oauth_access_tokens` row records metadata only — `userId`, `clientId`, `scopes`, `revoked`, `expiresAt` — the JWT itself is never persisted. **The signature is the secrecy boundary**, not a stored hash.

This is the **opposite** of `@rudderjs/sanctum`, which stores SHA-256 hashes of opaque random strings. Reviewers sometimes flag the missing hash column on `AccessToken` as a security gap; it isn't. The model matches Laravel Passport exactly and is safe because:

- A DB dump does **not** leak usable bearer tokens — it only leaks the audit trail (which user/client owns which id, when it expires). Without the private key an attacker cannot mint or forge a valid JWT.
- **Revocation is still authoritative.** `BearerMiddleware` looks up the row on every request and refuses if `revoked === true`. JWT-only verification (skipping the DB lookup) is intentionally not supported.
- **Rotating keys (`rudder passport:keys --force`) invalidates every outstanding access token instantly**, because the new public key won't verify signatures from the old private key. See "Pitfalls" below.

If you want opaque, hashed-at-rest tokens with no JWT verification step, use `@rudderjs/sanctum`. Don't add a hash column to Passport's tokens — it would imply protections this design doesn't (and shouldn't) make.

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
- **Rotating the RSA keypair invalidates every live token.** `rudder passport:keys --force` writes a new private/public pair (the previous keys are renamed to `*.bak.<ISO-timestamp>`, so recovery is possible) but every JWT signed by the old key fails verification under the new public key on the next request. Plan rotations as a forced sign-out window for users and a coordinated re-issue for third-party integrations. There is no JWKS-style "previous key" verifier yet.
- **Don't trust `Host` / `X-Forwarded-Host` for OAuth URLs.** The device-flow endpoint falls back to `${req.protocol}://${req.hostname}${prefix}/device` when `verificationUri` isn't configured, so an attacker-controlled `Host` header steers users to a phishing origin. Always pass an explicit `verificationUri` (or, more generally, derive OAuth URLs from `config('app.url')`) when registering passport routes behind a reverse proxy. The same caveat applies to any custom redirect/callback the app builds from request headers.
