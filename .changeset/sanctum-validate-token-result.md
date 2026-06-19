---
"@rudderjs/sanctum": minor
---

Add `validateTokenResult()` returning a discriminated union so callers can distinguish failure reasons (`'malformed'`, `'not_found'`, `'id_mismatch'`, `'expired'`, `'user_missing'`) without parsing debug logs. `validateToken()` is unchanged and still returns `null` on failure.
