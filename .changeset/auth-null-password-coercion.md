---
"@rudderjs/auth": patch
---

fix(auth): `getAuthPassword()` returns `null` for an absent password column instead of coercing to `""`

`toAuthenticatable()` returned `String(record.password ?? '')`, collapsing a NULL/absent password column (OAuth-only, SSO, invited-not-yet-set accounts) into the empty string. That erased the distinction between "no password set" and "password is the empty string", so a third-party `UserProvider` checking `hashed.length > 0` instead of `!hashed` could proceed to a hash comparison against an empty stored hash and fail open. `getAuthPassword()` now returns `null` for a null/undefined column and the `Authenticatable.getAuthPassword()` contract return type widens to `string | null`. The built-in `validateCredentials` no-password guard (`!hashed`) is unchanged and already rejected this case.
