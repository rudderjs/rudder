---
"@rudderjs/passport": minor
---

Add `POST /oauth/token/introspect` — the RFC 7662 OAuth 2.0 Token Introspection endpoint (Laravel Passport parity). Resource servers in a multi-service deployment can validate a bearer token's state without sharing the RS256 private key or direct database access.

- **Confidential-client authentication** (HTTP Basic or body credentials).
- **Not ownership-scoped** — any authenticated confidential client may introspect any token, because a resource server legitimately validates access tokens issued to other clients (its API consumers). This is the deliberate contrast with `POST /oauth/revoke`, which is ownership-scoped.
- **Reflects live state** (§2.2): `{ active: false }` for a bad-signature, expired, revoked, or unknown token; otherwise `{ active: true, scope, client_id, token_type, exp, iat, sub, aud, jti }`. `scope` comes from the live DB row (an operator may have narrowed it after issuance), the same authority bearer middleware uses. Opaque refresh tokens are introspected too.
- A malformed/unknown token is `{ active: false }` with HTTP 200, not an error; only client-auth failure and a missing `token` parameter are errors.

Mounted on the api group by `registerPassportApiRoutes()` (shares the `tokenMiddleware` rate limiter). The new `'introspection'` route group can be skipped via `except: ['introspection']`.
