# @rudderjs/passport

OAuth 2 server — Laravel Passport equivalent. Turns your app into an OAuth 2 provider with JWT tokens.

## Key Files

- `src/index.ts` — All exports + `PassportProvider`
- `src/Passport.ts` — Static config singleton (scopes, lifetimes, RSA keys)
- `src/token.ts` — JWT creation/verification using RS256
- `src/personal-access-tokens.ts` — `HasApiTokens` mixin for user models
- `src/routes.ts` — `registerPassportRoutes()` (everything), `registerPassportWebRoutes()` (consent + revoke), `registerPassportApiRoutes()` (token + device + scopes)
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
- `src/client-secret.ts` — `hashClientSecret()` / `verifyClientSecret()` (HMAC-SHA256 with `APP_KEY` pepper, plain-SHA-256 fallback)
- `schema/passport.prisma` — 5 OAuth tables

## Architecture Rules

- **JWT signed with RSA-SHA256** — private key signs, public key verifies. Third parties can verify without calling your server.
- **Keys from env or filesystem** — `PASSPORT_PRIVATE_KEY`/`PASSPORT_PUBLIC_KEY` env vars, or files at `storage/oauth-{private,public}.key`
- **Access tokens are JWT-only; the DB row holds metadata, not a hash** — by design (see below)
- **Client secrets are hashed at rest** — peppered HMAC-SHA256 (`peppered:<hex>`) when `APP_KEY` is set, plain SHA-256 hex digest otherwise. Format is self-describing per row, so legacy plain-SHA-256 secrets keep verifying after the operator configures `APP_KEY`. Rotating `APP_KEY` invalidates every peppered row — see "Pitfalls".
- **Auth codes are single-use** — revoked on exchange, expire in 10 minutes
- **PKCE required for public clients** — enforced in `validateAuthorizationRequest()`
- **Refresh tokens revoke the old pair** — prevents replay attacks
- **Device codes rate-limited** — initial 5-second polling interval enforced server-side; escalates by 5s per `slow_down` response (capped at 60s) per RFC 8628 §3.5. The current interval is persisted on the row and forwarded in the `slow_down` response body so well-behaved clients use the new value directly instead of guessing.
- **Device codes hashed at rest** — both `deviceCode` and `userCode` are stored as SHA-256 hashes in `oauth_device_codes` (`deviceCodeHash` / `userCodeHash` columns). The plaintext is generated and returned once in the `/oauth/device/code` response body and never persisted. `pollDeviceCode` and `approveDeviceCode` hash their plaintext input before lookup. RFC 8628 §6.1.
- **Personal access tokens** — auto-create an internal `__personal_access__` OAuth client on first use
- **Routes split between web and api groups** — the consent flow (`GET/POST/DELETE /oauth/authorize` + `DELETE /oauth/tokens/:id`) belongs on the **web** group because it depends on session + authenticated user resolution. The token + device + scopes endpoints are stateless and belong on **api**. Use `registerPassportWebRoutes()` in `routes/web.ts` and `registerPassportApiRoutes()` in `routes/api.ts`. The original `registerPassportRoutes()` mounts everything on a single router and is kept for back-compat / single-group apps.
- **JWT `iss` validation is opt-in via `Passport.useIssuer(url)` / `config('passport.issuer')`** — when set, `createToken()` stamps the URL as the `iss` claim and `BearerMiddleware`/`RequireBearer` reject tokens whose `iss` doesn't match. Tokens minted before the issuer was configured carry no `iss` claim and stay verifiable during the migration window — same compat pattern as `redirect_uri` (P1) and `familyId` (P4). Single-issuer deployments don't need this; turn it on once you have more than one possible signer (multi-tenant, staging+prod sharing keys, etc.) per RFC 8725 §3.10.
- **`verifyToken(jwt, { expectedAud })` is the per-call `aud` check** — resource servers gating to a specific client_id should pass `expectedAud` so cross-client token confusion is caught at verify time. `BearerMiddleware` doesn't pass `expectedAud` itself (it doesn't know the expected client until after the DB lookup); the lookup-by-jti gives the same protection in practice.
- **POST `/oauth/authorize` requires CSRF** — it's a state-changing endpoint reached from a logged-in browser session, so it's a textbook CSRF target. The recommended setup is to mount `CsrfMiddleware` on the entire web group from `bootstrap/app.ts` — `withMiddleware((m) => m.web(CsrfMiddleware()))` — which automatically covers `/oauth/authorize` along with every other state-changing web route. Apps that prefer per-route opt-in can pass `[CsrfMiddleware()]` via `authorizeMiddleware` instead. Either path works; **don't do both** — CsrfMiddleware running twice on the same request emits duplicate `Set-Cookie`s on GETs and runs the validation pass twice on POSTs, which is wasteful and confusing for future readers.
- **Token models are `MassPrunable`** — `AuthCode`, `DeviceCode`, `AccessToken`, `RefreshToken` each define `static prunable()` (same predicates as `passport:purge`) + `pruneMode = 'mass'`, so `pnpm rudder model:prune` reaps expired/revoked rows automatically without the operator needing to invoke `passport:purge`. `PassportProvider.boot()` eagerly registers the four classes with `ModelRegistry` so the prune walker sees them on day-1 fresh apps before any oauth flow has fired.
- **`revoked` is NOT mass-assignable** — `AccessToken`, `RefreshToken`, and `AuthCode` keep `revoked` out of `fillable`. Lifecycle flips happen through `instance.revoke()` (token models) or `QueryBuilder.where(...).updateAll({ revoked: true })` (grants); both bypass the mass-assignment filter. Defense-in-depth so a future caller-controlled `Model.create()` payload can't pre-mark a row as revoked.
- **`AccessToken.userId` and `clientId` are `@Hidden`** — `toJSON()` strips them by default so `user.tokens()` exposed over an API can't accidentally leak the user/client mapping. Privileged routes (admin views) opt in via `instance.makeVisible(['userId', 'clientId'])`.
- **`OAuthClient` JSON columns hydrate as arrays** — `redirectUris`, `grantTypes`, `scopes` carry `@Cast('json')`. Read paths (and `getRedirectUris()`/`getGrantTypes()`/`getScopes()` accessors) return `string[]`. Existing `JSON.stringify([...])` callsites continue to work — `castSet('json')` returns string inputs verbatim.
- **Confidential client secret presence is asserted at the token endpoint** — every grant that authenticates via `verifyClientSecret` first checks `client.secret == null` and throws `invalid_client` ("Confidential client has no secret on file"). Catches a future refactor that could otherwise mask `secret = null` as authenticating against an empty string.

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
- **Rotating the configured issuer URL invalidates every live token (when issuer is set).** Once `Passport.useIssuer(url)` is configured, every new JWT carries that exact URL in `iss`. Changing the URL means existing tokens fail issuer validation on the next request. Plan rotations as a forced sign-out window — same blast radius as rotating the RSA keypair. Tokens minted before issuer was first configured (no `iss` claim) are NOT affected by rotation; they pass verification under the migration window.
- **Rotating `APP_KEY` invalidates every peppered client secret.** When `APP_KEY` is set, `passport:client` stores client secrets as `peppered:<HMAC-SHA256(secret, APP_KEY)>`. Replace `APP_KEY` and the HMAC no longer reproduces — every confidential client fails token-endpoint authentication until you re-issue secrets via `passport:client`. Plan `APP_KEY` rotations as a coordinated re-issuance window with third-party integrations. Legacy plain-SHA-256 rows (minted before `APP_KEY` was set) are unaffected by rotation.
- **Mount a rate limiter on `POST /oauth/token`.** The token endpoint is the canonical brute-force target for client_secret guessing — there's no built-in throttle, so without one a global per-IP limit is the only thing standing between an attacker and the entire client registry. Pass a limiter via `registerPassportRoutes(router, { tokenMiddleware: [...] })`; the recommended config is `RateLimit.perMinute(10).by((req) => \`${req.ip}:${req.body?.client_id}\`)` from `@rudderjs/middleware`. The composite key (ip + client_id) prevents one noisy client from exhausting the budget for legitimate co-tenants behind a shared NAT, AND prevents a single IP from churning through every client_id in the registry. RateLimit needs `@rudderjs/cache` registered — without a cache provider the middleware silently passes through.
- **Device endpoints rely on your api-group rate limit by default.** RFC 8628 §5.2 wants brute-force protection on user_code; with a 32^8 ≈ 1.1×10^12 keyspace, a per-IP limit of 60/min on the api group already makes exhaustion infeasible (~35,000 years per attacking IP). For tighter device-specific limits, pass a limiter via `registerPassportRoutes(router, { deviceMiddleware: [...] })`. Recommended: `RateLimit.perMinute(5).by((req) => req.ip)` — strict enough to slow misuse without breaking the legitimate "device prompts user, user types code" flow. The "lock individual user_codes after N misses" half of RFC 8628's guidance isn't covered by `RateLimit` (it's per-IP, not per-userCode); wrap your own middleware if you need it.
- **Migrating to hashed device codes invalidates every in-flight session.** The `oauth_device_codes` schema renames `userCode`/`deviceCode` to `userCodeHash`/`deviceCodeHash`. The plaintext is unrecoverable, so any device that requested a code before `prisma migrate deploy` ran will get `invalid_grant` on its next poll and has to re-issue. The 15-minute TTL on device codes is the natural drain window — plan rollouts so this isn't user-visible (e.g. deploy during a low-traffic window, or expect a brief spike of code re-issues). One-time migration; not a recurring concern.
