---
'@rudderjs/passport': minor
---

Device-flow at-rest hashing + progressive `slow_down` interval — closes findings P9 + M4 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`. Single Prisma migration covers both.

**M4 (RFC 8628 §6.1) — `oauth_device_codes.deviceCode` and `userCode` columns now store SHA-256 hex digests of the user-displayed strings, not the strings themselves.** `requestDeviceCode()` is the only function that ever holds the plaintext: it returns it in the response and forgets it. Every subsequent lookup (`pollDeviceCode`, `approveDeviceCode`) hashes its input before querying. A DB dump alone can no longer resume an in-flight device-flow session.

The 32-byte `device_code` is a 256-bit CSPRNG, so unsalted SHA-256 is fully sufficient. The 8-char `user_code` (~40 bits) IS reachable by an offline attacker who holds a DB dump within the 15-minute expiry window — operational mitigations (15-min expiry + api-group rate limit) keep that out of practical reach. Apps that want stronger at-rest protection can extend `grants/device-code-hash.ts` to peppered HMAC matching `client-secret.ts`.

**P9 (RFC 8628 §3.5) — On `slow_down`, the per-row polling interval is now incremented by 5 seconds.** A new `oauth_device_codes.interval` column (`Int @default(5)`) stores the current required interval; `pollDeviceCode` checks elapsed time against `device.interval * 1000` (not a fixed 5000ms) and bumps the column on every throttle event. Subsequent polls from the same misbehaving client face a strictly tighter throttle. Legacy rows persisted before this column existed read back as `null`/`undefined` and fall back to the 5-second initial interval — same compat pattern as `redirect_uri` (P1) and `familyId` (P4).

**Prisma migration:**

```prisma
model OAuthDeviceCode {
  // ...existing columns...
  // userCode + deviceCode now store SHA-256 hex digests, not plaintext.
  // RFC 8628 §3.5 polling interval (seconds). Bumps by 5 on each `slow_down`.
  interval     Int       @default(5)
}
```

In-flight device-flow sessions issued under the previous code (plaintext columns, no `interval`) won't resolve after the deploy because the new code hashes the lookup input. The 15-minute expiry naturally bounds the migration window — affected users retry once and the new flow uses hashed columns end-to-end. No manual cleanup required.

**Tests:** five regression tests in `index.test.ts` ("Device-flow at-rest hashing + interval escalation") covering the persisted hashes, the hashed lookup path on poll + approve, slow_down's interval bump (10 → 15), and the legacy-row fallback (null → 5).

CLAUDE.md "Architecture Rules" expanded with both the at-rest hashing contract and the dynamic interval behavior.
