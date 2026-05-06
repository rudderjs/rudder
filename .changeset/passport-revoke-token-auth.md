---
'@rudderjs/passport': patch
---

Require bearer auth + ownership on `DELETE /oauth/tokens/:id`. Previously the revoke endpoint had no auth check at all, so any unauthenticated request could revoke any token by id — and token ids appear in JWT `jti` claims (semi-public), so anyone with a single captured JWT could DoS arbitrary users by revoking their tokens. Now: requires `RequireBearer()`, then checks `token.userId === requester.id`. Returns 404 (not 403) on ownership mismatch to avoid leaking whether a given id exists.
