---
'@rudderjs/passport': minor
---

Hash refresh tokens + auth codes at rest — closes findings M5 + P6 (second half) from `docs/plans/2026-05-06-passport-surface-review-fixes.md`. Last remaining schema-migration item from the passport-surface review.

**The bug:** pre-migration, the plaintext bearer credential returned to the client WAS the row's cuid `id` on `oauth_refresh_tokens` and `oauth_auth_codes`. A DB read leak (`SELECT * FROM oauth_refresh_tokens` / `oauth_auth_codes`) handed every active refresh token and every in-flight auth code to the attacker as usable credentials.

**The fix:** new `tokenHash String @unique` column on both tables. The plaintext returned to the client is now freshly generated `randomBytes(48).toString('base64url')` (384 bits CSPRNG, 64 chars URL-safe), decoupled from the row's `id`. Lookups hash the inbound plaintext before querying:

```ts
// refreshTokenGrant
const refreshTokenHash = await hashOpaqueToken(params.refreshToken)
const refreshToken = await RefreshTokenCls.where('tokenHash', refreshTokenHash).first()

// exchangeAuthCode
const codeHash = await hashOpaqueToken(params.code)
const authCode = await AuthCodeCls.where('tokenHash', codeHash).first()
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
