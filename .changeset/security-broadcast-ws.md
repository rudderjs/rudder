---
"@rudderjs/broadcast": patch
---

Require `ws` `^8.20.1` (was `^8.0.0`) to clear a moderate uninitialized-memory-disclosure advisory. The WebSocket server API used (`WebSocketServer`, `WebSocket`) is unchanged within the 8.x line.
