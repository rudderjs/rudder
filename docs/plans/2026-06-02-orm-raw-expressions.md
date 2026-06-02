# PR7 — ORM raw expressions (`DB.raw` / `selectRaw` / `whereRaw` / `orderByRaw`)

**Date:** 2026-06-02
**Branch:** `feat/orm-raw-expressions`
**Arc:** `@rudderjs/database` extraction — query-builder breadth (gap doc §2 "Raw expressions" row).
Follows PR1–PR6 (transaction, eager-with, upsert, chunk/lazy, cursorPaginate).

## Goal

Add a raw-SQL escape hatch to the query builder — the last large capability gap in §8's
query-builder list. Laravel parity surface:

- `DB.raw(sql)` → `Expression` (already exists; thread it through the compiler)
- `qb.selectRaw(sql, bindings?)` — raw projection (introduces SELECT projection on native)
- `qb.whereRaw(sql, bindings?)` / `qb.orWhereRaw(sql, bindings?)` — raw WHERE fragment
- `qb.orderByRaw(sql, bindings?)` — raw ORDER BY
- `DB.raw(...)` accepted in `where(col, op, raw(...))` (value) and `orderBy(raw(...))` (column)

**Out of scope (→ PR8):** the named `whereX` sugar family (`whereIn`/`whereNull`/`whereBetween`/
`whereColumn`/`whereNot`/`whereLike`/`when`/`unless`). Pure ergonomics, mostly expressible via
`where(col, op, val)` today.

## Design

### 1. Relocate the `Expression` primitive (contracts)

`Expression`/`raw` live in `@rudderjs/database/src/expression.ts` today, but `@rudderjs/database`
is **node-only** and must never be reached from a Model/client-bundle path (Client Bundle Smoke
gate). The QB raw methods are Model-layer (client-reachable), so the primitive must move to the
client-safe shared point:

- Move `Expression` class + `raw()` to `@rudderjs/contracts` (new `expression.ts`, re-exported from
  the contracts barrel).
- `@rudderjs/database/src/expression.ts` becomes a re-export (`export { Expression, raw } from
  '@rudderjs/contracts'`) so `DB.raw()` and any `import { raw } from '@rudderjs/database'` keep
  working. **Non-breaking.**

### 2. Contract surface (`@rudderjs/contracts` `QueryBuilder<T>`)

Add:
```ts
selectRaw(sql: string, bindings?: readonly unknown[]): this
whereRaw(sql: string, bindings?: readonly unknown[]): this
orWhereRaw(sql: string, bindings?: readonly unknown[]): this
orderByRaw(sql: string, bindings?: readonly unknown[]): this
```
Widen `orderBy(column: string | Expression, direction?)`. `where`'s value param is already
`unknown`, so `raw(...)` flows through without a signature change — compiler handles it.

### 3. Native engine (the load-bearing part)

**Placeholder rebinding.** Raw SQL uses `?` placeholders (Laravel convention). The native
compiler emits dialect placeholders (`$n` on pg, `?` on sqlite/mysql) via one positional
`Bindings`. So when emitting a raw fragment, scan it for `?` and interleave `b.add(binding)` in
order — `?`→`?` on sqlite/mysql, `?`→`$n` on pg. Binding count must match `?` count (clear throw
otherwise). Limitation (same as Laravel): a literal `?` inside a string literal in the raw SQL is
miscounted — documented.

**compiler.ts:**
- `ConditionNode` gains `{ kind: 'raw'; boolean: 'AND'|'OR'; sql: string; bindings: readonly unknown[] }`.
- `compileNodes`: raw node → `substituteBindings(sql, bindings, b)` emitted verbatim (no quoting).
- `compileClause`: if `value instanceof Expression` → emit `${col} ${op} ${value.getValue()}` (no bind).
- Native-local `OrderItem = OrderClause | { kind:'raw'; sql:string; bindings:readonly unknown[] }`;
  `compileOrderBy` handles both. `orderBy(Expression)` → raw order item.
- `NativeQueryState` gains `rawSelects?: { sql:string; bindings:readonly unknown[] }[]`; `compileSelect`
  joins them into the select list **before** WHERE (so their bindings land first — SQL text order).
  `selectRaw` replaces the default `*` projection (matches Laravel — `selectRaw` is a projection).

**query-builder.ts:** add `_rawSelects` array; `selectRaw`/`whereRaw`/`orWhereRaw`/`orderByRaw`
push the new node shapes; thread into `_state()`. `orderBy` accepts `string | Expression`.

### 4. Adapters

- **Drizzle** (`orm-drizzle`): real impls via drizzle's `sql` template. Build a `sql` chunk from the
  raw fragment, splitting on `?` and interleaving bindings as `sql` params (auto-parameterized).
  `selectRaw`/`whereRaw`/`orWhereRaw`/`orderByRaw` push into the existing `_wheres`/`_orders`/select
  accumulation; `buildConditions` translates.
- **Prisma** (`orm-prisma`): **throws a clear, actionable error** — Prisma's structured client can't
  splice raw SQL fragments into `findMany` where/orderBy. Error points to the `DB` facade
  (`DB.select(sql, bindings)`) for raw queries. Consistent with the "clear throw over silent no-op"
  precedent (PR3 drizzle `with()`).

### 5. Model layer (`orm/src/index.ts`)

No special handling — the `_hydratingQb` proxy already forwards chainable methods to the adapter
QB. Just ensure `HydratingQueryBuilder` inherits the four new methods from the `QueryBuilder`
contract (it extends it). Types only.

## Tests

- `orm/src/native/raw-expr.test.ts` (NEW file → own line in orm's explicit package.json test-list,
  disjoint from #834's index.test.ts edits): compiler unit (whereRaw/orWhereRaw/orderByRaw/selectRaw
  → SQL+bindings; pg placeholder rebinding; `Expression` in where/orderBy; binding-count mismatch
  throws) + sqlite E2E round-trip + gated live pg round-trip (`PG_TEST_URL`).
- `orm-drizzle`: own test file (auto-discovered) — real sqlite round-trip for all four methods.
- `orm-prisma`: own test file — asserts the four methods throw with the DB-facade pointer.
- `@rudderjs/database`: existing `DB.raw` test still green (re-export).

## Changeset

`feat` minor: `@rudderjs/orm`, `@rudderjs/orm-drizzle`, `@rudderjs/contracts`. `@rudderjs/orm-prisma`
minor (new throwing methods). `@rudderjs/database` patch (Expression re-export move, API unchanged).

## Verification

build / typecheck / test (94 tasks) / client-bundle 7-7 / lint-0. Confirm `@rudderjs/database`
still off every Model/client-reachable path (Expression now in contracts, not database).
