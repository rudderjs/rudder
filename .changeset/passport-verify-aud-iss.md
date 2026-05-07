---
'@rudderjs/passport': minor
---

`verifyToken` aud/iss validation + opt-in JWT issuer — closes finding P7 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

`verifyToken()` previously checked only the signature and expiration. RFC 8725 §3.10 / §3.12 recommend validating `aud` and `iss` whenever the deployment has more than one possible signer or audience — the latent risk this PR closes is cross-client token confusion or token replay across staging+prod sharing the same keypair. (BearerMiddleware's lookup-by-jti gives some protection in practice; this PR makes the protection explicit and forward-compatible.)

**Two new knobs:**

1. `Passport.useIssuer(url)` — opt-in. When set, `createToken()` stamps the URL as the `iss` claim on every new access token, and `BearerMiddleware`/`RequireBearer` ask `verifyToken()` to reject tokens whose `iss` doesn't match. Tokens minted before the issuer was configured carry no `iss` claim and stay verifiable during the migration window — same compat pattern as `redirect_uri` (P1) and `familyId` (P4). Single-issuer deployments don't need this.
2. `verifyToken(jwt, options)` — `options.expectedAud` rejects audience mismatches; `options.expectedIssuer` rejects issuer mismatches (when the token carries an `iss` claim). Resource servers that gate to a specific client should pass `expectedAud`; `BearerMiddleware` doesn't pass it itself because it doesn't know the expected client until after the DB lookup.

Wire-through: `PassportConfig` adds `issuer?: string`; `PassportProvider.boot()` calls `Passport.useIssuer()` when set. Reset() clears it. Empty string clears.

```ts
// config/passport.ts
export default {
  issuer: 'https://app.example.com',
  // ...
} satisfies PassportConfig
```

Rotation note added to CLAUDE.md Pitfalls: rotating the configured issuer URL invalidates every live token, same blast radius as rotating the RSA keypair. Plan as a forced sign-out window. Tokens minted before issuer was first configured (no `iss` claim) are NOT affected by rotation.

New `VerifyTokenOptions` type exported alongside the existing `JwtPayload` / `JwtHeader`.
