---
"@rudderjs/ai": patch
---

Updated internal calls to `broadcast()` to await its now-async signature (`@rudderjs/broadcast` minor in this release). `BroadcastFn` type widened to `(...) => void | Promise<void>` so streaming jobs that broadcast each chunk back-pressure on the driver round-trip (Redis fan-out) rather than racing ahead.

No public API change — `agent.queue(...).broadcast(channel)` works exactly as before from app code.
