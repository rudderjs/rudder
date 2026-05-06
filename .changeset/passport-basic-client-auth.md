---
'@rudderjs/passport': patch
---

Support HTTP Basic client authentication at `/oauth/token` (RFC 6749 §2.3.1).

The token endpoint now accepts client credentials via `Authorization: Basic base64(client_id:client_secret)` in addition to the existing body-param flow. Most off-the-shelf OAuth SDKs (Auth0, Okta, oauth2-proxy, etc.) default to Basic, so apps were forced to fork SDK config to opt into body-param mode. Per RFC §2.3.1 servers MUST support Basic; this fix closes the spec gap.

**Conformance details (RFC 6749 §2.3):**

- Basic prefix is matched case-insensitively (RFC 7235 §2.1).
- Sending credentials in BOTH the header AND body is rejected with `invalid_request` — the spec forbids it. Both `client_secret` collision and a `client_id` mismatch are detected.
- Malformed Basic (no colon, undecodable base64) returns `invalid_request`.
- Missing `client_id` (no header, no body) now returns `invalid_request` 400 instead of producing the misleading "Client not found" via the database lookup.
- The `client_credentials` grant now surfaces missing `client_secret` as `invalid_request` 401 (the grant is confidential-only by spec).

Closes finding E9 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.
