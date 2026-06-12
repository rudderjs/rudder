---
"@rudderjs/sanctum": patch
---

fix(sanctum): honor the `expiration` config as a global token lifetime

`SanctumConfig.expiration` was a declared, documented config field (token lifetime in minutes) that the guard never read — only a per-token `expiresAt` was enforced, so setting `expiration` did nothing.

`validateToken()` now rejects a token once it is older than `expiration` minutes (measured from its `createdAt`), matching Laravel Sanctum's global-expiration semantics. A per-token `expiresAt` passed to `createToken()` remains an explicit override that always wins; with neither set, tokens never expire. A non-positive `expiration` (`0` or negative) is treated as no global expiry.

Behavior change: apps that already set a positive `expiration` and relied on it being a no-op will now see tokens expire on schedule. The expiry logic is centralized in a new public `Sanctum.isExpired(token)` helper.
