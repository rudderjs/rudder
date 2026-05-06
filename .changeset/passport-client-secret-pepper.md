---
'@rudderjs/passport': patch
---

Hash OAuth client secrets with an `APP_KEY`-derived HMAC pepper when set.

`passport:client` (and `createClient()`) now stores confidential client
secrets as `peppered:<HMAC-SHA256(secret, APP_KEY)>` when `APP_KEY` is
configured, falling back to plain SHA-256 when it isn't. The `peppered:`
prefix makes the format self-describing per row, so existing plain-SHA-256
secrets keep verifying after the operator sets `APP_KEY` — no migration step.

A leaked DB dump alone can no longer be brute-forced offline against
candidate secrets without `APP_KEY`. New helpers `hashClientSecret()` and
`verifyClientSecret()` are exported for apps that issue or verify client
secrets outside the standard CLI/grant paths.

Note: rotating `APP_KEY` invalidates every peppered client secret. Plan
rotations as a coordinated re-issuance window — see
`packages/passport/CLAUDE.md` "Pitfalls" for the full caveat.
