---
"@rudderjs/ai": patch
---

Wire `agent.queue()` / `.broadcast()` to Rudder's queue and broadcast. The AI engine (`@gemstack/ai-sdk@0.5.0`) no longer imports `@rudderjs/queue` / `@rudderjs/broadcast` itself; instead `AiProvider.boot()` now registers them via the engine's new `configureAiQueue({ dispatch, broadcast })` seam. Both stay optional peers: when `@rudderjs/queue` is installed, queued AI jobs dispatch through it, and when `@rudderjs/broadcast` is also installed, streaming jobs push progress to a channel. No app change for Rudder users; queued agents keep working across the engine upgrade.
