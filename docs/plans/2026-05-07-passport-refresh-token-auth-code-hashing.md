# Plan — M5 / P6: oauth_refresh_tokens + oauth_auth_codes at-rest hashing

**Authors:** Claude Opus 4.7
**Date:** 2026-05-07
**Findings doc:** `docs/plans/2026-05-06-passport-surface-review-fixes.md` (M5, second half of P6)

Splitting the credential returned to the client from the row's primary key on `oauth_refresh_tokens` and `oauth_auth_codes`. Today both grants return `record.id` (a cuid) as the bearer secret AND store the same value as the lookup key. A DB read leak hands every active refresh token + every in-flight auth code to the attacker as usable credentials. After this change the persisted columns hold a SHA-256 hex of the plaintext, the plaintext is freshly generated random hex (not derived from the row id), and lookups hash before query.

This is the last remaining schema-migration item from the passport-surface review (#255–#282 already shipped). Bundled into one PR because the change shape is identical on both tables.

## Why now

- Companion to #282 (device-codes hashing). Device codes were the smaller surface; the same DB-leak threat applies to refresh tokens (long-lived) and auth codes (short-lived but bearer-sensitive while in flight).
- Already-shipped `client-secret.ts` (#271) handles client secrets. Access tokens are JWT-only by design (documented in CLAUDE.md). After this PR every credential class in passport is either signed (JWT), peppered-hashed (client secrets), or hashed-at-rest (device codes, refresh tokens, auth codes).

## Schema changes

Two new columns, one per table. Same shape on both:

```prisma
model OAuthRefreshToken {
  id            String   @id @default(cuid())
  tokenHash     String   @unique  // ← NEW. SHA-256 of the plaintext refresh token.
  accessTokenId String   @unique
  familyId      String?
  revoked       Boolean  @default(false)
  expiresAt     DateTime

  @@index([familyId])
  @@map("oauth_refresh_tokens")
}

model OAuthAuthCode {
  id                  String   @id @default(cuid())
  tokenHash           String   @unique  // ← NEW. SHA-256 of the plaintext auth code.
  userId              String
  clientId            String
  scopes              String   @default("[]")
  revoked             Boolean  @default(false)
  expiresAt           DateTime
  redirectUri         String?
  codeChallenge       String?
  codeChallengeMethod String?

  @@map("oauth_auth_codes")
}
```

Decisions:
- **Add `tokenHash`, keep `id`.** The cuid `id` becomes purely internal — referenced by `accessTokenId` linkage and family revocation. The plaintext returned to the client is freshly generated random hex, decoupled from `id`. Same shape Laravel Passport uses.
- **`@unique` on `tokenHash`.** Collision probability on SHA-256 of `randomBytes(32)` is negligible. Index covers the lookup path (`where('tokenHash', hash)`).
- **No phased rollout** — legacy refresh tokens + auth codes are invalidated by the migration. Same model #282 used for device codes.

### Migration semantics

In-flight credentials issued under the old code stop working after the migration:
- **Auth codes** — 10-minute TTL. In-flight codes get `invalid_grant` on exchange and the user re-clicks "Authorize". Drain window ≤10 minutes.
- **Refresh tokens** — typically days to weeks. Affected sessions get `invalid_grant` on next refresh and force-relogin. Same blast radius as rotating the RSA keypair (a documented operator event).

Operators planning a rollout should treat this PR as a coordinated sign-out window. Documented in CLAUDE.md "Pitfalls".

## Hashing helper

New `src/grants/opaque-token-hash.ts` (sibling to `device-code-secret.ts`, kept separate so both can carry their own threat-model docstrings):

```ts
export async function hashOpaqueToken(plaintext: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(plaintext).digest('hex')
}
```

Same plain-SHA-256 reasoning as `hashDeviceSecret`:
- Refresh tokens are 32 random bytes (256-bit CSPRNG). Auth codes likewise.
- Threat: DB read leak. Pepper buys nothing because the input is already unguessable per request and the secrets aren't reused across rows.
- Constant-time comparison happens implicitly via `@unique` index lookup — we hash, then equality-match on the indexed column. No `safeCompare` needed at the application layer (DB engines compare strings directly; the timing leak is the index probe, which is a B-tree walk on a 64-char hash and not a useful side channel).

## Code touch points

### `src/grants/issue-tokens.ts`

Generate the refresh-token plaintext alongside the access-token issuance, hash it, persist hash:

```ts
if (opts.includeRefresh !== false) {
  const refreshExpiresAt = new Date(now + Passport.refreshTokenLifetime())
  const familyId = opts.familyId ?? await newFamilyId()
  const refreshPlaintext = await newOpaqueToken()             // ← NEW
  const refreshHash = await hashOpaqueToken(refreshPlaintext) // ← NEW

  await RefreshTokenCls.create({
    accessTokenId: tokenId,
    tokenHash:     refreshHash,                                // ← stored
    familyId,
    revoked:       false,
    expiresAt:     refreshExpiresAt,
  } as Record<string, unknown>)

  result.refresh_token = refreshPlaintext                      // ← returned
}
```

`newOpaqueToken()` = `randomBytes(48).toString('base64url')` (64 chars URL-safe). 384 bits of entropy, RFC-friendly token shape.

The previous `result.refresh_token = refreshRecord.id` line goes away. The function no longer needs to read back the freshly-created record's id — `tokenHash` carries the lookup linkage and the `accessTokenId` linkage stays via the `tokenId` already in scope.

### `src/grants/refresh-token.ts`

`refreshTokenGrant` hashes the inbound `params.refreshToken` and looks up by `tokenHash`:

```ts
const refreshHash = await hashOpaqueToken(params.refreshToken)
const refreshToken = await RefreshTokenCls.where('tokenHash', refreshHash).first() as RefreshToken | null
```

The reuse-detection branch (`if (refreshToken.revoked)`) and the family-revoke logic are unchanged — they operate on `id` / `familyId` once the row is in hand. The first lookup is the only line that swaps.

### `src/grants/authorization-code.ts`

`issueAuthCode` returns a fresh plaintext, persists hash:

```ts
const codePlaintext = await newOpaqueToken()
const codeHash      = await hashOpaqueToken(codePlaintext)

await AuthCodeCls.create({
  userId:              opts.userId,
  clientId:            opts.clientId,
  tokenHash:           codeHash,                                 // ← stored
  scopes:              JSON.stringify(opts.scopes),
  revoked:             false,
  expiresAt,
  redirectUri:         opts.redirectUri,
  codeChallenge:       opts.codeChallenge ?? null,
  codeChallengeMethod: opts.codeChallengeMethod ?? null,
} as Record<string, unknown>)

return codePlaintext                                              // ← returned
```

`exchangeAuthCode` hashes inbound `params.code` and looks up by `tokenHash`:

```ts
const codeHash = await hashOpaqueToken(params.code)
const authCode = await AuthCodeCls.where('tokenHash', codeHash).first() as AuthCode | null
```

The atomic-consume update (M3) keeps using `where('id', authCode.id)` once the row is hydrated — the conditional update predicate doesn't care about the lookup column.

### `src/models/RefreshToken.ts` + `src/models/AuthCode.ts`

Add `declare tokenHash: string` to both. Add `'tokenHash'` to `static fillable`.

Update the `RefreshTokenRecord` / `AuthCodeRecord` interfaces in `src/models/helpers.ts` to add `tokenHash: string`. The helpers themselves don't need new methods — `tokenHash` is opaque and only used in queries.

### `src/index.ts`

Re-export `hashOpaqueToken` (and possibly `newOpaqueToken`) for symmetry with `hashClientSecret` and `hashDeviceSecret`.

### `src/commands/purge.ts`

No changes — the prune predicates use `expiresAt` and `revoked`, not the credential columns.

### `src/middleware/bearer.ts`

No changes. The plan doc's note about touching `BearerMiddleware` was inaccurate — bearer middleware looks up access tokens by `jti` claim, never sees refresh tokens.

## Tests

New describe block `oauth_refresh_tokens + oauth_auth_codes hashing (M5 + P6)`:

**Refresh tokens:**
- Round-trip — `issueTokens({ includeRefresh: true })` returns a plaintext `refresh_token`; capturing the create call shows `tokenHash` is the SHA-256 of that plaintext, and the persisted row has no plaintext anywhere.
- `refreshTokenGrant` accepts the plaintext and looks up by `where('tokenHash', sha256(plaintext))` — assert via the captured chain.
- Wrong plaintext fails with `invalid_grant`.
- Reuse-detection still fires: revoking + retrying the same plaintext walks `where('familyId', ...)` and revokes the chain. Family revocation logic is unchanged but covered for regression.

**Auth codes:**
- Round-trip — `issueAuthCode` returns a plaintext, persists hash. `exchangeAuthCode(plaintext)` succeeds; the captured create + lookup chains show plaintext only in caller-visible places.
- Wrong plaintext fails with `invalid_grant`.
- Atomic consume (M3) still fires — concurrent exchanges of the same plaintext: only one succeeds, the loser sees `Authorization code has already been used.`

**Schema migration regression:**
- A row created with the old schema (no `tokenHash`) cannot be looked up via the new code path — covered indirectly by the "wrong plaintext fails" test, but worth a dedicated assertion that the lookup column is `tokenHash`, not `id`.

Tests use the existing `Passport.useRefreshTokenModel(...)` / `useAuthCodeModel(...)` fake-injection pattern. No real DB.

## CLAUDE.md updates

- **Architecture Rules**: add an entry — "Refresh tokens and auth codes are hashed at rest. The plaintext returned to the client is freshly generated CSPRNG hex; the persisted `tokenHash` column is its SHA-256. Lookups hash before query. Same shape as device codes (#282)."
- **Pitfalls**: "Migrating to hashed refresh tokens / auth codes invalidates every in-flight credential. Auth codes drain in 10 minutes. Refresh tokens force re-login on next refresh — plan rollouts as a coordinated sign-out window, same blast radius as rotating the RSA keypair."
- Cross-link to the device-codes hashing entry where relevant.

## Changeset

Single `passport: minor` — adds two new public exports (`hashOpaqueToken`, `newOpaqueToken`), schema migration adding two indexed columns, return-value semantics of `issueAuthCode` are unchanged at the type level (still returns `string`) but the string is no longer a cuid. Operator-impacting; warrants the minor bump.

## Open questions / non-goals

- **No dual-column rollout.** Legacy in-flight credentials are dropped at migration time. Documented + accepted (matches #282 device-codes pattern).
- **Token format** — `randomBytes(48).toString('base64url')` chosen over hex for shorter wire format (64 chars vs 96). Both are equally hard to guess. base64url is RFC 6749 §A.2 / §A.17 friendly. Could revisit if any client tooling has trouble with `-_` characters; not aware of any.
- **Pepper** — not added. Same reasoning as `device-code-secret.ts`. If a future operator wants peppered storage they can extend `hashOpaqueToken` to read APP_KEY (mirroring `client-secret.ts`).
- **Old `refresh_token = record.id` semantics** — gone. No back-compat shim. The pre-migration tokens stop working at deploy time and that's the point.

## Test plan

1. Local: `pnpm --filter @rudderjs/passport typecheck && lint && build && test`.
2. Full local pre-flight: `pnpm typecheck` from root (skip the pre-existing storage / queue / schedule errors that are unrelated).
3. Playground: `pnpm exec prisma validate` against the multi-file schema.
4. Smoke a fresh auth-code flow in the playground:
   - `pnpm rudder passport:client "test"` to mint a confidential client.
   - GET `/oauth/authorize?...` → POST `/oauth/authorize` → POST `/oauth/token` with the returned code.
   - Verify the access + refresh tokens come back. Then POST `/oauth/token` with `grant_type=refresh_token` and the refresh token plaintext. Verify rotation works end-to-end.
5. Smoke reuse detection: capture a refresh token, rotate it once, then attempt to rotate the original a second time. Verify `invalid_grant` AND that the post-rotation refresh token also stops working (family revocation walked the chain).
