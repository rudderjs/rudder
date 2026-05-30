# GATE A — Contract sufficiency review (native ORM, read path)

> Outcome of Phase 1 of `docs/plans/2026-05-30-native-orm-adapter.md`. Question:
> did building the **read** path against a real driver surface anything the
> `QueryBuilder` / `OrmAdapter` contract can't express, or anything the adapter
> needs from the Model layer that isn't there?

## Summary

**The contract was sufficient for the entire read path with zero changes.** The
native `SqliteDialect` engine implements `OrmAdapter` / `QueryBuilder<T>`
(`packages/contracts/src/index.ts`) as-is. The dialect-agnostic `@rudderjs/orm`
Model suite drove `find` / `first` / `get` / `all` / `count` / `paginate`,
`where` / `orWhere`, `whereGroup` / `orWhereGroup` (Laravel precedence),
operators, ordering, limit/offset, soft deletes, and read-time casts against a
real in-memory `better-sqlite3` — all green, no contract edits.

## What worked cleanly (no contract pressure)

- **`OrmAdapterQueryOpts.primaryKey`** threading was enough to support `find`
  on a configurable PK without any new surface.
- **Soft deletes** ride entirely on the existing `_enableSoftDeletes()` +
  `withTrashed()` / `onlyTrashed()` markers the Model layer already calls; the
  adapter resolves them to `deletedAt IS [NOT] NULL`. No new method needed.
- **`whereGroup` / `orWhereGroup`** map directly to a parenthesized condition
  tree. Laravel's `(AND-group) … OR …` precedence (orm-prisma #597) is
  expressible from the flat `boolean: 'AND' | 'OR'` connector per clause — no
  richer AST had to leak into the contract.
- **Hydration** is owned by the Model proxy; the adapter returns plain rows and
  everything (`instanceof`, casts, dirty tracking) worked unchanged.
- **`paginate`** returns the existing `PaginatedResult<T>` envelope verbatim.

## Confirmed gaps (expected; not blockers for Phase 1)

1. **Transactions are absent from the contract entirely.** `OrmAdapter` has only
   `query` / `connect` / `disconnect`; there is no `transaction<T>(fn)` /
   savepoint surface — and none of the three adapters (prisma/drizzle/native)
   expose one today. This is the one cross-cutting addition the write path
   (Phase 2) and Phase 4 will need. **Decision required at this gate** (open
   question #3 in the plan): add `transaction<T>(fn)` to the shared `OrmAdapter`
   contract for all adapters at once, or scope it native-only behind a
   capability flag. Recommendation: design it once on the shared contract in
   Phase 4 as planned; the read path does not need it.

2. **No structural metadata about the *table* reaches the adapter** — only the
   table name, primary key, and per-query clauses. The read path doesn't need
   column types (SQLite is dynamically typed and the Model cast layer handles
   coercion on read), but the **write path** will want to know which columns
   exist / are auto-increment to build `INSERT ... RETURNING` precisely. This is
   adapter-internal (schema introspection or a `create` that trusts the payload)
   — it does **not** imply a contract change. Flagging for Phase 2 design.

3. **`limit`/`offset` are inlined, not bound.** SQLite (and others) don't bind
   `LIMIT`/`OFFSET` cleanly across all builds, so the compiler inlines them
   after `Number.isInteger` + range validation. This is a compiler-internal
   choice, not a contract gap, but worth recording: the "everything is a bound
   parameter" rule has exactly one audited exception (integer literals that
   never carry user strings).

## Net

No contract changes were required to ship the read path. The single genuine
contract addition on the horizon is **transactions**, which is already scheduled
for Phase 4 and is the explicit GATE-A decision to make before the write path.
Proceeding to Phase 2 is unblocked once that decision is recorded.
