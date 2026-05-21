---
'@rudderjs/auth':       minor
'@rudderjs/middleware': patch
---

**@rudderjs/auth** — `BaseAuthController` now ships default rate-limits on
`signIn` (10/min by IP), `signUp` (5/min by IP), and `requestPasswordReset`
(3/min by email, IP fallback). Override per-method via `static rateLimits`
on the subclass, or set to `{}` to disable entirely. `@rudderjs/middleware`
is now a required peer (it's a core package shipped with every scaffolded
app, so installations that already use `BaseAuthController` are unaffected).

**@rudderjs/middleware** — `RateLimit` instances now namespace their cache
key per-handler so siblings keyed by the same identifier don't share a
bucket. Before: `m.web(RateLimit.perMinute(60))` and a route-scoped
`RateLimit.perMinute(5)` keyed by IP both wrote to `rudderjs:rl:<ip>`, so 5
unrelated web-group GETs would drain the route-scoped limiter's quota. Now
each handler instance owns its own bucket; a shared handler reference
(`m.web(myLimiter)` applied to multiple routes) still shares a bucket as
expected. Load-bearing for the Phase 6 default rate-limits above —
surfaced by the scaffolder render E2E.

Plan: `docs/plans/2026-05-21-framework-security-fixes.md` Phase 6.
