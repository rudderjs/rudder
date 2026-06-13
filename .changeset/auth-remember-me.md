---
"@rudderjs/auth": minor
---

Implement "remember me" persistent login. The `remember` flag on `Auth.attempt(creds, true)` / `Auth.login(user, true)` was previously accepted but ignored — login never outlived the session cookie. It now works end to end:

- On `login(user, true)` the guard mints a 256-bit token, persists it on the user's `rememberToken` column, and (inside an HTTP request) queues a long-lived, HMAC-signed `rudderjs_remember` cookie that `AuthMiddleware` writes to the response.
- On a later request with no active session but a valid remember cookie, `AuthMiddleware` resolves the user by id, constant-time-compares the cookie token against the stored one, and re-establishes the session before the handler runs. The token is not rotated per request (it changes only on a fresh remember-login or logout), so multiple devices share it.
- `Auth.logout()` cycles the stored token — invalidating every outstanding remember cookie for that user — and deletes the cookie.
- `BaseAuthController.signIn` now reads a truthy `remember` field from the request body and threads it through.

The cookie is signed with `AUTH_SECRET` (required in production; a dev fallback with a one-time notice otherwise, matching `PasswordBroker`). The user model must expose a `rememberToken` column for persistence; apps without one keep working (remember-me is simply a no-op when the provider can't persist the token). New exports: `newRememberToken`, `encodeRememberCookie`, `decodeRememberCookie`, `rememberCookieAttrs`, and the `UserProvider.retrieveByToken` / `updateRememberToken` optional methods.
