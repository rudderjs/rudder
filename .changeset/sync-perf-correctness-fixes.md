---
'@rudderjs/sync': patch
---

Fix four issues in the sync package:

- `syncPrisma`: add an in-memory `docCache` so `getYDoc` no longer re-fetches and replays all stored update rows from the database on every call; `storeUpdate` keeps the cache warm and `clearDocument` evicts the entry.
- `encodeSyncMsg`: encode `subType` as a proper varint (via `writeVarUint`) instead of a raw single byte, matching the y-protocols wire format for correctness when `subType ≥ 128`.
- `encodeAwarenessRemoval`: hoist `TextEncoder` and the `NULL_JSON` constant to module scope to avoid repeated allocations on the disconnect hot path.
- `handleConnection`: fix a race condition where concurrent connections to the same `docName` could both pass the `!fired.has(docName)` check and invoke `onFirstConnect` twice; subsequent callers now await the in-flight promise rather than re-entering the hook.
