---
"@rudderjs/sync": patch
---

fix(sync): enforce the `onAuth` callback on WebSocket connections

`SyncConfig.onAuth` was declared, documented, and unit-tested in isolation — but the server never invoked it. Every WebSocket upgrade joined its room based on the URL path alone, so multi-tenant apps that supplied `onAuth` to scope collab rooms per user were silently unprotected: any reachable client could read **and** write any document's `Y.Doc` by guessing its room id (an IDOR across the entire sync surface).

`onAuth` now runs in `handleConnection` **before** the socket joins the room, fires the first-connect seed (which reads the backing DB row), or is sent any state vector — so a denied client observes nothing. Enforcement is fail closed: a `false` return, a thrown error, or a rejected promise all deny, closing the socket with WS code 4401. The callback receives the same resolved `docName` the room join uses (shared extraction), preventing authorize-one-room / join-another divergence. Apps that don't set `onAuth` are unaffected (connections remain open to all, as before).
