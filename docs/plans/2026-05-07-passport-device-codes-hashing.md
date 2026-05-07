# Plan — P9 + M4: oauth_device_codes hashing + interval escalation

**Authors:** Claude Opus 4.7
**Date:** 2026-05-07
**Findings doc:** `docs/plans/2026-05-06-passport-surface-review-fixes.md` (P9 + M4)

Bundling P9 (slow_down interval escalation) and M4 (at-rest hashing of `deviceCode` / `userCode`) into a single PR because both touch the `oauth_device_codes` table — one Prisma migration covers both.

## Why now

- M4 is the only at-rest secret-leak surface in passport that's still plaintext after #271 (client-secret pepper) and the H-by-design note for access tokens (JWT-only). Refresh tokens and auth codes are next, tracked separately as M5/P6.
- P9 is a small RFC conformance gap (8628 §3.5 — escalate polling interval on `slow_down`). Independently low priority, but bundling avoids a second migration on the same table.

## Schema change

Two new columns on `OAuthDeviceCode`, two columns dropped:

```prisma
model OAuthDeviceCode {
  id             String    @id @default(cuid())
  clientId       String
  userCodeHash   String    @unique  // ← was `userCode` (plaintext)
  deviceCodeHash String    @unique  // ← was `deviceCode` (plaintext)
  scopes         String    @default("[]")
  userId         String?
  approved       Boolean?
  interval       Int       @default(5)  // ← NEW (P9)
  expiresAt      DateTime
  lastPolledAt   DateTime?
  createdAt      DateTime  @default(now())

  @@map("oauth_device_codes")
}
```

Decisions:
- **Rename** `userCode` → `userCodeHash` and `deviceCode` → `deviceCodeHash`, not "add new + drop old". Cleaner semantically — the column always means "the at-rest hash" — and avoids a stage where two columns coexist.
- **`interval Int default 5`** seeds existing rows during migration so legacy in-flight codes survive the schema bump.
- **`@unique`** is preserved on the hash columns. Collision probability for SHA-256 of `randomBytes(32).toString('hex')` (deviceCode) and a curated 8-char alphabet (userCode) is negligible at any realistic scale.
- The 15-minute TTL on device codes means the migration window is short — operators who run `prisma migrate deploy` during a rollout drop in-flight codes; affected devices simply re-request. Documented in CLAUDE.md.

### Migration semantics

In-flight device-code sessions are invalidated by the column rename (the original plaintext is gone, no way to reconstruct the hash). Acceptable because:
- Codes have a 15-minute TTL — natural drain window.
- Affected clients see `invalid_grant` on their next poll, which is the same shape they'd see on any other code-not-found case. They re-issue a fresh code.
- This is a one-time security-upgrade migration, not a recurring operational risk.

The CLAUDE.md "Pitfalls" entry will document this explicitly.

## Hashing helper

New `src/device-code-secret.ts`:

```ts
export async function hashDeviceSecret(plaintext: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(plaintext).digest('hex')
}
```

Plain SHA-256 (no pepper) — different threat model from client secrets:
- Device codes are random 32-byte values; user codes are 8-char from a 32-symbol alphabet (~1.1×10^12 keyspace). Both are **already** unguessable per request — hash collisions / dictionary attacks aren't relevant.
- The threat being mitigated is **DB read leak** — an attacker with `SELECT *` access shouldn't get usable codes. SHA-256 of the plaintext is sufficient: an attacker can't reverse it, and brute-force by guessing the input is no easier than guessing the original code without the DB leak.
- Pepper would help against an offline attacker who learned the column AND could test guesses against an online endpoint — but device codes are TTL-limited (15 min) and the per-IP rate limit (#279 + api-group default) prevents online brute force.

Mirrors the structure of `client-secret.ts` for consistency, minus the peppering step.

## Code touch points

### `src/grants/device-code.ts`

- **`requestDeviceCode`** — generates plaintext `deviceCode` (random 32-byte hex) and `userCode` (existing 8-char generator). Computes hashes, persists hashes only. Returns plaintext to the caller (response body). Stores `interval: 5` initially.

- **`pollDeviceCode`** — hashes `params.deviceCode` before the lookup (`where('deviceCodeHash', hashDeviceSecret(params.deviceCode))`). Reads `device.interval` instead of hardcoded 5000 for the rate-limit window. On `slow_down`, increments `device.interval` by 5 (capped at e.g. 60 to avoid runaway escalation), persists, returns the new value in the result.

- **`approveDeviceCode`** — hashes `userCode` before the lookup.

- **`DevicePollResult`** type extended:
  ```ts
  export type DevicePollResult =
    | { status: 'authorized'; tokens: IssuedTokens }
    | { status: 'authorization_pending' }
    | { status: 'slow_down'; interval: number }   // ← new field
    | { status: 'access_denied' }
    | { status: 'expired_token' }
  ```
  Cap escalation at 60 seconds — the device flow's max practical interval. RFC §3.5 doesn't specify a cap, but unbounded escalation makes the flow degenerate.

### `src/routes.ts`

The `slow_down` handler in the token-endpoint switch already returns `{ error: pollResult.status }`. Extend to forward the new interval:

```ts
} else if (pollResult.status === 'slow_down') {
  res.status(400).json({ error: 'slow_down', interval: pollResult.interval })
  return
}
```

The other error variants stay shape-compatible.

### `src/models/DeviceCode.ts`

Renames: `declare deviceCode` → `declare deviceCodeHash`; same for `userCode`. New `declare interval: number`. Update `static fillable` to match.

The model's declared property names diverge from the public API names exposed by `pollDeviceCode` / `approveDeviceCode` — the *public* parameter names stay `deviceCode` / `userCode` (the spec terms; what the client sees). Internally, we hash + look up by `*Hash`. This avoids an API break.

### `src/index.ts`

Re-export `hashDeviceSecret` (mirroring `hashClientSecret` precedent).

## Tests

New describe block `oauth_device_codes hashing + interval escalation (P9 + M4)`:

- **M4 — request/poll round trip**: `requestDeviceCode` returns plaintext; `pollDeviceCode` succeeds against the same plaintext; the underlying create call persists only the hash (capture via fake model).
- **M4 — wrong plaintext fails**: `pollDeviceCode` with a mismatched plaintext throws `invalid_grant` (lookup miss).
- **M4 — `approveDeviceCode` hashes user code**: capture the where() chain on the fake model and assert the value passed is the SHA-256 hash, not the raw user code.
- **M4 — DB row carries hash, not plaintext**: verify the `create` call captures `deviceCodeHash` / `userCodeHash` keys with hex-string values (not the original plaintext).
- **P9 — initial interval 5**: `requestDeviceCode` response shape `interval: 5`; persisted row has `interval: 5`.
- **P9 — slow_down escalates by 5**: poll twice within the window; first call returns `{ status: 'slow_down', interval: 10 }` (was 5 + 5); the model row's interval is updated.
- **P9 — escalation caps**: poll repeatedly; verify the interval stops at 60.
- **P9 — slow_down ≤ poll fast enough**: when elapsed > current interval, no slow_down.
- **route forwards interval on slow_down**: handler returns 400 + `{ error: 'slow_down', interval: 10 }`.

Tests use the existing fake-model pattern (capturing chain calls), no real DB.

## CLAUDE.md updates

- **Architecture Rules**: add an entry — "Device codes are hashed at rest (SHA-256) and looked up by hash. Plaintext is returned to the client once in the `requestDeviceCode` response and never persisted."
- **Pitfalls**: "Migrating to hashed device codes invalidates every in-flight session. The 15-minute TTL is the natural drain window — affected devices see `invalid_grant` on next poll and re-issue a fresh code. Plan rollouts accordingly."
- **Architecture Rules**: P9 entry — "`slow_down` polling interval escalates by 5 seconds per occurrence (capped at 60), per RFC 8628 §3.5. Server returns the current interval in the `slow_down` error response."

## Changeset

Single `passport: minor` — adds a new public export (`hashDeviceSecret`), changes the shape of `DevicePollResult` (additive on the `slow_down` variant — back-compat for switch-discriminated callers), schema migration that drops/renames columns. Operator-impacting; warrants the minor bump.

## Open questions / non-goals

- **No JWKS/dual-secret rollout**: any device code in flight at migration time is dropped. We don't keep both columns transiently. Documented + accepted.
- **Cap on `interval` escalation**: 60s. Could be configurable via `Passport.deviceMaxInterval()` later; deferred — not a real operator pain point yet.
- **`devicePollResult.slow_down.interval` in `routes.ts`**: forward as-is in the response body. Clients that auto-add 5 are also fine; servers' enforcement is the source of truth.
- **Device-code purge predicate** (`prunable()`): unchanged. Predicate is `expiresAt < now`; the column rename doesn't affect it.

## Test plan

1. Local: `pnpm --filter @rudderjs/passport typecheck && lint && build && test`.
2. Playground: `pnpm typecheck` (no playground change expected — passport's public API is still `deviceCode` / `userCode` parameters, not the renamed columns).
3. Smoke a fresh device flow in playground: `pnpm rudder passport:client --device "test"` → POST `/oauth/device/code` → POST `/oauth/device/approve` → POST `/oauth/token`. Verify the device code returned in step 1 is what's accepted in step 3 (proves the round-trip through the hash).
4. Smoke `slow_down`: poll twice in quick succession; verify the response body carries `interval: 10` on the second call.
