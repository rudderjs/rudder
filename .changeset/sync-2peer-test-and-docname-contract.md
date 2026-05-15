---
"@rudderjs/sync": patch
---

Document the WS `docName` URL contract on `SyncConfig.path` and add a multi-peer broadcast regression test.

- **JSDoc** on `SyncConfig.path` now spells out that the room key (`docName`) is extracted as the **last non-empty path segment** of the connection URL, after stripping the query string. Consumers with composite room ids must flatten with a non-slash separator before mounting — otherwise distinct logical rooms with the same trailing segment collide into one shared `Y.Doc`.
- **Inline comment** added on `handleConnection`'s docName extraction documenting the same rule plus the collision implication.
- **Two new tests** in `packages/sync/src/index.test.ts` (`Multi-peer WS broadcast` suite):
  - `forwards an update from peer A to peer B in the same room` — drives `_handleConnection` with mock WS sockets, encodes a real Yjs syncUpdate frame, verifies the originator is skipped and the other peer receives it.
  - `isolates broadcasts: peers in different rooms do not see each other` — defensive negative test for the room-collision class of bug.

No behavior change. Filed alongside `docs/plans/2026-05-15-sync-ws-multi-peer-diagnostic.md` from pilotiq agent — answers the three open questions in the plan's "Rudder-side response" section.
