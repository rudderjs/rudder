---
"@rudderjs/orm": minor
---

Native engine Phase 2 — the SQLite write path at `@rudderjs/orm/native`.

Implements the write terminals on `NativeQueryBuilder` (previously throwing `NativeNotImplementedError`), compiling parameterized DML via the existing Dialect/Driver seams:

- `create(data)` → `INSERT … RETURNING *`; `update(id, data)` → `UPDATE … WHERE pk = ? RETURNING *`
- `updateAll(data)` / `deleteAll()` → bulk DML; affected count from `RETURNING *` rows
- `delete(id)` (soft-delete-aware — stamps `deletedAt` when enabled, else hard `DELETE`), `restore(id)`, `forceDelete(id)`
- `insertMany(rows)` → batched multi-row insert
- `increment` / `decrement(id, col, amount, extra?)` → atomic `SET col = col ± ?` (no observer events — pure data-plane)

Every value is bound; identifiers are validated + quoted. Affected-row counts come from `RETURNING *` (`rows.length`), so the `Driver` result shape stays `Row[]` — no driver metadata (`changes`/`lastInsertRowid`) is read.

**Transaction-aware by construction (no public API yet):** the `Driver` interface gains `transaction(fn)` yielding a transaction-scoped `Executor`, and the query builder runs writes through an `Executor` rather than the top-level connection. This lets the Phase-4 public `transaction()` API slot in without a refactor. `BetterSqlite3Driver` implements it with `BEGIN`/`COMMIT`/`ROLLBACK`.

Also fixes a Phase-1 issue: `NativeAdapter.disconnect()` now evicts the cached `globalThis` client so a later `make()` with the same `driver::url` signature opens a fresh driver instead of reusing the closed one.

Conformance: the write + soft-delete slices of the `@rudderjs/orm` Model suite run green against the native engine + in-memory `better-sqlite3` (`native-write.test.ts`); `compiler-write.test.ts` covers INSERT/UPDATE/DELETE/increment SQL shape, bindings, and identifier safety.
