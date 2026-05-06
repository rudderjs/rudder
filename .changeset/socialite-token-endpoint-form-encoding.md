---
'@rudderjs/socialite': patch
---

Fix OAuth token endpoint encoding — `SocialiteDriver.getAccessToken()` now sends `application/x-www-form-urlencoded` per RFC 6749 §4.1.3 instead of `application/json`. GitHub, Google, and Facebook reject (or inconsistently accept) JSON bodies on `/token`, which made every non-Apple login fragile or fully broken depending on the provider's mood. Apple's driver already overrode this and is unchanged.

No API change for callers — the public `getAccessToken(code)` signature and return shape are identical.
