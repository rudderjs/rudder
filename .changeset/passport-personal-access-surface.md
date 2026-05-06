---
'@rudderjs/passport': patch
---

Personal-access surface cleanup — closes findings P10 and P11 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.

**P10 — `user.tokens()` and `user.revokeAllTokens()` now scope to the personal-access client.** Previous behavior filtered only by `userId`, so a UI listing personal access tokens (or a "log out all my dev tokens" button) included OAuth-app session tokens issued by third-party clients on the user's behalf. Both methods now add a `clientId === personalAccessClient.id` predicate via the existing `getPersonalAccessClientId()` helper. JSDoc rewritten to describe the scoping explicitly.

**P11 — `decodeToken` renamed to `unsafeDecodeToken`; old name kept as a deprecated alias.** The function decodes a JWT payload **without verifying the signature** — its output cannot be trusted for authentication decisions. The `unsafe` prefix forces a security pause when callers reach for it; the original `decodeToken` export remains as an alias (`export const decodeToken = unsafeDecodeToken`) so existing imports keep working. Boost guidelines updated to recommend the new name and document the constraint.
