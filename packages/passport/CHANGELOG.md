# @rudderjs/passport

## 1.1.1

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.
- Updated dependencies [f867181]
- Updated dependencies [0f69018]
- Updated dependencies [4d4991c]
  - @rudderjs/contracts@1.4.0
  - @rudderjs/core@1.1.3
  - @rudderjs/orm@1.8.1

## 1.1.0

### Minor Changes

- b4b37d3: Split Passport routes between web and api groups + opt-in CSRF — closes finding E7 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  `POST /oauth/authorize` is a state-changing endpoint reached from a logged-in browser session — the canonical CSRF target. The previous default (`registerPassportRoutes` on a single router) had no clean home for the consent flow when the app maintains separate web + api routers, and the playground mounted everything on the api group, where session/AuthMiddleware don't run, so the consent flow couldn't even resolve `req.user`.

  **Two new exports** carve out the right pairing:

  - `registerPassportWebRoutes(router, opts)` — mounts the consent flow (`GET/POST/DELETE /oauth/authorize`) and the revoke endpoint (`DELETE /oauth/tokens/:id`). Goes in `routes/web.ts`.
  - `registerPassportApiRoutes(router, opts)` — mounts `POST /oauth/token`, `POST /oauth/device/code`, `POST /oauth/device/approve`, and `GET /oauth/scopes`. Goes in `routes/api.ts`.

  Both are thin wrappers around `registerPassportRoutes(...)` with the appropriate `except` set, so they share every other option (`prefix`, `verificationUri`, `tokenMiddleware`, etc.). The original `registerPassportRoutes` keeps its everything-on-one-router behavior for back-compat.

  **`PassportRouteOptions.authorizeMiddleware`** — new opt-in slot for middleware to mount on the consent endpoints (parallel to the existing `tokenMiddleware`). Most apps should NOT use this option; the recommended pattern is to mount CSRF on the entire web group in `bootstrap/app.ts`:

  ```ts
  .withMiddleware((m) => m.web(CsrfMiddleware()))
  ```

  which automatically covers `/oauth/authorize` along with every other state-changing web route. `authorizeMiddleware` is the per-route fallback for apps that don't have group-level CSRF:

  ```ts
  import { CsrfMiddleware } from "@rudderjs/middleware";
  import { registerPassportWebRoutes } from "@rudderjs/passport";

  registerPassportWebRoutes(router, {
    authorizeMiddleware: [CsrfMiddleware()],
  });
  ```

  Don't do both — CsrfMiddleware running twice emits duplicate `Set-Cookie`s on GETs and runs validation twice on POSTs.

  Playground updated end-to-end: `routes/web.ts` mounts `registerPassportWebRoutes` (CSRF already covered by `m.web(CsrfMiddleware(...))` in `bootstrap/app.ts`); `routes/api.ts` switches to `registerPassportApiRoutes` and includes the recommended `tokenMiddleware` rate limiter.

  CLAUDE.md Architecture Rules + the file index updated to reflect the split and the don't-double-mount-CSRF guidance.

- 6b1485a: Configurable cap on device-flow `slow_down` interval escalation.

  The 60-second cap on `oauth_device_codes.interval` (added in #282) was hardcoded. RFC 8628 §3.5 doesn't specify a cap, so the value was a judgement call — fine for human-in-the-loop flows but constraining for niche cases (machine-only daemons, integration tests that want shorter ceilings, or apps that want to back misbehaving clients off more aggressively).

  The cap is now operator-tunable:

  ```ts
  // programmatic
  import { Passport } from "@rudderjs/passport";
  Passport.deviceMaxInterval(120); // bump to 2 minutes

  // via PassportConfig in config/passport.ts
  export default {
    // ...
    deviceMaxInterval: 120,
  } satisfies PassportConfig;
  ```

  **Default unchanged at 60 seconds.** Values below 5 are clamped to the 5s floor — the initial polling interval — because the escalation step is 5s and a cap below that would prevent any escalation from taking effect. Fractional values are floored.

  **New API:**

  - `Passport.deviceMaxInterval(seconds: number)` — setter, with floor + flooring as above.
  - `Passport.deviceMaxIntervalSeconds()` — getter.
  - `PassportConfig.deviceMaxInterval` — config-layer plumbing in `bootstrap/providers.ts` flow.

  `pollDeviceCode` now reads `Passport.deviceMaxIntervalSeconds()` instead of a module-level constant. The existing P9 regression test ("escalation caps at 60s") still passes — the default behavior is unchanged.

  **Tests:** eight new regression tests under "Passport.deviceMaxInterval — configurable cap on slow_down escalation" covering: default, setter override, floor clamp, fractional floor, reset semantics, escalation past 60s with raised cap, escalation halting at lowered cap, and the boot-integration setter/getter round-trip.

  CLAUDE.md "Device codes rate-limited" Architecture Rule updated to mention the configurability.

- 5d61ab5: Hash device codes at rest + escalate `slow_down` polling interval — closes findings P9 and M4 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`. Bundled because both touch the same `oauth_device_codes` table; one Prisma migration covers both.

  **M4 — at-rest hashing of `deviceCode` and `userCode`** (RFC 8628 §6.1).

  `oauth_device_codes` columns renamed: `userCode` → `userCodeHash`, `deviceCode` → `deviceCodeHash`. The plaintext is generated and returned once in the `/oauth/device/code` response body; only SHA-256 hashes are persisted. `pollDeviceCode` and `approveDeviceCode` hash their plaintext input before lookup, so a DB read leak no longer yields usable codes that an attacker could replay.

  New helper exported from `@rudderjs/passport`: `hashDeviceSecret(plaintext)`. Plain SHA-256 (no pepper) is sufficient because device codes are already unguessable per request — the threat is DB read leak, not pre-image attack on a chosen plaintext. See `device-code-secret.ts` for the longer-form rationale.

  Public API of `pollDeviceCode({ deviceCode })` and `approveDeviceCode(userCode, ...)` is unchanged — both still take **plaintext**, hash internally, and look up by hash. RFC 8628 wire format (`device_code` / `user_code` parameters) is unchanged.

  **P9 — `slow_down` polling interval escalates per RFC 8628 §3.5.**

  New `interval Int @default(5)` column on `oauth_device_codes` tracks the per-row polling interval. On each `slow_down` response, the server increments by 5 seconds (capped at 60). The new interval is forwarded in the `slow_down` error body so well-behaved clients can adopt it directly:

  ```json
  { "error": "slow_down", "interval": 10 }
  ```

  The `DevicePollResult` type's `slow_down` variant gains an `interval: number` field — additive on the discriminated union, so existing switch-discriminated callers stay shape-compatible.

  **Migration impact**

  The column rename is **destructive for in-flight device-code sessions** — the original plaintext is gone, and SHA-256 is one-way, so existing rows can't be migrated. The 15-minute TTL on device codes is the natural drain window: any device that requested a code before `prisma migrate deploy` runs sees `invalid_grant` on its next poll and re-issues a fresh code. Plan rollouts for a low-traffic window. One-time migration; not a recurring concern.

  CLAUDE.md Architecture Rules + Pitfalls updated. Findings doc covers the bundled migration in the "Recommended PR strategy" section.

- 4ccb117: `deviceMiddleware` option on `registerPassportRoutes()` — closes finding P8 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  RFC 8628 §5.2 calls for brute-force protection on the user_code surface. With a 32^8 ≈ 1.1×10^12 keyspace, the typical api-group rate limit (`m.api(RateLimit.perMinute(60))` in `bootstrap/app.ts`) already makes exhaustion infeasible — ~35,000 years of constant attack per IP — so most apps are already covered.

  For apps that want a tighter device-specific limit, Passport now surfaces `PassportRouteOptions.deviceMiddleware`, an opt-in slot for any middleware to mount on `POST /oauth/device/code` and `POST /oauth/device/approve` ahead of the handler. Pass a single handler or an array; the most common use is a tighter rate limiter:

  ```ts
  import { RateLimit } from "@rudderjs/middleware";
  import { registerPassportApiRoutes } from "@rudderjs/passport";

  registerPassportApiRoutes(router, {
    deviceMiddleware: [RateLimit.perMinute(5).by((req) => req.ip)],
  });
  ```

  Layered limits compose in sequence — group + per-route both run, with the tightest budget winning. The "lock individual user_codes after N misses" half of RFC 8628 §5.2's guidance isn't covered here (it's per-userCode state, not per-IP throttling); apps that need it can wrap their own middleware.

  `deviceMiddleware` is scoped to the device endpoints only; `/oauth/token`, `/oauth/authorize`, `/oauth/tokens/:id`, and `/oauth/scopes` are unaffected. Omitting the option is fully back-compat — the default registration is unchanged.

  CLAUDE.md "Pitfalls" updated with the recommended config.

- c2363b7: JWKS-style previous-key verifier — `passport:keys --force` no longer forces a global sign-out.

  **The problem (until now):** rotating the RSA keypair via `rudder passport:keys --force` invalidated every live access token instantly. Every JWT signed by the old private key failed signature verification under the new public key on the next request. Documented as a "forced sign-out window" pitfall — accepted, but never great.

  **The fix:** every new JWT carries a `kid` header equal to the SHA-256 fingerprint (base64url) of the public key that signed it (RFC 7515 §4.1.4). `verifyToken()` now walks `Passport.verificationKeys()` — a list `[currentPublicKey, ...optional previousPublicKeys]` — and accepts a match against any retained key. After a `passport:keys --force` rotation:

  - The new private key signs all new JWTs.
  - The previous public key is automatically retained at `storage/oauth-previous-public.key` (alongside the existing timestamped audit backups in `*.bak.<ISO-timestamp>`).
  - The verifier loads it on first use and keeps verifying tokens minted before the rotation, until they expire naturally (default 15 days for access tokens).
  - Operators drop the grace window by deleting `oauth-previous-public.key` or calling `Passport.setPreviousPublicKey(null)` — useful once the post-rotation tokens have all expired.

  **Legacy compat:** JWTs minted before this PR carry no `kid` header. The verifier falls through to "try each verification key in order" — same compat pattern as `iss` (P7) and the at-rest hashing migrations.

  **Single previous-slot by design.** One rotation deep. Operators who need a longer history should stage rotations to land outside the configured access-token lifetime — at that point the old tokens have already expired and a longer key history buys nothing.

  **New API surface:**

  - `Passport.setPreviousPublicKey(pem | null)` — operator-side override (e.g. for env-var-only deployments).
  - `Passport.previousPublicKey()` — getter.
  - `Passport.verificationKeys()` — async, returns `string[]` (current first).
  - `JwtHeader.kid` — typed in the public type.
  - `generateKeys()` returns a new `previousPublicPath: string | null` field on `GenerateKeysResult`. CLI prints it on rotation.

  **Tests:** 8 new regression tests under "JWKS-style previous-key verifier" — kid stamping, post-rotation success path, previous-slot cleared rejects, legacy no-kid trial-verify path, kid-but-key-gone rejection, reset semantics, and the verificationKeys ordering invariant.

  CLAUDE.md updated: the existing "Rotating the RSA keypair invalidates every live token" pitfall is now "carries a JWKS-style grace window" with the new operational instructions; Architecture Rules → Keys section mentions the `oauth-previous-public.key` convention.

- b839b89: Hash refresh tokens + auth codes at rest — closes findings M5 + P6 (second half) from `docs/plans/2026-05-06-passport-surface-review-fixes.md`. Last remaining schema-migration item from the passport-surface review.

  **The bug:** pre-migration, the plaintext bearer credential returned to the client WAS the row's cuid `id` on `oauth_refresh_tokens` and `oauth_auth_codes`. A DB read leak (`SELECT * FROM oauth_refresh_tokens` / `oauth_auth_codes`) handed every active refresh token and every in-flight auth code to the attacker as usable credentials.

  **The fix:** new `tokenHash String @unique` column on both tables. The plaintext returned to the client is now freshly generated `randomBytes(48).toString('base64url')` (384 bits CSPRNG, 64 chars URL-safe), decoupled from the row's `id`. Lookups hash the inbound plaintext before querying:

  ```ts
  // refreshTokenGrant
  const refreshTokenHash = await hashOpaqueToken(params.refreshToken);
  const refreshToken = await RefreshTokenCls.where(
    "tokenHash",
    refreshTokenHash
  ).first();

  // exchangeAuthCode
  const codeHash = await hashOpaqueToken(params.code);
  const authCode = await AuthCodeCls.where("tokenHash", codeHash).first();
  ```

  The atomic-consume update path (M3) and the family-revocation walk (P4) both key on the row's `id` once hydrated and are unaffected. The `accessTokenId` linkage is unchanged.

  Same plain-SHA-256 reasoning as `device-code-secret.ts`: the plaintext is high-entropy CSPRNG, so peppered HMAC buys nothing — the threat being mitigated is DB read leak.

  **Public exports:** `hashOpaqueToken`, `newOpaqueToken` from the package main entry. Mirrors `hashClientSecret` / `hashDeviceSecret`.

  **Prisma migration:**

  ```prisma
  model OAuthRefreshToken {
    // ...
    tokenHash     String   @unique
    // ...
  }

  model OAuthAuthCode {
    // ...
    tokenHash     String   @unique
    // ...
  }
  ```

  Both columns are `@unique` and indexed. Collision probability on SHA-256 of `randomBytes(48)` is negligible at any realistic scale.

  **Migration semantics — pre-existing credentials stop working at deploy time:**

  - **Refresh tokens** — affected sessions force-relogin on next refresh. Same blast radius as rotating the RSA keypair (a documented operator event). Plan as a coordinated sign-out window.
  - **Auth codes** — 10-minute TTL naturally drains. Affected redirect-back exchanges return `invalid_grant`; the user re-clicks "Authorize".

  This is a one-time migration. Once shipped, the contract is durable — token rotation is a normal operation, not a credential-invalidating event.

  **Tests:** six regression tests in `index.test.ts` (`oauth_refresh_tokens + oauth_auth_codes hashing (M5 + P6)`) covering: persisted hash vs. returned plaintext, lookup-by-hash on refresh, lookup-by-hash on exchange, presented-row-id-fails (the pre-fix bug), and atomic-consume regression on the new hashed lookup. Existing P4 reuse-chain tests updated to stamp `tokenHash` on test rows.

  CLAUDE.md "Architecture Rules" + "Pitfalls" expanded.

- 1f63c56: Added `scopeAny(...scopes)` middleware — OR-semantic counterpart to the
  existing `scope(...)` (AND). Use it when a route should accept any of a set
  of scopes rather than requiring every one. Closes the Laravel parity gap
  between `scope` and `scopes` middleware variants. Wildcard `*` still grants
  everything; calling `scopeAny()` with no scopes is a no-op safety net rather
  than an instant 403.
- d2458ad: `tokenMiddleware` option on `registerPassportRoutes()` — closes finding E8 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  `POST /oauth/token` is the canonical brute-force target for client_secret guessing — without a per-route rate limit, only the app's global limiter (if any) stands between an attacker and the entire client registry. Passport now surfaces `PassportRouteOptions.tokenMiddleware`, an opt-in slot for any middleware to mount on `/oauth/token` ahead of the handler. Pass a single handler or an array; the most common use is a rate limiter:

  ```ts
  import { RateLimit } from "@rudderjs/middleware";
  import { registerPassportRoutes } from "@rudderjs/passport";

  registerPassportRoutes(router, {
    tokenMiddleware: [
      RateLimit.perMinute(10).by((req) => `${req.ip}:${req.body?.client_id}`),
    ],
  });
  ```

  The composite key `${ip}:${client_id}` prevents one noisy client from exhausting the budget for legitimate co-tenants behind a shared NAT, AND prevents a single IP from churning through every client_id in the registry. `RateLimit` requires `@rudderjs/cache` to be registered — without a cache provider the middleware silently passes through.

  `tokenMiddleware` is scoped to the token endpoint only; other passport endpoints (`/oauth/authorize`, `/oauth/device/code`, `/oauth/device/approve`, `/oauth/tokens/:id`) are unaffected. Omitting the option is fully back-compat — the default registration is unchanged.

  CLAUDE.md "Pitfalls" updated with the recommended config.

- 4e006d9: `verifyToken` aud/iss validation + opt-in JWT issuer — closes finding P7 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  `verifyToken()` previously checked only the signature and expiration. RFC 8725 §3.10 / §3.12 recommend validating `aud` and `iss` whenever the deployment has more than one possible signer or audience — the latent risk this PR closes is cross-client token confusion or token replay across staging+prod sharing the same keypair. (BearerMiddleware's lookup-by-jti gives some protection in practice; this PR makes the protection explicit and forward-compatible.)

  **Two new knobs:**

  1. `Passport.useIssuer(url)` — opt-in. When set, `createToken()` stamps the URL as the `iss` claim on every new access token, and `BearerMiddleware`/`RequireBearer` ask `verifyToken()` to reject tokens whose `iss` doesn't match. Tokens minted before the issuer was configured carry no `iss` claim and stay verifiable during the migration window — same compat pattern as `redirect_uri` (P1) and `familyId` (P4). Single-issuer deployments don't need this.
  2. `verifyToken(jwt, options)` — `options.expectedAud` rejects audience mismatches; `options.expectedIssuer` rejects issuer mismatches (when the token carries an `iss` claim). Resource servers that gate to a specific client should pass `expectedAud`; `BearerMiddleware` doesn't pass it itself because it doesn't know the expected client until after the DB lookup.

  Wire-through: `PassportConfig` adds `issuer?: string`; `PassportProvider.boot()` calls `Passport.useIssuer()` when set. Reset() clears it. Empty string clears.

  ```ts
  // config/passport.ts
  export default {
    issuer: "https://app.example.com",
    // ...
  } satisfies PassportConfig;
  ```

  Rotation note added to CLAUDE.md Pitfalls: rotating the configured issuer URL invalidates every live token, same blast radius as rotating the RSA keypair. Plan as a forced sign-out window. Tokens minted before issuer was first configured (no `iss` claim) are NOT affected by rotation.

  New `VerifyTokenOptions` type exported alongside the existing `JwtPayload` / `JwtHeader`.

### Patch Changes

- 275c05d: Atomic single-use consumption of authorization codes (RFC 6749 §4.1.2).

  `exchangeAuthCode()` previously read the auth code, ran every check (PKCE, redirect_uri binding, client validation, expiry), and then issued an unconditional `update(id, { revoked: true })`. Two concurrent token-exchange requests with the same code each saw `revoked=false` on read, both passed every check, and both minted token pairs — violating the spec's single-use requirement.

  The revoke step is now a conditional update — `where('id', id).where('revoked', false).updateAll({ revoked: true })`. The underlying SQL `UPDATE ... WHERE revoked = false` is atomic in every supported backend, so exactly one concurrent caller sees `count === 1`; the loser sees `count === 0` and throws `invalid_grant` ("Authorization code has already been used.") before reaching `issueTokens()`.

  (Subsequent serial reuse of an already-consumed code keeps surfacing at the existing early-exit `if (authCode.revoked)` check — unchanged.)

  Closes finding M3 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- 435a9ef: Support HTTP Basic client authentication at `/oauth/token` (RFC 6749 §2.3.1).

  The token endpoint now accepts client credentials via `Authorization: Basic base64(client_id:client_secret)` in addition to the existing body-param flow. Most off-the-shelf OAuth SDKs (Auth0, Okta, oauth2-proxy, etc.) default to Basic, so apps were forced to fork SDK config to opt into body-param mode. Per RFC §2.3.1 servers MUST support Basic; this fix closes the spec gap.

  **Conformance details (RFC 6749 §2.3):**

  - Basic prefix is matched case-insensitively (RFC 7235 §2.1).
  - Sending credentials in BOTH the header AND body is rejected with `invalid_request` — the spec forbids it. Both `client_secret` collision and a `client_id` mismatch are detected.
  - Malformed Basic (no colon, undecodable base64) returns `invalid_request`.
  - Missing `client_id` (no header, no body) now returns `invalid_request` 400 instead of producing the misleading "Client not found" via the database lookup.
  - The `client_credentials` grant now surfaces missing `client_secret` as `invalid_request` 401 (the grant is confidential-only by spec).

  Closes finding E9 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- 6635e6e: `PassportProvider.boot()` now emits a clear startup warning when no RSA
  keypair is reachable — neither `PASSPORT_PRIVATE_KEY` / `PASSPORT_PUBLIC_KEY`
  env vars nor a keypair on disk under the configured key path. Previously
  the missing-keys footgun surfaced only on the first `/oauth/*` request as a
  generic ENOENT from deep inside `Passport.keys()`, which made the missing
  bootstrap step (`rudder passport:keys`) hard to trace. Also exposes
  `Passport.keysAvailable(): Promise<boolean>` for runtime probes.
- 03f4b5e: `purgeTokens` (and the `passport:purge` command) now issues a single bulk
  `deleteAll()` per model instead of reading every match into memory and looping
  per-row deletes. One round-trip per model, no hydration, no N+1.
- 99c5a7d: Docs: explain why access tokens are JWT-only with no DB hash column (matches
  Laravel Passport; signature is the secrecy boundary, not a stored hash) and
  add CLAUDE.md "Pitfalls" entries for the two surfaces reviewers most often
  miss — RSA keypair rotation invalidating every live JWT, and the device-flow
  verification URI defaulting to request `Host`/`X-Forwarded-Host` when
  `verificationUri` isn't configured.
- 1f002ea: `passport:client` CLI flag fixes — closes finding L2 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  **`--personal` is now a hint, not a client.** The previous behavior created an OAuth client with `grantTypes: ['personal_access']`, but `personal_access` is not an HTTP grant — `/oauth/token` rejects it, and personal access tokens go through `HasApiTokens.createToken()` against an internal `__personal_access__` client that the framework auto-manages. The CLI row was an orphan, present in the DB but unreachable through any flow. `passport:client --personal` now prints a short hint pointing at `HasApiTokens.createToken()` and exits without writing to the database. Pure CLI ergonomics — no migration needed.

  **`--device` clients now also carry `refresh_token`.** Device clients used to ship with only `urn:ietf:params:oauth:grant-type:device_code` in their grants array. Once the device flow exchanged a user_code for a token pair, the bundled refresh token was unusable: `/oauth/token` rejects refresh requests for clients whose grantTypes don't list `refresh_token`. RFC 8628 doesn't mandate a fixed list; pairing `refresh_token` with the device flow is the expected default for any device client that wants long-lived sessions on the polled device. New `--device` invocations get both grants.

  The grant-type → flag mapping is extracted to a new exported helper, `resolveClientGrantTypes({ isDevice, isM2M })`, so the CLI handler stays a thin wrapper and the mapping is unit-testable without booting the full provider.

- b0ccd35: Hash OAuth client secrets with an `APP_KEY`-derived HMAC pepper when set.

  `passport:client` (and `createClient()`) now stores confidential client
  secrets as `peppered:<HMAC-SHA256(secret, APP_KEY)>` when `APP_KEY` is
  configured, falling back to plain SHA-256 when it isn't. The `peppered:`
  prefix makes the format self-describing per row, so existing plain-SHA-256
  secrets keep verifying after the operator sets `APP_KEY` — no migration step.

  A leaked DB dump alone can no longer be brute-forced offline against
  candidate secrets without `APP_KEY`. New helpers `hashClientSecret()` and
  `verifyClientSecret()` are exported for apps that issue or verify client
  secrets outside the standard CLI/grant paths.

  Note: rotating `APP_KEY` invalidates every peppered client secret. Plan
  rotations as a coordinated re-issuance window — see
  `packages/passport/CLAUDE.md` "Pitfalls" for the full caveat.

- 5ac1136: Endpoint hardening — three RFC conformance fixes from the passport-surface review.

  **E5 — Bearer scheme is case-insensitive** (RFC 6750 §2.1 / RFC 7235 §2.1). `BearerMiddleware()` and `RequireBearer()` no longer reject `bearer xyz` or `BEARER xyz` — the prefix is matched against `authHeader.slice(0, 7).toLowerCase()`.

  **E10 — `invalid_client` returns HTTP 401 with `WWW-Authenticate`** (RFC 6749 §5.2). The auth-code grant was the inconsistent outlier — refresh-token and client-credentials already returned 401. All three `invalid_client` throws in `exchangeAuthCode()` now pass `401`, and the `/oauth/token` route appends `WWW-Authenticate: Basic realm="oauth"` whenever it surfaces a 401 OAuthError.

  **E11 — device-flow `slow_down` returns HTTP 400, not 429** (RFC 8628 §3.5). `slow_down` is a §5.2-shaped error and the spec doesn't authorise 429; the previous special case is removed.

  No schema, no API surface change. Closes findings E5, E10, E11 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- d585476: Two security hardenings on the OAuth2 grant surface:

  - **PKCE: reject `code_challenge_method=plain` for public clients** (RFC 7636 §4.4.1 + OAuth 2.0 BCP). With `plain`, verifier == challenge, so a stolen authorization code is enough to mint tokens — defeating PKCE entirely. Confidential clients keep the `plain` option for backward compat. Closes finding P3 from the passport-surface review.
  - **Constant-time comparison on all 4 hashed-credential / verifier sites** (3 client-secret compares + 1 PKCE verifier compare). New `safeCompare()` helper uses `crypto.timingSafeEqual` after a length pre-check, replacing `!==` which short-circuits on first mismatch. Closes finding P5.

- 431eb0f: Mechanical cleanup bundle — closes findings L7, L8, P12, and E12 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  **L7 — drop `(x as any).id` casts.** `OAuthClient`, `AccessToken`, `RefreshToken`, `AuthCode`, and `DeviceCode` now `declare id: string`. Every call site that reached `.id` through an `(x as any).id as string` cast now hits the typed property directly (`token.id`, `client.id`, `authCode.id`, etc.) — same bytecode at runtime, the casts were purely a TypeScript ergonomics artifact. The seeder stub emitted by `make:passport-client` has been updated to match.

  **L8 — device-flow verification URI prefers `config('app.url')`.** `requestDeviceCode`'s default verification URI no longer derives from `${req.protocol}://${req.hostname}` first. Resolution order is now: `opts.verificationUri` → `config('app.url') + prefix + '/device'` → host-header fallback (kept for dev convenience). The fallback emits a one-shot warning so production deployments behind a reverse proxy without trust-proxy notice the host-header dependency. Most apps already export `app.url` in `config/app.ts` and won't see the warning.

  **P12 — single `Date.now()` snapshot in `issueTokens`.** `iat`, `exp`, `expires_in`, and the refresh token's `expiresAt` are all derived from one `const now = Date.now()` at the top of issuance. `createToken` accepts an optional `iatMs` so the caller's snapshot reaches the JWT payload — a downstream verifier no longer sees `iat + expires_in !== exp` from sub-second drift between independent `Date.now()` reads across the intervening async DB write + key load.

  **E12 — `state` echoed on auth-endpoint errors + `report()` for `server_error`.** `GET/POST/DELETE /oauth/authorize` now echo `state` back on every error path (RFC 6749 §4.1.2.1). Non-`OAuthError` throws across the OAuth handlers (`/authorize`, `/token`, `/device/code`, `/device/approve`) call `report()` so the root cause surfaces through the configured exception reporter instead of being silently collapsed under `server_error`.

- 8181057: Stop swallowing provider-boot errors under a misleading "rudder not available" catch.

  `PassportProvider.boot()` previously wrapped CLI command registration AND the `make:passport-client` scaffolder block in two nested catch-all `try/catch`es with the comment "rudder not available". `@rudderjs/core` is a hard dep of `@rudderjs/passport`, and `@rudderjs/console` is a hard dep of `@rudderjs/core`, so the dynamic imports always resolve — the catches couldn't possibly fire for the documented reason. What they DID swallow was every legitimate error from `rudder.command(...)` and `registerMakeSpecs(...)`: HMR-induced duplicate-registration bugs, future stub-validation errors, anything thrown inside an `await import('./commands/X.js')` lookup. All silently turned into a no-op boot.

  Both wrappers are gone. Errors now surface with their original stack instead of being lost. Closes finding L5 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- 27dcb37: Personal-access surface cleanup — closes findings P10 and P11 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  **P10 — `user.tokens()` and `user.revokeAllTokens()` now scope to the personal-access client.** Previous behavior filtered only by `userId`, so a UI listing personal access tokens (or a "log out all my dev tokens" button) included OAuth-app session tokens issued by third-party clients on the user's behalf. Both methods now add a `clientId === personalAccessClient.id` predicate via the existing `getPersonalAccessClientId()` helper. JSDoc rewritten to describe the scoping explicitly.

  **P11 — `decodeToken` renamed to `unsafeDecodeToken`; old name kept as a deprecated alias.** The function decodes a JWT payload **without verifying the signature** — its output cannot be trusted for authentication decisions. The `unsafe` prefix forces a security pause when callers reach for it; the original `decodeToken` export remains as an alias (`export const decodeToken = unsafeDecodeToken`) so existing imports keep working. Boost guidelines updated to recommend the new name and document the constraint.

- 6349788: Token models are now `MassPrunable` — `pnpm rudder model:prune` reaps
  expired/revoked rows automatically.

  `AuthCode`, `DeviceCode`, `AccessToken`, and `RefreshToken` each define
  `static prunable()` and `static pruneMode = 'mass'`. The predicates mirror
  `passport:purge` exactly (`expiresAt < now OR revoked = true` for tokens,
  `expiresAt < now` for codes), so the two commands target the same rows and
  running them back-to-back is idempotent.

  `PassportProvider.boot()` eagerly registers the four classes with
  `ModelRegistry`, so the prune scheduler sees them on day-1 fresh apps —
  without this, the registry would only learn about the models lazily on
  the first oauth flow, silently skipping passport rows on a `model:prune`
  run from an inactive install.

- 23c217f: Bind `redirect_uri` to authorization codes and re-validate it on the consent endpoints (RFC 6749 §3.1.2.4 + §4.1.3). Closes findings P1, E3, and E4 from the passport-surface review.

  **What changed**

  - `OAuthAuthCode` gains a nullable `redirectUri` column. `issueAuthCode()` now persists the URI used at authorization, and `exchangeAuthCode()` requires the value submitted at the token endpoint to match exactly. Without this binding, an auth code obtained via one whitelisted redirect could be exchanged via any other registered redirect on the same client, breaking the OAuth threat model.
  - `POST /oauth/authorize` (consent approve) and `DELETE /oauth/authorize` (consent deny) now look up the client and re-validate `redirect_uri` against the client's whitelist before emitting the redirect URL. Previously both handlers blindly trusted the request body; the deny handler also fell back to a hard-coded `http://localhost` default, which is now removed in favour of an explicit `invalid_request` rejection.
  - New `redirectUri` field on `AuthCode` model + `AuthCodeRecord` helper interface.

  **Migration**

  Run a Prisma migration to add the new column to `oauth_auth_codes`:

  ```sql
  ALTER TABLE oauth_auth_codes ADD COLUMN redirectUri TEXT;
  ```

  Existing in-flight auth codes (≤10-minute lifetime) keep `redirectUri = null` and are exempt from the comparison so they remain exchangeable until they expire. All codes minted post-migration carry the binding.

- ac05bff: Detect refresh-token reuse and revoke the entire rotation family on detection (RFC 6819 §5.2.2.3 / OAuth 2.0 Security BCP §4.14). Closes finding P4 / M(H4) from the passport-surface review.

  **What changed**

  - `OAuthRefreshToken` gains a nullable `familyId` column (indexed). `issueTokens()` stamps a freshly generated UUID when no family is passed in, and `refreshTokenGrant()` propagates the existing id onto the rotated pair so a session's full chain shares one identifier.
  - When a previously-rotated refresh token is presented again, the grant now walks `WHERE familyId = X` and revokes every access + refresh token in that family before throwing `invalid_grant`. Previously the attacker who stole a refresh token before legitimate rotation could keep rotating forever while the victim was silently logged out.
  - New `familyId` field on `RefreshToken` model + `RefreshTokenRecord` helper interface; `issueTokens()` now accepts an optional `familyId` to support the rotation pass-through.

  **Migration**

  Run a Prisma migration to add the new column + index to `oauth_refresh_tokens`:

  ```sql
  ALTER TABLE oauth_refresh_tokens ADD COLUMN familyId TEXT;
  CREATE INDEX oauth_refresh_tokens_familyId_idx ON oauth_refresh_tokens(familyId);
  ```

  Existing refresh tokens (≤2-week lifetime by default) keep `familyId = null` and are exempt from the cascade so a legacy reuse still throws `invalid_grant` but does not affect unrelated rows. All tokens minted post-migration carry a family.

- 6df0968: Require bearer auth + ownership on `DELETE /oauth/tokens/:id`. Previously the revoke endpoint had no auth check at all, so any unauthenticated request could revoke any token by id — and token ids appear in JWT `jti` claims (semi-public), so anyone with a single captured JWT could DoS arbitrary users by revoking their tokens. Now: requires `RequireBearer()`, then checks `token.userId === requester.id`. Returns 404 (not 403) on ownership mismatch to avoid leaking whether a given id exists.
- 3672e21: Validate requested OAuth scopes against the global registry and per-client allow-list (RFC 6749 §3.3).

  Previously, `validateAuthorizationRequest`, `clientCredentialsGrant`, and `requestDeviceCode` accepted arbitrary scope strings — including scopes the operator never declared and scopes outside a client's configured allow-list. Tokens were minted with whatever the user approved, so `scope('admin')` middleware checks could be bypassed by a client requesting an undeclared `admin` scope.

  The three grants now run a shared `validateScopes(client, requested)` gate that throws `OAuthError('invalid_scope', ...)` when a requested scope is not registered globally via `Passport.tokensCan({...})` or is outside the client's `scopes` allow-list. Each gate is only enforced when populated:

  - Empty global registry → no global gate (back-compat with apps that haven't called `tokensCan`).
  - Empty `client.scopes` → no per-client gate (the common case — most clients are unrestricted).
  - The `*` wildcard always passes, matching `Passport.validScopes()` semantics.

  The refresh-token grant already has its own narrowing logic (request scopes can only be a subset of the original token's) and is unchanged.

  `validateScopes` is exported for apps that build their own grant pipeline.

  Closes finding E6 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

- 80888d2: Storage hygiene sweep — defense-in-depth on passport models.

  Closes M1, M6, M-L1, M-L2, M-L4, M-L5, M-L6 in
  `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

  - **`revoked` removed from `fillable`** on `AccessToken`, `RefreshToken`, and
    `AuthCode`. Lifecycle flips happen through `instance.revoke()` (token
    models) or `QueryBuilder.where(...).updateAll({ revoked: true })` (grants);
    both bypass the mass-assignment filter. Defense-in-depth — a future
    caller-controlled `Model.create()` payload can no longer pre-mark a row as
    revoked.
  - **`revoke()` instance methods** on `AccessToken` and `RefreshToken` now
    `this.revoked = true; await this.save()` instead of the prior
    `(this as any).id`/static-update pattern.
  - **`AccessToken.userId` and `clientId` are `@Hidden`** so `toJSON()` strips
    them by default. Routes that surface `user.tokens()` no longer leak
    ownership mappings; admin views opt in via
    `instance.makeVisible(['userId', 'clientId'])`. `tokens()` JSDoc now
    documents the per-user scoping requirement.
  - **`OAuthClient` JSON columns** carry `@Cast('json')`. `redirectUris`,
    `grantTypes`, `scopes` hydrate as `string[]` automatically. Existing
    `JSON.stringify([...])` write callsites continue to work — `castSet('json')`
    returns string inputs verbatim.
  - **Confidential-client null-secret guard** added to `client_credentials`,
    `refresh_token`, and `authorization_code` grants. Catches a future refactor
    that could otherwise mask `client.secret = null` as authenticating against
    an empty string.
  - **`parseJsonArray`** in `models/helpers.ts` now logs a
    `[@rudderjs/passport]` warning (with truncated raw value + parse error)
    before returning `[]` on corrupt input. Behavior stays fail-closed;
    persistent corruption is no longer invisible.
  - **Stale `helpers.ts` comment** rewritten to reflect the post-PR-#111
    Model-instance reality.
  - **`personal-access-tokens.revokeAllTokens()`** collapsed from a
    read-then-N+1-update loop into a single bulk `QueryBuilder.updateAll`. Same
    result, one round-trip.

  No schema changes, no migrations.

- a8c20d7: Two passport-surface review fixes:

  - **`HasApiTokens.tokenCan(scope)` now actually works** (P2). The mixin previously read `__currentToken` — a field BearerMiddleware never wrote — so every gate check silently returned `false`. The mixin now reads `__passport_token` to match what the middleware writes on `req.raw`, and `BearerMiddleware` / `RequireBearer` stamp the same key onto the resolved user model before the plain-copy step so it propagates onto `req.user`. Closes finding P2 from the passport-surface review.
  - **`rudder passport:keys --force` no longer destroys old keys** (L1). Existing `oauth-private.key` / `oauth-public.key` are renamed to `*.bak.<ISO-timestamp>` before the new pair is written, and the CLI prints both backup paths plus a warning that JWTs signed by the old key now fail verification. `generateKeys()` returns the new `backup` field for programmatic callers. Closes finding L1.

## 1.0.0

### Major Changes

- cd38418: ## RudderJS 1.0 — wave 1

  Graduate 29 framework packages from `0.x` to `1.0.0`. The first batch of `@rudderjs/*` packages is now public-API stable — breaking changes will require explicit major bumps and migration notes from here on.

  **No code changes** — this is a version-line reset. Existing `0.x` consumers need to update their `@rudderjs/*` ranges from `^0.x.y` to `^1.0.0`. The scaffolder (`create-rudder-app`) is updated to emit `1.x` ranges.

  **Why now.** Under semver caret rules, `^0.X.Y` is exact-minor — every minor bump on a `0.x` peer goes out of range and triggers a cascading major bump on every dependent. Even with the `onlyUpdatePeerDependentsWhenOutOfRange` flag in place, the `0.x` baseline keeps producing spurious cascades. Telescope's v9 is mostly that. Once at `1.0`, `^1.0.0` absorbs all `1.x` minor/patch updates — cascades only fire for actual breaking changes.

  **Cascade noise will drop significantly:**

  - `^1.0.0` absorbs all 1.x minor/patch updates
  - Cascade now only fires for actual breaking changes (real majors)

  **Packages graduating to 1.0.0 in this wave:**

  `@rudderjs/contracts`, `core`, `support`, `log`, `hash`, `crypt`, `context`, `testing`, `middleware`, `cache`, `session`, `broadcast`, `schedule`, `mail`, `notification`, `storage`, `localization`, `pennant`, `socialite`, `queue-bullmq`, `queue-inngest`, `router`, `server-hono`, `view`, `orm`, `orm-prisma`, `passport`, `boost`, `ai`.

  `@rudderjs/ai` was originally on the defer list (recent runtime-agnostic split), but it peer-depends on `@rudderjs/core` — graduating core forces ai to graduate via cascade regardless. Listing it explicitly so the version line is intentional rather than a side-effect.

  **Packages NOT yet graduated (still 0.x), to graduate individually as they stabilize:**

  - _Too new / not yet exercised in the dogfood loop:_ `@rudderjs/concurrency`, `image`, `process`, `http`, `console`
  - _Recent significant changes:_ `@rudderjs/orm-drizzle`, `sync`, `vite`

  These will only patch-bump in this release (cascade via regular `dependencies`, not `peerDependencies`).

  **Already past 1.0 (untouched by this release):** `@rudderjs/auth`, `cli`, `mcp`, `queue`, `horizon`, `pulse`, `sanctum`, `telescope`, `cashier-paddle`. These keep their existing version lines; no reset.

  **Expected cascade:** dependents like `telescope`, `pulse`, `horizon`, `cli`, `auth`, `mcp`, `queue`, `sanctum` will major-bump in this release because their peer/dep ranges shifted from `^0.x` to `^1.0.0`. This is the _last_ spurious cascade — future releases of those packages will patch-bump on in-range peer updates.

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/contracts@1.0.0
  - @rudderjs/core@1.0.0
  - @rudderjs/orm@1.0.0

## 0.1.4

### Patch Changes

- 8411cd5: **Renamed `@rudderjs/rudder` → `@rudderjs/console`** to match Laravel's `Illuminate\Console` namespace and remove the "rudder rudder" stutter (the binary is `rudder`, the framework is RudderJS, and the authoring package is now `console` — no more triple-naming collision).

  **Migration for consumers:**

  ```ts
  // before
  import { Rudder, Command } from "@rudderjs/rudder";

  // after
  import { Rudder, Command } from "@rudderjs/console";
  ```

  **No symbol changes** — `Rudder`, `Command`, `CommandRegistry`, `CommandBuilder`, `MakeSpec`, `CancelledError`, `parseSignature`, `commandObservers` all keep their names. Only the import path changes.

  **No CLI changes** — the binary is still `rudder` (`pnpm rudder ...`), and the runner package is still `@rudderjs/cli`. Internal dependency updates only.

  **Naming model after this rename:**

  | Concept                 | Package                 | Surface               |
  | ----------------------- | ----------------------- | --------------------- |
  | Author HTTP routes      | `@rudderjs/router`      | `Route.get(...)`      |
  | Run HTTP routes         | `@rudderjs/server-hono` | (boots HTTP server)   |
  | Author console commands | `@rudderjs/console`     | `Rudder.command(...)` |
  | Run console commands    | `@rudderjs/cli`         | `rudder` binary       |

  The old `@rudderjs/rudder` will be deprecated on npm with a pointer to `@rudderjs/console` after publish.

- Updated dependencies [8411cd5]
  - @rudderjs/core@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [f0b3bae]
- Updated dependencies [be10c83]
  - @rudderjs/core@0.1.2
  - @rudderjs/contracts@0.2.0
  - @rudderjs/orm@0.1.2

## 0.1.2

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 0.1.1

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/contracts@0.1.0
  - @rudderjs/core@0.1.0
  - @rudderjs/orm@0.1.1

## 0.1.0

### Minor Changes

- 8ab284a: Passport Phase 6 — customization hooks.

  - `Passport.useClientModel()` / `useTokenModel()` / `useRefreshTokenModel()` / `useAuthCodeModel()` / `useDeviceCodeModel()` — swap in custom model classes (extend the base models to add columns or methods). Grants, routes, middleware, personal access tokens, and `passport:purge` all resolve models via the new `Passport.*Model()` getters.
  - `Passport.authorizationView(fn)` — render a custom consent screen from `GET /oauth/authorize`. The hook receives `{ client, scopes, redirectUri, state?, codeChallenge?, codeChallengeMethod?, request }` and may return a `view(...)` response or any router-acceptable value. JSON remains the default when unset.
  - `Passport.ignoreRoutes()` — short-circuits `registerPassportRoutes()` for manual wiring.
  - `registerPassportRoutes(router, { except: ['authorize'|'token'|'revoke'|'scopes'|'device'] })` — skip specific route groups.

  The `HasApiTokens` mixin type now accepts abstract base classes (such as `@rudderjs/orm`'s `Model`) and preserves the base's static methods, so `User extends HasApiTokens(Model)` composes cleanly.

### Patch Changes

- Updated dependencies [8b0400f]
  - @rudderjs/orm@0.1.0

## 0.0.5

### Patch Changes

- @rudderjs/core@0.0.12

## 0.0.4

### Patch Changes

- @rudderjs/core@0.0.11

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.10

## 0.0.2

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/contracts@0.0.4
  - @rudderjs/core@0.0.9
  - @rudderjs/orm@0.0.7
