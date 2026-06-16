---
"@rudderjs/sync": minor
---

Add client-side collab presence to `@rudderjs/sync/react`.

The React layer managed the Y.Doc + WebSocket lifecycle but exposed nothing for presence/awareness, so every consumer re-derived the same Yjs gotchas. This adds the client mirror of the server-side awareness helpers:

- **Auth-denial reconnect-stop.** `useCollabRoom` / `CollabRoomManager` now detect a WS close with an auth-denied code (4401/4403 from the server's `onAuth` gate), disconnect instead of letting y-websocket reconnect ~10x/second, and return a `null` room. A new `onDenied` option on `useCollabRoom` surfaces the verdict so the UI can tell "denied" apart from "still connecting".
- **`useCollabPresence(room, user)`** mirrors the local `{ name, color }` onto awareness, with `collabColorFromSeed(seed)` deriving a deterministic `#rrggbb` color (hex, because Tiptap's CollaborationCaret rejects `hsl(...)`).
- **`useReportAwarenessField(room, key, value)`** writes a value into local awareness (clearing on change/unmount); **`useAwarenessField(room, key)`** reads remote peers holding a non-null value for that key (local excluded, deduped, `queueMicrotask`-deferred, re-rendering only on a real change). **`useFieldPresence(room, fieldName)`** is the convenience for per-field "who's editing this".
- `computeAwarenessPeers` is exported as a pure, testable reducer.
