---
"@rudderjs/passport": patch
---

Security hardening of the OAuth 2 server (deep audit follow-up).

- **PKCE is now enforced where codes are actually minted (`POST /oauth/authorize`), not just on the advisory `GET`.** Previously only the consent-render `GET` validated PKCE; the `POST` that issues the authorization code re-validated scopes (a prior fix) but not PKCE — so a public/native client could obtain a code with **no `code_challenge`**, or downgrade to `code_challenge_method=plain`, fully defeating PKCE. The grant-type and PKCE policy are now re-enforced on the issuance path (shared `enforceAuthCodePolicy`), and the `authorization_code` grant is also re-checked at the token exchange as defense-in-depth. **Behavior change:** a public client that was (incorrectly) skipping PKCE on the authorize POST must now send a valid S256 `code_challenge`, as the OAuth 2 BCP requires.
- **Revoking an access token now also revokes its refresh token (RFC 7009 §2.1).** `DELETE /oauth/tokens/:id` previously flipped only the access token's `revoked` flag, leaving the paired refresh token live — so the holder of the refresh token could immediately mint a fresh pair and the revocation was moot. The endpoint now revokes the directly-paired refresh token and, when it belongs to a rotation family, the whole family (access + refresh).
- **Family revocation failures are now reported, not silently swallowed.** `revokeFamily` (the anti-replay action on detected refresh-token reuse) caught and discarded all errors; a transient DB failure during an attack would silently no-op. It now `report()`s the error while staying best-effort.
