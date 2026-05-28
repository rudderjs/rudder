---
'@rudderjs/testing': minor
---

Add Laravel-parity auth assertions to `TestCase` + an `actingAsGuest()` helper:

- **`actingAsGuest()`** — clear any acting-as user; subsequent requests run unauthenticated.
- **`assertAuthenticated()`** — passes when `actingAs(user)` is in effect.
- **`assertGuest()`** — passes when no acting-as user is set.
- **`assertAuthenticatedAs({ id })`** — passes when the acting-as user has the matching id (coerced to string for comparison).

Pairs with the matching wiring in `@rudderjs/auth` (this release) — `actingAs(user)` now actually populates `req.user`, `auth().user()`, `Auth.guard().check()`, and `RequireAuth` end-to-end in test mode.

The assertions check the test-side intent set via `actingAs` — they don't verify that a specific request authenticated end-to-end (for that, assert on the response of a follow-up request to a route that requires auth).

Found by the Phase 3 testing-ergonomics audit (cluster 2).
