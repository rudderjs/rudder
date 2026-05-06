# Passport-surface review sweep findings — 2026-05-06

**Status:** Filed 2026-05-06 by Claude Opus 4.7. **All 9 HIGH shipped** (#255, #256, #258, #259, #260, #261). Endpoint hardening: E5/E10/E11 (#262), E9 (#263), E6 (this PR). MEDIUM/LOW backlog ongoing — see "Recommended PR strategy" below for grouping.
**Pattern:** Same shape as `2026-05-06-auth-surface-review-fixes.md` (4-agent partitioned sweep).

Four parallel review agents on `@rudderjs/passport` (RudderJS's Laravel Passport-equivalent OAuth2 server), partitioned by surface:

- **P** — grants & token issuance (`grants/*`, `token.ts`, `personal-access-tokens.ts`)
- **E** — HTTP endpoints & middleware (`routes.ts`, `middleware/*`)
- **M** — storage & models (`models/*`)
- **L** — lifecycle (provider, commands, top-level)

Findings deduplicated where two agents flagged the same root cause.

---

## Severity summary

| Surface | HIGH | MEDIUM | LOW |
|---|---|---|---|
| Grants (P) | 5 | 5 | 3 |
| Endpoints (E) | 5 | 5 | 3 |
| Storage (M) | 3 | 6 | 7 |
| Lifecycle (L) | 2 | 3 | 3 |
| **Total (raw)** | **15** | **19** | **16** |

After dedup (cross-agent overlap on 6 findings): **~9 HIGH, ~17 MEDIUM, ~14 LOW**.

**Ship-blockers:**
1. **E1** — `/oauth/token` cannot accept `application/x-www-form-urlencoded` bodies. Default scaffolding is broken end-to-end against any spec-compliant client.
2. **E2/M(H2)** — `DELETE /oauth/tokens/:id` has zero auth checks. Any unauthenticated request can revoke any token by id.
3. **P1/E4** — Authorization-code exchange does not bind/verify `redirect_uri`.
4. **P4/M(H4)** — No refresh-token reuse-chain revocation (RFC 6819 §5.2.2.3 / OAuth 2.0 Security BCP).
5. **L(H1)** — `passport:keys --force` silently invalidates all live JWTs without backup or grace period.

---

## Grants & token issuance — P

### HIGH

**P1. `authorization-code.ts:120-194` — `exchangeAuthCode` does not verify `redirect_uri` matches the authorization request** ✅ VERIFIED REAL
- RFC 6749 §4.1.3 requires the token endpoint to verify that `redirect_uri` matches the value sent in the original authorization request when one was supplied. The `redirectUri` parameter on `TokenExchangeRequest` is accepted (line 113) but never compared against anything during exchange.
- The `AuthCode` model and Prisma schema do not persist `redirectUri`, so a comparison is impossible — the binding is missing at issuance too.
- An auth code obtained via one allow-listed redirect can be exchanged via any other registered redirect, breaking the OAuth threat model for clients with multiple registered redirect URIs.
- Cross-flagged as **E4** by the endpoints agent.
- Fix: add `redirectUri` column to `AuthCode`, store at `issueAuthCode`, require strict equality at exchange.

**P2. `personal-access-tokens.ts:99` — `tokenCan(scope)` reads `__currentToken` that is never written; always returns `false`** ✅ VERIFIED REAL
- `bearer.ts:36` writes `raw['__passport_token']` on `req.raw`. The mixin reads `(this as any).__currentToken` from the user model. No writer exists for `__currentToken` anywhere in the package.
- Net effect: `user.tokenCan('write')` always returns `false`. Every gate check using it denies access silently. Same class as sanctum T1.
- Fix: align names — either rename mixin field to `__passport_token` and copy from `req.raw` onto the resolved user in `BearerMiddleware`, or remove the method until it's wired.

**P3. `authorization-code.ts:53-58` — Public clients can submit `code_challenge_method=plain`, defeating PKCE** ✅ VERIFIED REAL
- `validateAuthorizationRequest` only requires `codeChallenge` to be present for public clients; method is not constrained, line 53 explicitly accepts `plain`.
- RFC 7636 §4.4.1 requires S256 when the client can support it. With `plain`, the verifier equals the challenge — PKCE provides no defence.
- Cross-flagged as **M2** by the storage agent (with stronger recommendation: ban `plain` outright per OAuth 2.1).
- Fix: reject `plain` for public clients (allow only S256), or globally require S256 with an opt-in `Passport.allowPlainPkce()` flag.

**P4. `refresh-token.ts:53-54` — No reuse-detection / token-family revocation on a revoked refresh token** ✅ FIXED — PR #261
- On reuse of a previously-rotated refresh token, the code threw `invalid_grant` only. RFC 6749 §10.4 + OAuth 2.0 Security BCP §4.14 require revoking the **entire token family** on detected reuse.
- Pre-fix, an attacker who stole RT1 before legitimate rotation could rotate forever; the legitimate user was locked out silently and the attacker was undetected.
- Cross-flagged as **M(H4)** by the storage agent.
- **Fixed in #261**: nullable `familyId` column on `OAuthRefreshToken` (indexed). `issueTokens()` stamps a fresh UUID when no family is passed; `refreshTokenGrant()` propagates it on rotation. On reuse of a revoked RT with a non-null `familyId`, the grant walks `WHERE familyId = X` and revokes every access + refresh token in the family before throwing `invalid_grant`. Legacy null rows are exempt during the migration window — same approach as the redirect_uri rollout.

**P5. Multiple grants — Non-constant-time comparison of client-secret hashes and PKCE verifier** ✅ VERIFIED REAL
- `authorization-code.ts:141`, `refresh-token.ts:43`, `client-credentials.ts:40`: `hashed !== client.secret` — JS `!==` short-circuits on first mismatch.
- `authorization-code.ts:179` for PKCE: `expected !== authCode.codeChallenge` — same problem.
- Both sides are SHA-256 hex of equal length so the leak is small, but `crypto.timingSafeEqual` is a one-line ask and matches industry standard.
- Cross-flagged as **M(H3)** by the storage agent.
- Fix: `crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))` after a length pre-check, on all four sites.

### MEDIUM

**P6. Client secret + refresh-token + auth-code storage — bare SHA-256, no salt; refresh tokens stored as DB id plaintext** ✅ VERIFIED REAL
- `commands/client.ts:27`: client secret hashed with bare SHA-256, no salt or work factor (Laravel uses bcrypt).
- `issue-tokens.ts:65`: refresh-token returned to client IS the DB primary key. Same at `authorization-code.ts:103` for auth codes. A DB read-leak hands every active credential to the attacker.
- Cross-flagged as **M5** by the storage agent (more detailed schema migration recipe).
- Fix: store SHA-256 hash of a `randomBytes(40).toString('hex')` token, return plaintext to client; for client secrets, switch to bcrypt or include an HMAC pepper from `APP_KEY`.

**P7. `token.ts:83-114` — `verifyToken` does not validate `aud` or `iss`** ✅ VERIFIED REAL
- Verification only checks signature + `exp`. JWT carries `aud` (clientId), but no caller passes an expected audience. RFC 8725 §3.10 / §3.12 recommend validating both.
- Mitigated in practice because `BearerMiddleware` looks up the JTI and that record carries `clientId`. Latent risk if a second issuer is added or DB lookup is removed.
- Fix: optional `expectedAud` parameter; validate `iss` if a configured issuer URL is set.

**P8. `device-code.ts:74,113` — No rate-limiting on `userCode` / `deviceCode` lookup endpoints** ✅ VERIFIED REAL
- `approveDeviceCode` does `where('userCode', userCode).first()` with no per-IP / per-client throttle. RFC 8628 §5.2 explicitly requires rate-limiting and brute-force protection on user_code.
- 8 chars from a 32-symbol alphabet is ~1.1×10^12 — survivable with throttling, not without.
- Fix: integrate `@rudderjs/middleware` RateLimit on the verification + token endpoints; lock `userCode` after N misses.

**P9. `device-code.ts:127` — `slow_down` does not escalate the polling interval** ✅ VERIFIED REAL
- RFC 8628 §3.5: when returning `slow_down`, the server SHOULD increase the required polling interval by 5 seconds and the client must use the new interval. Code re-checks against a fixed 5000ms forever.
- Spec violation, low risk.
- Fix: store an `interval` column; increment by 5 on each `slow_down`; return new interval.

**P10. `personal-access-tokens.ts:78-82` — `user.tokens()` returns ALL access tokens for the user, not just personal ones** ✅ VERIFIED REAL
- Query is `where('userId', userId)` — no filter on `clientId === personalAccessClientId`. Comment promises "personal access tokens for this user".
- A UI listing personal tokens shows OAuth-app session tokens; "log out all my dev tokens" also revokes legitimate third-party app authorizations.
- Fix: filter by `clientId === getPersonalAccessClientId()`.

### LOW

**P11. `token.ts:122-128` — `decodeToken` exported publicly with no signature verification** ✅ VERIFIED REAL
- Footgun: a future caller may use `decodeToken` to read `sub` and trust it. Middleware uses `verifyToken` first today, so currently safe; the public export invites misuse.
- Fix: rename to `unsafeDecodeToken` or remove from `index.ts` exports.

**P12. `issue-tokens.ts:24` — `expires_in` and `exp` derived from two different `Date.now()` reads** ⚠️ NEEDS VERIFY
- Off-by-one second possible. Cosmetic.
- Fix: capture `now` once, derive both from it.

---

## HTTP endpoints & middleware — E

### HIGH

**E1. `server-hono/src/index.ts:406-411` + `passport/src/routes.ts:157` — `/oauth/token` cannot accept `application/x-www-form-urlencoded` bodies** ✅ VERIFIED REAL
- server-hono only parses bodies when `content-type` includes `application/json`; everything else leaves `req.body` as `undefined`. Token handler reads `body['grant_type']` from `req.body ?? {}` which is `{}`, so the handler always returns `unsupported_grant_type` for spec-compliant clients.
- RFC 6749 §3.2 mandates `application/x-www-form-urlencoded` for the token endpoint. Same bug class as `@rudderjs/socialite` (#242). Every standard OAuth client (curl `-d`, Postman default, axios `URLSearchParams`) sends form-encoded.
- `/oauth/device/code`, `/oauth/authorize` POST/DELETE, `/oauth/device/approve` share the same body-parse path — all broken under form-encoded.
- **Highest-impact ship-blocker. The default scaffolding is non-functional against any spec-compliant client.**
- Fix: in server-hono add an `application/x-www-form-urlencoded` branch using `c.req.parseBody()`, OR add per-route body-parse middleware in `registerPassportRoutes()`.

**E2. `routes.ts:233-243` — `DELETE /oauth/tokens/:id` has no authorization check** ✅ VERIFIED REAL
- No `RequireBearer()`, no ownership check against `token.userId`. Token IDs travel in JWT `jti` claims (semi-public).
- Anyone with one captured JWT can DoS legitimate users by revoking their tokens by id.
- Cross-flagged as **M(H2)** by the storage agent.
- Fix: require `RequireBearer()` + check `token.userId === req.user.id` (or owning-client match); return 404 to avoid id-existence leakage.

**E3. `routes.ts:111-141, 144-152` — Open redirect on POST/DELETE `/oauth/authorize` (redirect_uri not re-validated)** ✅ VERIFIED REAL
- POST `/oauth/authorize` blindly trusts `body['redirect_uri']` (line 129) without re-validating against client's whitelist. `issueAuthCode` doesn't validate either.
- DELETE `/oauth/authorize` (line 146) defaults to `'http://localhost'` and never validates against the client.
- An attacker can craft a flow where consent screen approves to URI A but POSTs URI B in the body — auth code leaks to attacker host.
- Fix: re-run `clientHelpers.hasRedirectUri(client, body.redirect_uri)` on POST + DELETE before constructing the redirect; bind redirect_uri to the AuthCode (P1).

**E5. `middleware/bearer.ts:14, 70` — Case-sensitive `'Bearer '` prefix match** ✅ VERIFIED REAL
- `authHeader?.startsWith('Bearer ')` rejects `bearer xyz`, `BEARER xyz`. RFC 6750 §2.1 makes the scheme name case-insensitive (HTTP auth schemes are tokens).
- Same bug class as sanctum T6.
- Fix: `authHeader.slice(0, 7).toLowerCase() === 'bearer '` then `authHeader.slice(7).trim()`.

> E4 is the same finding as P1 (redirect_uri binding at exchange) — listed with grants.

### MEDIUM

**E6. `grants/authorization-code.ts:32-74` — Requested scopes never validated against client/registry** ✅ FIXED — PR follow-up to #263
- `validateAuthorizationRequest` parsed `scope` and stored it as-is. No check against `clientHelpers.getScopes(client)` or `Passport.validScopes()`. A client could request arbitrary scope strings (including `*`) and they'd be issued if the user approved. RFC 6749 §3.3 wants `invalid_scope` for unknown/disallowed scopes.
- **Fixed**: shared `validateScopes(client, requested)` helper exported from `grants/authorization-code.ts`, applied in `validateAuthorizationRequest`, `clientCredentialsGrant`, and `requestDeviceCode`. Throws `invalid_scope` when a requested scope is missing from the global `Passport.tokensCan()` registry OR outside the per-client `client.scopes` allow-list. Each gate is only enforced when populated (empty registry / empty client allow-list = "no constraint configured") to preserve back-compat with apps that haven't declared scopes. Wildcard `*` always passes. `refreshTokenGrant` keeps its existing narrowing logic (subset of original-token scopes only).

**E7. `routes.ts:111-141` — POST `/oauth/authorize` lacks CSRF + session and is mounted on api group in default scaffolding** ⚠️ NEEDS VERIFY
- Playground mounts `registerPassportRoutes(...)` from `routes/api.ts` (line 720). API middleware group has no session, no `AuthMiddleware`, no CSRF. Handler reads `(req.raw as any)?.__rjs_user?.id ?? (req as any).user?.id` — both `undefined` — returns 401. Consent flow can't complete in default scaffolding.
- Even on `web` group, consent POST is the canonical CSRF target. RudderJS's `CsrfMiddleware` is opt-in per-route.
- Fix: split `registerPassportRoutes` into a `web`-group bundle (authorize + revoke) and an `api`-group bundle (token + device + scopes). Document the requirement.

**E8. `routes.ts:157-228` — No dedicated rate limit on `/oauth/token` (brute-force on client_secret)** ✅ VERIFIED REAL
- Generic 60/min global RateLimit insufficient where each request guesses one client_secret.
- Fix: per-route `RateLimit.perMinute(10).by((req) => \`${req.ip}:${req.body?.client_id}\`).toHandler()`, or document that apps must add it.

**E9. Token endpoint — No support for HTTP Basic client authentication** ✅ FIXED — PR follow-up to #262
- All grants previously only accepted `client_id` / `client_secret` from the request body. RFC 6749 §2.3.1 says servers **MUST** support Basic; body params are an alternative.
- §2.3 says clients MUST NOT use both at once; server now rejects if both present.
- **Fixed**: `resolveClientCredentials()` helper in `routes.ts` parses `Authorization: Basic base64(id:secret)` (case-insensitive prefix), falls back to body params, and rejects mixed credentials with `invalid_request`. `client_credentials` grant now surfaces missing `client_secret` early with a clear error.

**E10. `authorization-code.ts:131,137,142` — `invalid_client` returns 400, not 401 with `WWW-Authenticate`** ✅ VERIFIED REAL
- RFC 6749 §5.2: client auth failure MUST be 401 with `WWW-Authenticate`. `refresh-token.ts:33,38,44` and `client-credentials.ts:27,40` correctly use 401 — but `authorization-code.ts:131,137,142` defaults to 400. Inconsistent + non-conformant for the auth_code grant.
- Fix: pass `401` in those three `OAuthError` constructors; routes.ts append `WWW-Authenticate: Basic` on 401 from token endpoint.

### LOW

**E11. `routes.ts:204` — Device-code `slow_down` returns HTTP 429 instead of 400** ✅ VERIFIED REAL
- RFC 8628 §3.5: `slow_down` is a §5.2-shaped error (HTTP 400). 429 is not specified.
- Fix: drop the 429 special case; always 400 for `slow_down`.

**E12. `routes.ts:101-107, 134-140, 221-227` — Errors swallow root cause + no `state` echoed back on auth-endpoint errors** ✅ VERIFIED REAL
- RFC 6749 §4.1.2.1: errors at the authorize endpoint that result in a redirect MUST include `state`. Current handlers return JSON instead of redirecting; if a custom consent view triggers a redirect on error, `state` is missing.
- `error: 'server_error'` hides the actual exception with no `report()` hook.
- Fix: import `report` from core and call in the `else` branch; document that custom views must echo `state` on redirect-style error returns.

**E13. `middleware/scope.ts:31` — Scope semantics are AND-only, no OR / hierarchical** (parity gap, not a bug)
- Multiple `scope('a','b')` requires both. Laravel Passport ships a `scopes` (AND) plus `scope` (OR) pair.
- Fix (parity): add a `scopeAny(...required)` middleware that passes if ANY scope matches.

---

## Storage & models — M

### HIGH

**M(H2). Same as E2** — `DELETE /oauth/tokens/:id` unauthenticated. Listed under endpoints.

**M(H3). Same as P5** — Non-constant-time secret comparison. Listed under grants.

**M(H4). Same as P4** — Refresh-token reuse chain revocation. Listed under grants.

> The storage agent flagged an **H1** noting that access tokens are JWT-only with no DB hash column — this is **by-design** and matches Laravel Passport's model (JWT signature is the secrecy boundary). Action item: document this loudly so reviewers don't confuse it with Sanctum's hashed-token model. Add a "Why we don't store hashed access tokens" note in `packages/passport/CLAUDE.md` and at the top of `AccessToken.ts`.

### MEDIUM

**M1. `personal-access-tokens.ts:78-82` — `tokens()` returns full AccessToken records; no `@Hidden` on AccessToken columns** ✅ FIXED
- `AccessToken` has no `@Hidden` on any column. `JSON.stringify(token)` exposes `userId`, `clientId`, `name`, scopes, `revoked`, `expiresAt`. None are secrets per se (the JWT is never stored), but listing reveals other users' `userId` if the route ever exposes another user's tokens.
- **Fixed**: `userId` and `clientId` carry `@Hidden`, so `toJSON()` strips them by default. `tokens()` JSDoc warns consumers about per-user scoping and points at `instance.makeVisible(['userId', 'clientId'])` for opt-in admin views. The original recommendation suggested a `select()` projection — the ORM doesn't expose a column-projection method on QueryBuilder, and `@Hidden` is the right Eloquent-shaped knob anyway.

**M3. `authorization-code.ts:147-186` — Auth-code consumption is not atomic; race window between read and revoke allows double-spend** ✅ FIXED — PR follow-up to #264
- Two concurrent token-exchange requests with the same code each found `revoked=false`, both proceeded past PKCE, both called the unconditional `update` last → two access-token pairs minted from one auth code (RFC 6749 §4.1.2 prohibits).
- **Fixed**: replaced the unconditional `Model.update(id, { revoked: true })` with a conditional `Model.where('id', id).where('revoked', false).updateAll({ revoked: true })` against `QueryBuilder.updateAll()` (returns affected count). The atomic SQL `UPDATE ... WHERE revoked = false` lets exactly one concurrent caller see `count === 1`; the loser sees 0 and throws `invalid_grant("Authorization code has already been used.")` before reaching `issueTokens()`. Subsequent serial reuse keeps surfacing at the existing early-exit `if (authCode.revoked)` check.

**M4. `device-code.ts:46-55` + `schema/passport.prisma:62-75` — `deviceCode` and `userCode` stored in plaintext; lookups use the secret as the lookup key** ✅ VERIFIED REAL
- `pollDeviceCode` does `where('deviceCode', params.deviceCode)`. A DB compromise yields any in-flight device-code session directly. Same for `userCode`.
- RFC 8628 §6.1 explicitly recommends hashing device/user codes before storing.
- Fix: store SHA-256 hashes in `oauth_device_codes.deviceCode` / `userCode`; look up by hash; user-displayed `userCode` is only in memory during the `requestDeviceCode` response.

**M5. Same as P6** — refresh tokens / auth codes stored as DB id plaintext. Listed under grants.

**M6. `client-credentials.ts:40, refresh-token.ts:43, authorization-code.ts:141` — Comparison can run with `client.secret === null` (schema allows null for public clients)** ✅ FIXED
- Non-confidential clients skip the secret check (good), but the typing `string | null` is vulnerable to a future refactor that could mask `null` as authenticating with `secret = sha256('')`.
- **Fixed**: each grant that authenticates via `verifyClientSecret` now checks `client.secret == null` and throws `invalid_client` ("Confidential client has no secret on file.") before reaching the comparison. Catches drift if a future change ever short-circuits past `verifyClientSecret`'s own fail-closed branch on `null` stored values.

### LOW

**M-L1. `AccessToken.ts:33-36, RefreshToken.ts:13-16` — `revoke()` uses `(this as any).id` + static `update` instead of `this.save()`** ✅ FIXED
- Functional today; observers still fire; pattern is fragile to future refactors.
- **Fixed**: both instance methods now `this.revoked = true; await this.save()`. Observers fire as before, the in-memory instance reflects the new state without a re-read, and the `(this as any).id` cast is gone.

**M-L2. `helpers.ts` — comment "ORM returns plain objects, not instances" is stale** ✅ FIXED (partial)
- Per CLAUDE.md PR #111 (2026-04-30), all read paths return Model instances.
- **Fixed**: rewrote the leading comment to reflect Model-instance reality and document that helpers stay around for raw-record paths (cached JSON, fixtures, adapter snapshots) and grant-side legibility while migration continues. Deferred the larger "delete helpers.ts entirely and route every grant through instance methods" cleanup — that touches every grant call site and is its own focused PR.

**M-L3. No `prunable()` on AuthCode/DeviceCode/AccessToken/RefreshToken** ✅ FIXED
- `passport:purge` exists but only the user invokes it; no automatic pruning via `model:prune`.
- **Fixed**: each token model now exposes `static prunable()` + `static pruneMode = 'mass'`. Predicates mirror `passport:purge` (`expiresAt < now OR revoked = true` for tokens, `expiresAt < now` for codes), so `pnpm rudder model:prune` and `passport:purge` are interchangeable and idempotent. `PassportProvider.boot()` eagerly registers the four classes with `ModelRegistry` so a fresh install can prune passport rows before any oauth flow has run.

**M-L4. `helpers.ts:60` — `JSON.parse(raw)` swallows errors silently; corrupt data returns `[]`** ✅ FIXED
- Fails-closed for authorization, fails-open for token validity depending on caller.
- **Fixed**: `parseJsonArray` now logs a `[@rudderjs/passport]` warning (with truncated raw value + parse error) before returning `[]`. Behavior stays fail-closed; persistent corruption is no longer invisible.

**M-L5. `OAuthClient.ts` — `redirectUris`/`grantTypes`/`scopes` stored as JSON-stringified strings without `@Cast(json)`** ✅ FIXED
- Cosmetic: every consumer must remember `getRedirectUris()` etc.
- **Fixed**: `@Cast('json')` applied to `redirectUris`, `grantTypes`, `scopes`. Hydration produces `string[]` automatically. Existing `JSON.stringify([...])` write callsites continue to work — `castSet('json')` returns string inputs verbatim — so no callsite changes were needed in this PR. The `getRedirectUris()`/`getGrantTypes()`/`getScopes()` accessors stay for back-compat with their existing `Array.isArray(raw)` fast path.

**M-L6. `revoked` is in `static fillable` on every token model** ✅ FIXED
- An attacker-controllable `create` payload could pre-revoke records. No such surface today; defense-in-depth.
- **Fixed**: removed `revoked` from `AccessToken.fillable`, `RefreshToken.fillable`, and `AuthCode.fillable`. Revocation paths updated to bypass mass-assignment: `revoke()` instance methods use direct property + `save()`, the refresh-token rotation + family-revoke paths use `QueryBuilder.where(...).updateAll({ revoked: true })`, and `DELETE /oauth/tokens/:id` uses the same QueryBuilder pattern. `revokeAllTokens()` collapsed from a read-then-N+1-update loop into a single bulk `updateAll`.

**M-L7. Prisma delegate names** — confirmed correct (camelCase delegates, NOT `@@map`'d SQL `oauth_*`). No issue.

---

## Lifecycle (provider, commands, top-level) — L

### HIGH

**L1. `commands/keys.ts:17-19` — `--force` overwrites private key with NO backup; tokens issued by old key become unverifiable** ✅ VERIFIED REAL
- `if (!opts.force && existsSync(privatePath)) throw ...; await writeFile(privatePath, privateKey, { mode: 0o600 })` — when `force: true`, the existing private key is silently replaced.
- Every JWT signed by the old key fails verification post-rotation: real users get logged out instantly, third-party integrations break with no recovery path.
- CLAUDE.md surface advertises rotation as a feature with no warning.
- Fix: rename existing keys to `oauth-private.key.bak.<timestamp>` before write; document that long-lived tokens issued by the old key are invalidated. Future enhancement: support a JWKS-style "previous key" verifier so rotation is graceful.

**L2. `index.ts:122-128` — `--device` and `--personal` CLI flags produce orphan grant arrays not accepted by token endpoint** ⚠️ NEEDS VERIFY
- `passport:client --device` writes `grantTypes: ['urn:ietf:params:oauth:grant-type:device_code']`. `--personal` writes `['personal_access']`.
- `routes.ts:164` switch only branches on these strings when `grant_type` matches. `personal_access` is never an HTTP grant — users running `passport:client --personal` get a client they can't use against `/oauth/token`. Personal access tokens go through `HasApiTokens.createToken()` which uses the auto-managed `__personal_access__` client, not a user-created one.
- `--device` clients only get `device_code` — once authorized they can't `refresh_token` (the array is exclusive).
- Fix: drop `--personal` from the CLI surface (or make it a no-op printing a hint to use `HasApiTokens`); for `--device`, append `'refresh_token'` to the array; document grant-type lists as additive.

### MEDIUM

**L3. `commands/purge.ts:25-56` — N+1 delete loop is not safe under concurrent token issuance and slow at scale** ✅ VERIFIED REAL
- For each table the code reads all expired rows then loops `await Cls.delete(t.id)` — four serial queries per row. 100k expired tokens = 100k DELETE round-trips.
- Fix: replace with a single bulk `delete().where(...)` per model (QueryBuilder supports it).

**L4. `index.ts:80-100` — provider boot has no clear error when keys are missing; first JWT issuance fails with raw `ENOENT`** ✅ VERIFIED REAL
- Provider doesn't validate keys at boot. First `createToken()` (potentially weeks after deploy) throws `ENOENT: ... oauth-private.key`. CLAUDE.md "Pitfalls" already calls this out, confirming users hit it.
- Fix: at end of `boot()`, `if (!cfg.privateKey && !existsSync(...))` log a `[passport]` warning. Warn, don't throw — runtime-configured keys are valid.

**L5. `index.ts:179-180` — top-level `try { ... } catch {}` swallows real registration failures** ✅ FIXED — PR follow-up to #265
- Two nested `try/catch`es wrapped ~70 lines of CLI registration with the misleading "rudder not available" comment. Any `rudder.command(...)` / `registerMakeSpecs(...)` failure (HMR duplicate, stub validation error, inner `await import('./commands/X.js')` fault) was silently dropped.
- **Fixed**: both wrappers removed. `@rudderjs/core` is a hard dep of passport, `@rudderjs/console` is a hard dep of `@rudderjs/core`, so the dynamic imports always resolve and there's no legitimate "module not found" branch to preserve. Errors now propagate with their original stack.

### LOW

**L6. `commands/client.ts:26-27` — SHA-256 of `randomBytes(32)` adds no security; client secrets aren't user-chosen** ✅ FIXED
- 256 bits CSPRNG is already intractable; SHA-256 adds nothing beyond Laravel parity.
- **Fixed**: extracted `client-secret.ts` with `hashClientSecret()` / `verifyClientSecret()`. When `APP_KEY` is set, secrets store as `peppered:<HMAC-SHA256(secret, APP_KEY)>`; otherwise plain SHA-256 (back-compat). Format is self-describing per row, so legacy plain-SHA-256 rows keep verifying after the operator sets `APP_KEY`. New CLAUDE.md "Pitfalls" entry documents that rotating `APP_KEY` invalidates every peppered row.

**L7. Pervasive `(client as any).id` casts** ⚠️ NEEDS VERIFY
- 8 sites in lifecycle/routes. Models likely missing `declare id: string`.
- Fix: declare `id` on each model class.

**L8. `routes.ts:259` — `req.protocol`/`req.hostname` builds verification URI; spoofable behind reverse proxy without trust-proxy** ⚠️ NEEDS VERIFY
- A malicious `Host` header reaches the device endpoint → verification URL points at attacker site.
- Fix: derive from `config('app.url')` instead; document in CLAUDE.md "Pitfalls".

---

## Recommended PR strategy

Mirror the auth-surface review approach: small focused PRs, security-first, no bundling cleanup with security fixes.

1. **E1 — server-hono form-encoded body parsing** — single PR, possibly cross-package (server-hono + passport). **Highest priority — currently a ship-blocker.**
2. **E2 + auth/ownership on `DELETE /oauth/tokens/:id`** — single PR, security.
3. **P1 + E3 + E4 — redirect_uri binding + open-redirect on POST/DELETE authorize** — single PR, security; touches AuthCode schema (migration).
4. **P3 — PKCE plain rejection for public clients** — single PR, security; small.
5. **P4 — refresh-token reuse-chain revocation** — single PR, security; touches RefreshToken schema (parentId/familyId). **Shipped: #261.**
6. **P5 — constant-time comparisons** — single PR, security; trivial.
7. **P2 — `tokenCan` wiring** — single PR, functional bug.
8. **L1 — `passport:keys --force` backup** — single PR, ops safety.
9. **E5 — case-insensitive Bearer prefix** — bundle with E10/E11 (small endpoint hardening pile).
10. **M3 — atomic auth-code consumption** — single PR.
11. **M4 + P6/M5 — at-rest hashing of device codes / refresh tokens / auth codes** — single PR or split per-token-type; touches schema.
12. **Storage hygiene PR** — M-L1 through M-L7 + M1, M6.
13. **Lifecycle hygiene PR** — L3 (bulk purge), L4 (boot warning), L5 (narrow catch).
14. **Parity PR** — E13 (`scopeAny`), L6 (HMAC pepper or doc), M-L3 (`prunable()`), L2 (`--personal`/`--device` flags).
15. **Docs PR** — H-by-design note ("Why we don't store hashed access tokens"), CLAUDE.md "Pitfalls" updates (host header trust, key rotation impact).

Don't bundle security fixes with cleanup. Schema migrations on AuthCode/RefreshToken/DeviceCode probably want to land in a single migration even though the code fixes split across PRs.
