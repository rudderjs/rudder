---
"@rudderjs/support": patch
"@rudderjs/auth": patch
"@rudderjs/session": patch
"@rudderjs/core": patch
---

Consolidate duplicate `parseCookie`/`parseCookies` helpers into `@rudderjs/support`

Three independent cookie-header scanning implementations existed across `auth`, `session`, and `core`. Any RFC 6265 edge-case fix would need to be applied in all three places. Moved both helpers to `@rudderjs/support` as named exports; all three packages now import from there. `parseCookie` remains re-exported from `@rudderjs/auth`'s `remember` module for backward compatibility.
