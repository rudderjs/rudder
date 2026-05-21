---
'@rudderjs/auth': patch
---

fix(auth): `AuthMiddleware` try/finally + `EnsureEmailIsVerified` typed checks

Two fail-closed hardening fixes from the 2026-05-21 code review (`docs/plans/2026-05-21-framework-security-fixes.md`, Phases 4 + 5).

**Phase 4 — `AuthMiddleware` try/finally**

The post-`next()` sync block that mirrors session changes back onto `req.user` previously ran only on the happy path. A handler that signed the user in (or out) and then threw would skip the sync, so the downstream error renderer saw stale `req.user` — typically empty even though the session had `auth_user_id` set. Now wrapped in `try/finally`: the original handler error propagates unchanged, but the sync runs first so the error path sees the post-sign-in (or post-sign-out) state. Sync failures during the finally never mask the original throw — they're rethrown only when the handler itself succeeded.

**Phase 5 — `EnsureEmailIsVerified` hardening**

Two changes:

- **Re-resolve via the live guard.** Previously the middleware read `req.user.emailVerifiedAt` from the `userToPlain()` snapshot. The snapshot drops methods (so a `MustVerifyEmail` mixin's `hasVerifiedEmail()` is gone) and serializes whatever the column happened to be at request time. Now we call `Auth.user()` first to get the live Model instance; fall back to the snapshot only when no auth context is set or the guard returns null.
- **Type-narrow the verified-state check.** The previous `!== null && !== undefined` accepted any truthy value: the string `"false"`, the number `0`, the boolean `false`, etc. — all silently passed the gate. If a future Model lets `emailVerifiedAt` slip into a mass-assignable column (the default `fillable: []` policy enforces nothing unless opted in), attacker-supplied values become a privilege boundary. Now `isVerifiedTimestamp(v)` accepts only a real `Date` or a string `Date.parse` can consume.
- Preferred path: when the User Model implements `MustVerifyEmail`, the mixin's `hasVerifiedEmail()` is authoritative — it rules out the truthy-anything bug entirely.

**Tests** — `src/middleware-and-verification-fixes.test.ts`, 14 specs:
- AuthMiddleware: sign-in-then-throw → `req.user` populated; sign-out-then-throw → `req.user` cleared; sync failure during finally doesn't mask the original handler error.
- EnsureEmailIsVerified: accepts real `Date` + ISO string; rejects `"false"`, `0`, `false`, `""`, `null`, `"unverified"`; honors `MustVerifyEmail` returning `true`/`false`; 401 when no user resolvable.

Also: `package.json` `test` script now matches `dist-test/*.test.js` instead of hard-coding `index.test.js`, so future per-feature test files are picked up automatically.

Verified: 92 auth tests pass (78 prior + 14 new); `passport`, `sanctum`, `telescope`, `cashier-paddle` typecheck clean.
