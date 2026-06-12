---
"@rudderjs/sync": patch
---

Fix a sync WebSocket connection failure crashing the whole process. `wss.on('connection')` invoked the connection handler fire-and-forget (`void handleConnection(...)`), and the handler has unguarded steps before its own try/catch — room setup, the `doc.opened` observer fan-out, and message-handler wiring. A throwing observer or a synchronous setup failure there rejected the floating promise, which Node 15+ surfaces as an unhandled rejection that terminates the process, taking every connected document down with it. The handler is now wrapped so any such rejection fails closed in keeping with the rest of the sync layer: it surfaces as a `sync.error` observer event (`op: 'connection'`) and closes that one socket cleanly (code 1011) so the client retries, instead of crashing the server.
