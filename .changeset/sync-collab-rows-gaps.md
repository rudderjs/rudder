---
"@rudderjs/sync": minor
---

feat(sync/collab): add four row-array primitives blocking clean adoption

Adds the missing building blocks for consumers who need to drive a
granular, re-keyable repeater binding entirely on `@rudderjs/sync/collab`
without app-side snapshot-diffing, per-call id shims, or hand-rolled
re-key logic. All four additions are additive; existing API unchanged.

1. `observeRowChanges(doc, arrayName, cb)` - emits granular
   `{ kind: 'add'|'remove'|'move', ... }` lifecycle events instead of a
   full-snapshot callback. A move is correctly coalesced from the
   underlying delete+insert pair in one transaction.

2. `renameRow(doc, arrayName, oldId, newId, opts?)` - re-keys a row from
   a client UUID to a server DB primary key in one transaction. Clones
   field values into a fresh `Y.Map` and swaps the order-array entry.
   Fail-safe on `oldId===newId`, unknown `oldId`, and `newId` collision.

3. `addRow` / `seedRows` now accept `{ mirrorId?: boolean, idKey?: string }`
   to write the row's stable id into the row map itself (e.g. under
   `'__id'`), making it available in `readRows` values and over the wire.
   `readRows` / `readRow` accept `{ idKey?: K }` to project the stable id
   under a custom key instead of the default `'id'`.

4. `ensureRowArray(doc, arrayName, opts?)` - pre-allocates the order and
   data shares for an array without seeding any rows, closing the
   concurrent-first-`addRow` race on brand-new docs.
