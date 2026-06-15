---
"@rudderjs/auth": patch
---

Security hardening of the authentication and authorization surface (deep audit follow-up).

- **`Gate` policy methods can no longer resolve to an inherited `Object.prototype` member.** The gate looked up a policy ability with a bare `policy[ability]`, so when the ability name collided with an inherited member (`toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`), it called that function and treated its truthy result as "allowed" - granting access for any authenticated user against any model with a registered policy. Both gate paths (`Gate.allows` and `Gate.forUser(...).allows`) now resolve the method only from the policy instance's own properties and its prototype chain up to (but excluding) `Object.prototype`; anything inherited from `Object.prototype`, plus the reserved `constructor`/`__proto__`, resolves to a deny. `GateForUser` also now denies a null principal up front, matching `Gate.allows`.

- **A password reset now cycles the user's "remember me" token (Laravel parity).** A reset is a security event - typically because the account is suspected compromised - but the broker previously only updated the password, leaving any persistent-login cookie captured before the reset valid for its full lifetime. `PasswordBroker.reset` now rotates the stored remember token after a successful reset, invalidating every outstanding remember cookie. Best effort: it is a no-op when the user model has no remember-token column and never fails an otherwise-successful reset.

- **A row with an empty/missing password hash can no longer authenticate by password.** `EloquentUserProvider.validateCredentials` fed the stored hash straight to the verifier, so an OAuth-only / SSO / not-yet-set account (empty `password` column) depended entirely on the hasher's behavior for an empty digest - a no-op on bcrypt, a throw on argon2, and a potential bypass on a lax custom hasher. It now rejects an empty stored hash explicitly, while still running a dummy verify so the "account has no password" case cannot be told apart from "wrong password" by response latency.

- **The password-reset rate-limit key is normalized.** The default limiter keyed on the raw submitted email, so `Victim@x.com`, `victim@x.com`, and ` victim@x.com ` were three separate buckets - letting an attacker multiply the per-account budget against one inbox by varying case/whitespace. The key is now trimmed and lowercased.
