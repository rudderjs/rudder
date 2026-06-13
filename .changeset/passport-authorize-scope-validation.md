---
"@rudderjs/passport": patch
---

Validate requested scopes when issuing an authorization code. `POST /oauth/authorize` previously passed the attacker-controlled `scopes` from the request body straight into `issueAuthCode` with no validation — the `validateScopes` check ran only on the `GET` consent handler, whose result is echoed to the UI but never enforced. A client restricted to `['read']` (or constrained by the global scope registry) could therefore mint a code, and then a token, for any scope it asked for (e.g. `['write','admin']`) simply by POSTing them. The POST handler now re-validates the requested scopes against the global registry and the client's allow-list (reusing the client already resolved for the redirect_uri re-check), and coerces a non-array `scopes` body to `[]`.
