---
"@rudderjs/passport": patch
---

fix(passport): return a generic `error_description` for all authorization-code exchange failures

`exchangeAuthCode()` previously returned distinct `error_description` text per failure (`"PKCE code_verifier required"` vs `"PKCE code_verifier does not match"` vs `"Authorization code has expired"`, etc.). Although the error code was already `invalid_grant` in every case, the differing descriptions let an attacker who intercepted an authorization code probe the token endpoint to learn whether the code existed or was PKCE-protected, narrowing a code-injection attempt. All authorization-code validity failures now return one generic description (`"The authorization code is invalid or has expired."`), matching RFC 6749 §5.2 and major providers (Google/GitHub/Auth0). The specific reason is preserved on `Error.message` (via a new optional `OAuthError` `logDetail` argument) so it stays available for server-side logging and the app's exception reporter, but is never serialized to the client.
