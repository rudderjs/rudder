---
'@rudderjs/passport': patch
---

Atomic single-use consumption of authorization codes (RFC 6749 §4.1.2).

`exchangeAuthCode()` previously read the auth code, ran every check (PKCE, redirect_uri binding, client validation, expiry), and then issued an unconditional `update(id, { revoked: true })`. Two concurrent token-exchange requests with the same code each saw `revoked=false` on read, both passed every check, and both minted token pairs — violating the spec's single-use requirement.

The revoke step is now a conditional update — `where('id', id).where('revoked', false).updateAll({ revoked: true })`. The underlying SQL `UPDATE ... WHERE revoked = false` is atomic in every supported backend, so exactly one concurrent caller sees `count === 1`; the loser sees `count === 0` and throws `invalid_grant` ("Authorization code has already been used.") before reaching `issueTokens()`.

(Subsequent serial reuse of an already-consumed code keeps surfacing at the existing early-exit `if (authCode.revoked)` check — unchanged.)

Closes finding M3 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`.
