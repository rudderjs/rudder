---
'@rudderjs/auth': minor
---

`BaseAuthController` now ships default rate-limits on `signIn` (10/min by IP),
`signUp` (5/min by IP), and `requestPasswordReset` (3/min by email, fall-back IP).
Override per-method via `static rateLimits` on the subclass, or set to `{}` to
disable entirely. `@rudderjs/middleware` is now a required peer (it's a core
package shipped with every scaffolded app, so installations that already use
`BaseAuthController` are unaffected). Plan: `docs/plans/2026-05-21-framework-security-fixes.md`
Phase 6.
