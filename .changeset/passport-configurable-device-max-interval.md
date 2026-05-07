---
'@rudderjs/passport': minor
---

Configurable cap on device-flow `slow_down` interval escalation.

The 60-second cap on `oauth_device_codes.interval` (added in #282) was hardcoded. RFC 8628 §3.5 doesn't specify a cap, so the value was a judgement call — fine for human-in-the-loop flows but constraining for niche cases (machine-only daemons, integration tests that want shorter ceilings, or apps that want to back misbehaving clients off more aggressively).

The cap is now operator-tunable:

```ts
// programmatic
import { Passport } from '@rudderjs/passport'
Passport.deviceMaxInterval(120) // bump to 2 minutes

// via PassportConfig in config/passport.ts
export default {
  // ...
  deviceMaxInterval: 120,
} satisfies PassportConfig
```

**Default unchanged at 60 seconds.** Values below 5 are clamped to the 5s floor — the initial polling interval — because the escalation step is 5s and a cap below that would prevent any escalation from taking effect. Fractional values are floored.

**New API:**
- `Passport.deviceMaxInterval(seconds: number)` — setter, with floor + flooring as above.
- `Passport.deviceMaxIntervalSeconds()` — getter.
- `PassportConfig.deviceMaxInterval` — config-layer plumbing in `bootstrap/providers.ts` flow.

`pollDeviceCode` now reads `Passport.deviceMaxIntervalSeconds()` instead of a module-level constant. The existing P9 regression test ("escalation caps at 60s") still passes — the default behavior is unchanged.

**Tests:** eight new regression tests under "Passport.deviceMaxInterval — configurable cap on slow_down escalation" covering: default, setter override, floor clamp, fractional floor, reset semantics, escalation past 60s with raised cap, escalation halting at lowered cap, and the boot-integration setter/getter round-trip.

CLAUDE.md "Device codes rate-limited" Architecture Rule updated to mention the configurability.
