---
'@rudderjs/passport': patch
---

Docs: explain why access tokens are JWT-only with no DB hash column (matches
Laravel Passport; signature is the secrecy boundary, not a stored hash) and
add CLAUDE.md "Pitfalls" entries for the two surfaces reviewers most often
miss — RSA keypair rotation invalidating every live JWT, and the device-flow
verification URI defaulting to request `Host`/`X-Forwarded-Host` when
`verificationUri` isn't configured.
