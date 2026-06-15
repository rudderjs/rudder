---
"@rudderjs/auth": minor
---

Add `verifyEmailFromRequest(req, findUser)` - a safe-by-default email-verification helper that validates the signed-URL signature itself before matching the email hash and marking the user verified.

The email hash in a verification link is an unkeyed `sha256(email)`, which anyone who knows a target's email can compute, so the only thing that makes a verification link unforgeable is the URL signature (the `APP_KEY` HMAC). The existing `handleEmailVerification(id, hash, ...)` trusts the route to have validated that signature via `ValidateSignature()` middleware; a route that forgets the middleware makes verification forgeable for any known email. `verifyEmailFromRequest` validates the signature itself and fails closed regardless of middleware wiring (Laravel `EmailVerificationRequest` parity). `handleEmailVerification` is unchanged and still available, with a doc note pointing to the safer helper.
