---
'@rudderjs/passport': patch
---

fix(passport): atomic claim on refresh-token + device-code grants

Two paired OAuth grant races closed by mirroring the auth-code grant's atomic-update pattern. Both were RFC 6819 §5.2.2.3 violations — concurrent requests could each succeed at exchanging a single grant for token pairs.

**Refresh-token grant** (`grants/refresh-token.ts`)

Previously: read the row → check `revoked === false` → unconditionally flip `revoked = true` → issue tokens. Two concurrent refreshes both passed the read-time check, both flipped revoked (the second's flip was idempotent), and both minted new access+refresh pairs. The family-reuse detector at the top of the grant never fired because both saw revoked=false.

Now: conditional `updateAll({ revoked: true })` with `.where('id', rt.id).where('revoked', false)` returns the affected row count. Exactly one of N concurrent calls sees count=1 and proceeds to issue. The rest see count=0, treat it as reuse, and revoke the rotation family.

**Device-code polling** (`grants/device-code.ts`)

Previously: read the row → check `approved === true` (in-memory snapshot) → issue tokens → delete row. Two concurrent polls of the same approved code both passed the in-memory check, both called `issueTokens`, both then deleted (idempotent). Result: one user approval minted two token pairs.

Now: `.where('id', device.id).where('approved', true).deleteAll()` returns the affected row count. The winner proceeds; losers throw `invalid_grant` "Device code has already been used." — consistent with the auth-code grant's surface. The in-memory `device` snapshot is reused to issue tokens since the row is now gone from the DB.

Regression tests: two new tests via `Promise.allSettled`, each runs two concurrent grants against the same opaque token / device code, asserts exactly one fulfilled + one rejected, exactly one new token pair minted (no double-issue).
