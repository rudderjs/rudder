---
"@rudderjs/passport": patch
---

Make the device-flow polling rate-limit (RFC 8628 §3.5 `slow_down`) atomic. The interval check read `lastPolledAt` into a snapshot and then wrote it back in a separate statement, so two concurrent polls could both read a stale value and both slip past the gate, and a throttled poll's back-off clock didn't anchor to the last allowed poll. The check and the `lastPolledAt` advance are now a single conditional UPDATE: exactly one of N concurrent polls matches and proceeds, the rest are told to `slow_down`, and the window always measures from the last poll that was actually allowed. The first poll (no prior `lastPolledAt`) is still never throttled.
