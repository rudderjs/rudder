---
"@rudderjs/auth": patch
---

Fix a stray `[RudderJS Auth]` prefix on the `requestPasswordReset` no-broker warning — it was missed by the framework-wide `[RudderJS]` -> `[Rudder]` rename because the two changes merged in an interleaved order. The warning now uses `[Rudder Auth]` like every other auth log line.
