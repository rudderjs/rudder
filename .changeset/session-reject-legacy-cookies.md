---
"@rudderjs/session": minor
---

Add a `rejectLegacyCookies` cookie-driver option. The cookie driver signs an absolute `exp` into each payload, but an HMAC-valid cookie minted before that hardening carries no `exp` and was previously accepted unconditionally, leaving a captured copy replayable forever (the stateless cookie driver has no server-side kill switch). The new option (default `false` for a backward-compatible migration window) treats an exp-less cookie as expired once enabled, while leaving cookies that carry an `exp` unaffected so turning it on does not log anyone out. Recommended to enable a full `lifetime` after deploying the `exp` hardening. No effect on the redis driver.
