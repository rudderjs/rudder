---
"@rudderjs/passport": minor
---

Add `POST /oauth/revoke` — the RFC 7009 OAuth 2.0 Token Revocation endpoint (Laravel Passport parity). Third-party OAuth client SDKs revoke tokens by value on logout/cleanup; the existing `DELETE /oauth/tokens/:id` (by database id, user-bearer-authenticated) doesn't satisfy the spec.

- **Revoke by token value**, not database id — accepts an access-token JWT (resolved via its `jti`) or an opaque refresh token (resolved via its hash), with the optional `token_type_hint` reordering the lookup.
- **Confidential-client authentication** (HTTP Basic or body `client_id`/`client_secret`), not an end-user bearer token.
- **Always HTTP 200** on a well-formed, authenticated request — whether the token was revoked, already invalid, unknown, or owned by another client (§2.2), so the endpoint is not a token-existence oracle. Only client-auth failure and a missing `token` parameter are errors.
- **Ownership-scoped** — a client can only revoke tokens issued to itself; revoking either half of a grant cascades to the paired refresh token and its rotation family (§2.1).

Mounted on the api group by `registerPassportApiRoutes()` (shares the `tokenMiddleware` rate limiter). The new `'revocation'` route group can be skipped via `except: ['revocation']`.
