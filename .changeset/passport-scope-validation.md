---
'@rudderjs/passport': patch
---

Validate requested OAuth scopes against the global registry and per-client allow-list (RFC 6749 §3.3).

Previously, `validateAuthorizationRequest`, `clientCredentialsGrant`, and `requestDeviceCode` accepted arbitrary scope strings — including scopes the operator never declared and scopes outside a client's configured allow-list. Tokens were minted with whatever the user approved, so `scope('admin')` middleware checks could be bypassed by a client requesting an undeclared `admin` scope.

The three grants now run a shared `validateScopes(client, requested)` gate that throws `OAuthError('invalid_scope', ...)` when a requested scope is not registered globally via `Passport.tokensCan({...})` or is outside the client's `scopes` allow-list. Each gate is only enforced when populated:

- Empty global registry → no global gate (back-compat with apps that haven't called `tokensCan`).
- Empty `client.scopes` → no per-client gate (the common case — most clients are unrestricted).
- The `*` wildcard always passes, matching `Passport.validScopes()` semantics.

The refresh-token grant already has its own narrowing logic (request scopes can only be a subset of the original token's) and is unchanged.

`validateScopes` is exported for apps that build their own grant pipeline.

Closes finding E6 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.
