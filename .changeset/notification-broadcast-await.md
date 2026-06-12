---
"@rudderjs/notification": patch
---

Await the broadcast publish round-trip in the notification broadcast channel. `BroadcastChannel.send()` called `broadcast()` without awaiting it, so `Notifier.send()` resolved before a Redis-backed broadcast was actually dispatched, and a rejecting driver surfaced as an unhandled rejection instead of propagating to the caller. The channel now awaits the call, matching the documented `Promise<void>` contract.
