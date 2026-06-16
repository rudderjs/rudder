---
"@rudderjs/sync": minor
---

Add `createCollabRoomSeeder` to `@rudderjs/sync/collab` — first-connect record seeding for record-backed collaboration.

`SyncConfig.onFirstConnect` fires once per room, after persistence hydrates the `Y.Doc` and before the first client receives the initial state — the moment to seed an empty doc from a database record. `createCollabRoomSeeder` is the seeding counterpart to `createCollabRoomAuth`: it parses the room, resolves the backing resource, loads the record, projects it to a field map, and writes it into the doc only if the doc is still empty.

The seed resource is duck-typed (`find(id)` + `seed(record)`) — no hard `@rudderjs/orm` dependency, and one object can satisfy both builders (add `seed` alongside `find`/`canView`). The write is idempotent and race-safe (single gated `doc.transact`), fail-soft on absence (unparsed room / unresolved resource / missing record / empty projection all skip) and fail-loud on error (a `find`/`seed` throw propagates so the framework retries on the next connection). Configurable `mapName` (default `'fields'`) and transact `origin` (default `'rudder-sync-seed'`).
