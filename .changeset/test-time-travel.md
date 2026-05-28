---
'@rudderjs/testing': minor
---

Add Laravel-style time-travel helpers to `TestCase`, wrapping Node 22's `mock.timers`:

- **`travel(amount).milliseconds()` / `.seconds()` / `.minutes()` / `.hours()` / `.days()` / `.weeks()` / `.years()`** — advance the mocked clock by the chosen unit.
- **`travelTo(date | timestamp)`** — set the clock to an absolute moment.
- **`travelBack()`** — restore real time. Called automatically from `teardown()`.
- **`freezeTime(fn)`** — pin `Date.now()` for the duration of the callback; restores afterward when not already mocked.

The mock initializes at the real wall-clock time so `Date.now()` stays continuous across travel/restore boundaries. `setImmediate` is intentionally NOT mocked so `await new Promise(r => setImmediate(r))` still yields the event loop between travels.

Also exports a new public class `TravelBuilder` returned by `travel(amount)` for unit selection — apps can use it directly if they need lower-level access.

Found by the Phase 3 testing-ergonomics audit (cluster 6).
