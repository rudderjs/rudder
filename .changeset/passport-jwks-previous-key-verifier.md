---
'@rudderjs/passport': minor
---

JWKS-style previous-key verifier — `passport:keys --force` no longer forces a global sign-out.

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
