---
'@rudderjs/sync': minor
---

feat(sync): collaborative row-array binding (repeatable rows with stable identity + reorder)

Add a row-array collab binding for an **array of records** (a repeater, an editable table, a list of objects), the case the existing `scalar` / `text` / flat-`array` / `map` field bindings don't cover. It decouples data from order across two shares: `row-data` (`Y.Map<arrayName, Y.Map<rowId, Y.Map<field, value>>>`) holds each row keyed by a stable id (a generated UUID, or a DB primary key you pass in), and `row-order` (`Y.Map<arrayName, Y.Array<rowId>>`) holds the sequence. A row map is attached once and never moves, so a reorder only delete+inserts the plain `rowId` string in the order array. That stays lossless, where a naive delete+insert of an array of objects would throw away the moved row's per-field merge history. Non-text values use whole-value LWW. Both shares live in the same `Y.Doc` as the field bindings, so they persist over the existing transport with no schema or server change.

`@rudderjs/sync/collab` exports framework-free primitives: `readRows` / `readRow`, `addRow`, `removeRow`, `moveRow`, `setRowField` / `updateRow`, `seedRows`, `observeRows`, `newRowId`. `@rudderjs/sync/react` adds `useCollabRows(room, arrayName)`, the row counterpart to `useCollabField`: it returns the rows in order plus a referentially-stable `{ add, remove, move, setField, update }` mutation API, and re-renders on any add / remove / reorder / field edit.
