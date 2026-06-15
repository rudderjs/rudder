---
"@rudderjs/sync": minor
---

Add `createCollabRoomAuth`, a record-backed collaboration authorization builder at `@rudderjs/sync/collab`. It returns a `SyncConfig['onAuth']` handler that gates each WebSocket upgrade against the record behind the room — parse the room id, resolve the authenticated user, load the record, apply a `canView` policy — closing the collab IDOR where every `resource:recordId` room is otherwise world-open. The record contract is duck-typed (`find` + `canView`), so it stays adapter-agnostic with no hard `@rudderjs/orm` dependency. Fail-closed at every gap, with optional builder-wide or per-resource guest admission. Also exports `SyncAuthRequest` (the `onAuth` request shape) and `defaultParseCollabRoom`.
