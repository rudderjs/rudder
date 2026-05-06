---
'@rudderjs/socialite': minor
---

Fix Sign-in-with-Apple: the previous driver was non-functional in production and unsafe by design. Three findings closed (O2–O4 from the auth-surface review).

- **O2 — Sign `client_secret` as an ES256 JWT per Apple's spec.** Apple rejects raw `client_secret` strings with `invalid_client`. The driver now mints a freshly-signed ES256 JWT (claims: `iss=teamId`, `sub=clientId`, `aud=https://appleid.apple.com`, `iat`/`exp`) just-in-time on each token exchange. New required config fields:
  - `teamId`: Apple Developer Team ID (10 chars)
  - `keyId`: Sign-in-with-Apple Key ID (the JWS `kid`)
  - `privateKey`: PEM contents of the `.p8` file from the Apple Developer portal
  - `clientSecretTtl?` (optional): JWT lifetime override in seconds; defaults to 5 minutes
  Signatures use IEEE P-1363 raw `r||s` encoding (64 bytes), as required by JWS — node:crypto's default DER encoding for EC keys won't work and is explicitly opted out of with `dsaEncoding: 'ieee-p1363'`.
- **O3 — Verify `id_token` signature + claims.** The previous driver decoded Apple's id_token JWT payload via `Buffer.from(payload, 'base64url')` with no signature or claim verification — meaning a crafted id_token could supply any `sub`, becoming the app's primary user identifier (account-takeover risk). The driver now:
  - Fetches Apple's JWKS from `https://appleid.apple.com/auth/keys` and caches it for 1h (refetched on cache miss to handle key rotation).
  - Verifies the RS256 signature against the kid-matched public key.
  - Validates `iss === https://appleid.apple.com`, `aud` matches `clientId` (string or array form), `exp` is in the future, and `sub` is non-empty.
  - Rejects unexpected `alg` values (defends against `alg=none` confusion).
- **Token exchange consolidated into one POST.** The previous driver POSTed the auth code twice — once via the inherited `getAccessToken`, then again in `getIdToken` — which Apple rejects because authorization codes are single-use. The override fetches `access_token` + `id_token` from the same response.
- **O4 (related) — `getRedirectUrl` now inherits stateful CSRF state generation** introduced in O5 instead of skipping it. `response_mode=form_post` is preserved via a new `extraAuthParams()` hook on the base driver.

**Breaking for any app currently configuring Apple via socialite (none on npm, since the driver was broken end-to-end):** `clientSecret` in `config('socialite.apple')` is no longer used. Add `teamId`, `keyId`, and `privateKey` to your Apple config.

Exports `AppleSocialiteConfig` for typed Apple config in `config/socialite.ts`.
