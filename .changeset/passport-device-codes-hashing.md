---
'@rudderjs/passport': minor
---

Hash device codes at rest + escalate `slow_down` polling interval — closes findings P9 and M4 from `docs/plans/2026-05-06-passport-surface-review-fixes.md`. Bundled because both touch the same `oauth_device_codes` table; one Prisma migration covers both.

**M4 — at-rest hashing of `deviceCode` and `userCode`** (RFC 8628 §6.1).

`oauth_device_codes` columns renamed: `userCode` → `userCodeHash`, `deviceCode` → `deviceCodeHash`. The plaintext is generated and returned once in the `/oauth/device/code` response body; only SHA-256 hashes are persisted. `pollDeviceCode` and `approveDeviceCode` hash their plaintext input before lookup, so a DB read leak no longer yields usable codes that an attacker could replay.

New helper exported from `@rudderjs/passport`: `hashDeviceSecret(plaintext)`. Plain SHA-256 (no pepper) is sufficient because device codes are already unguessable per request — the threat is DB read leak, not pre-image attack on a chosen plaintext. See `device-code-secret.ts` for the longer-form rationale.

Public API of `pollDeviceCode({ deviceCode })` and `approveDeviceCode(userCode, ...)` is unchanged — both still take **plaintext**, hash internally, and look up by hash. RFC 8628 wire format (`device_code` / `user_code` parameters) is unchanged.

**P9 — `slow_down` polling interval escalates per RFC 8628 §3.5.**

New `interval Int @default(5)` column on `oauth_device_codes` tracks the per-row polling interval. On each `slow_down` response, the server increments by 5 seconds (capped at 60). The new interval is forwarded in the `slow_down` error body so well-behaved clients can adopt it directly:

```json
{ "error": "slow_down", "interval": 10 }
```

The `DevicePollResult` type's `slow_down` variant gains an `interval: number` field — additive on the discriminated union, so existing switch-discriminated callers stay shape-compatible.

**Migration impact**

The column rename is **destructive for in-flight device-code sessions** — the original plaintext is gone, and SHA-256 is one-way, so existing rows can't be migrated. The 15-minute TTL on device codes is the natural drain window: any device that requested a code before `prisma migrate deploy` runs sees `invalid_grant` on its next poll and re-issues a fresh code. Plan rollouts for a low-traffic window. One-time migration; not a recurring concern.

CLAUDE.md Architecture Rules + Pitfalls updated. Findings doc covers the bundled migration in the "Recommended PR strategy" section.
