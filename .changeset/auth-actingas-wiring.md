---
'@rudderjs/auth': minor
---

Wire `actingAs(user)` from `@rudderjs/testing` through `AuthMiddleware` so authenticated integration tests actually authenticate.

In test mode (`APP_ENV=testing`), `AuthMiddleware` now reads the `x-testing-user` header that `@rudderjs/testing` writes via `TestCase.actingAs(user)` and installs the user into a request-scoped ALS via `runWithTestUser(user, ...)`. `SessionGuard.user()` checks this override BEFORE the session/provider lookup — so `req.user`, `auth().user()`, `Auth.guard().check()`, and `RequireAuth` all resolve to the synthetic user, even one that doesn't exist in the database.

Production is unaffected: the test-mode branch is gated on `process.env.APP_ENV === 'testing'`. The new `runWithTestUser` / `currentTestUser` helpers are exported for completeness; outside test mode they incur no cost.

**Before this change**, `TestCase.actingAs(user)` wrote the header but no middleware read it — `req.user` was empty and any route guarded by `RequireAuth` (or that called `auth().user()`) failed in tests.

Found by the Phase 3 testing-ergonomics audit (cluster 2).
