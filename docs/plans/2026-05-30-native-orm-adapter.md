# Native ORM Adapter (`@rudderjs/orm-native`) — Implementation Plan

> Build a first-party database adapter that talks **directly** to `better-sqlite3` /
> `pg` / `mysql2` / `@libsql/client`, sitting under the existing dialect-agnostic
> `@rudderjs/orm` Model layer — alongside (not replacing) `orm-prisma` and
> `orm-drizzle`.

---

## Why this is tractable (read first)

The adapter boundary is already small and clean, and **the entire Eloquent surface
is native to `@rudderjs/orm` and dialect-agnostic** — Model, casts, observers,
mass-assignment, relations, the HydratingQueryBuilder Proxy, factories, soft
deletes. Adapters never touch any of it; they translate structured
`WhereClause[]` / `OrderClause[]` / `AggregateRequest[]` / `RelationExistencePredicate`
into SQL and execute it.

- Adapter contract: `OrmAdapter` = `query()` / `connect()` / `disconnect()`
  (`packages/contracts/src/index.ts:348`).
- The real work is the returned `QueryBuilder<T>` (~30 methods, `contracts/src/index.ts:135`).
- Registration is one call: `ModelRegistry.set(adapter)` in a provider `boot()`.

So this is **not "rebuild the ORM."** It's "write a query compiler + driver-execution
layer under a surface we already own." `orm-drizzle` (~1300 lines) is the closest
reference — same job, minus `drizzle-orm` (we hand-build SQL + bindings instead).

**The value and the cost live in two different boxes:**

| Box | Size | Risk | Where the payoff is |
|---|---|---|---|
| Query-execution adapter | ~1000–1300 LoC/dialect-shared | **Low** — bounded by the contract; conformance-tested for free | Drops the external query engine |
| **Schema + migrations** | A whole subsystem | **High** — perpetual, dialect long-tail | The actual "native" DX (Laravel migrations, no `schema.prisma`) |

Today `orm/src/commands/migrate.ts` just shells out to `prisma migrate` /
`drizzle-kit`. A native *query* adapter alone still depends on Prisma/Drizzle to
**define and migrate** the schema. The migration engine is therefore a **separate,
gated sub-project** (Phase 7) with its own plan — not something that rides along.

**Standing caveat:** a native ORM is a *perpetual* maintenance commitment (SQL
dialect long-tail + a migration engine, forever). This plan de-risks it with a
SQLite-first spike and explicit decision gates so we never over-commit before the
contract is proven.

---

## Status & Checkpoints

- [ ] Phase 0 — Plan-doc PR landed
- [ ] Phase 1 — Package scaffold + SQLite **read** path (conformance harness green)
- [ ] **GATE A** — contract sufficiency review (does the spike reveal missing contract surface?)
- [ ] Phase 2 — SQLite **write** path (create/update/delete/increment/bulk/soft-delete)
- [ ] Phase 3 — Relations (whereHas/whereDoesntHave, withAggregate, eager `with()`)
- [ ] Phase 4 — **Transactions** (contract addition — cross-cutting, all adapters)
- [ ] **GATE B** — "native query adapter, SQLite, full Model parity" — ship or stop?
- [ ] Phase 5 — Postgres dialect (`pg`)
- [ ] Phase 6 — MySQL dialect (`mysql2`) + libsql/Turso
- [ ] Phase 7 — **Schema builder + migrations** (separate plan; own gate)
- [ ] Phase 8 — Provider wiring, config, scaffolder, docs, release

Each phase = one or more PRs. Stop at any gate.

---

## Cross-phase rules (apply to every PR)

1. **Conformance, not new tests first.** The existing `@rudderjs/orm` Model test
   suite is dialect-agnostic — it is the native adapter's conformance suite. Wire a
   harness that runs it against the native adapter (SQLite in-memory). A phase is
   "done" when its slice of that suite is green against native.
2. **Parameterized SQL only — never string interpolation of values.** Every value
   goes through driver bindings (`?` / `$n`). Identifiers (table/column) are
   validated + quoted via a dialect quoter. This is a security gate, not a style one.
3. **No changes to `@rudderjs/orm`'s Model layer** except where a contract gap forces
   it (Phase 4 transactions). If a Model test fails against native, the bug is in the
   adapter, not the test — fix the adapter.
4. **Mirror `orm-drizzle`'s shape** (dialect branching, HMR client caching on
   `globalThis` keyed by `driver::url`, connection disposal on signature change) so
   the boot-leak guarantees from the provider-boot-leak audit hold by construction.
5. **`fix:`/`feat:` changeset** on any PR touching a published package.

---

## Phase 0 — Plan-doc landing

### Task 0.1
Open this plan as a PR (`docs:` — no changeset). Get sign-off on scope, the
keep-all-three-adapters positioning, and the Phase-7 separation before any code.

---

## Phase 1 — Package scaffold + SQLite read path

Goal: prove the contract is sufficient for reads against a real driver, fast.

### Task 1.1 — Scaffold `packages/orm-native`
- `package.json` (`@rudderjs/orm-native`), tsconfig, `rudderjs` provider field,
  `better-sqlite3` as the first driver (optional peer).
- `NativeAdapter implements OrmAdapter`; `NativeQueryBuilder<T>` skeleton throwing
  `NotImplemented` on every terminal.
- A `Dialect` abstraction: `{ quoteId, placeholder(i), supportsReturning, ... }` with
  a `SqliteDialect` first impl. This is the seam that pg/mysql plug into later.

### Task 1.2 — SQL compiler core (read)
- Compile `QueryState` (`wheres`/`orders`/`limitN`/`offsetN`) → `SELECT … FROM …
  WHERE … ORDER BY … LIMIT … OFFSET …` + bindings array.
- Operator map for `WhereOperator` (`=`,`!=`,`>`,`>=`,`<`,`<=`,`LIKE`,`NOT
  LIKE`,`IN`,`NOT IN`); `whereGroup`/`orWhereGroup` → parenthesized AND/OR with
  Laravel precedence (see `orm-prisma`'s where+orWhere semantics, PR #597 — match it).
- Terminals: `first()`, `find(id)`, `get()`, `all()`, `count()`, `paginate()`.

### Task 1.3 — Conformance harness
- A test entry that registers `NativeAdapter` against an in-memory SQLite DB seeded
  to match the ORM suite's fixtures, then runs the **read** slice of the
  `@rudderjs/orm` Model tests against it. Green = phase done.

### GATE A — contract sufficiency
Write up: did building reads surface anything the `QueryBuilder` contract can't
express, or anything the adapter needs from the Model layer that isn't there?
(Expected finding: **transactions** are absent from the contract entirely.) Decide
contract changes before writing the write path.

---

## Phase 2 — SQLite write path
- `create` (RETURNING on SQLite/pg; `lastInsertRowid` re-select on MySQL later),
  `update(id)`, `updateAll`, `delete(id)`, `deleteAll`, `insertMany`.
- Soft deletes: `withTrashed`/`onlyTrashed` filters, `restore`, `forceDelete`.
- Atomic `increment`/`decrement` as `SET col = col ± ?` (no observers — match the
  documented data-plane semantics).
- Conformance: write + soft-delete slices of the ORM suite green.

---

## Phase 3 — Relations
- `whereRelationExists(predicate)` → correlated `EXISTS` / `NOT EXISTS` subqueries
  from `RelationExistencePredicate` (incl. `through` pivot + `extraEquals`
  polymorphic discriminators). This is where native can **beat** the existing
  adapters: a uniform `whereHas` with no per-driver setup (Prisma needs `@relation`
  declared; Drizzle needs a table registry — native needs neither).
- `withAggregate(requests)` → aggregate subselects (`withCount/Sum/Min/Max/Avg/Exists`).
- Eager `with(...)` → batched second-query load (the N+1-safe path) + polymorphic
  post-load. Note: native should support `with()` natively, closing the Drizzle gap
  where `withWhereHas` falls back to plain `with`.
- Conformance: relations + aggregate slices green; explicitly cover the CLAUDE.md
  friction cases (nested `whereHas`, `morphTo`).

---

## Phase 4 — Transactions (contract addition)
- Add `transaction<T>(fn)` (+ savepoints for nesting) to the `OrmAdapter`/ORM
  surface — **absent from all three adapters today**, so design it here once.
- Implement on native (SQLite `BEGIN`/`COMMIT`/`ROLLBACK` + `SAVEPOINT`).
- Provide no-op/delegating impls for prisma/drizzle so the surface is uniform
  (or scope this to native-only behind a capability flag — decide at GATE A).

### GATE B — ship-or-stop
At this point native is a complete, conformance-passing **SQLite** query adapter
with full Model parity + transactions. Decide: is multi-dialect + migrations worth
the perpetual cost, given the motivation? If only SQLite + "bring-your-own-migrations"
is wanted, we can ship a 1.0 here.

---

## Phase 5 — Postgres (`pg`)
- `PgDialect` (`$n` placeholders, `ILIKE`, `RETURNING`, identifier quoting, JSON/
  jsonb, boolean, `pg.Pool` lifecycle + HMR caching).
- Optional: pgvector `whereVectorSimilarTo`/`selectVectorDistance` (mirror
  orm-prisma's `<=>`/`<->`/`<#>`), or defer to a follow-up.
- Conformance suite green on a real Postgres (CI service container).

---

## Phase 6 — MySQL (`mysql2`) + libsql/Turso
- `MysqlDialect` (`?` placeholders, no RETURNING → `affectedRows` + `insertId`
  re-select, backtick quoting, boolean/tinyint, JSON).
- libsql/Turso via `@libsql/client` (SQLite dialect, remote driver).
- Conformance green across all dialects in the CI matrix.

---

## Phase 7 — Schema builder + migrations (SEPARATE PLAN)
> The big, gated sub-project. Do **not** start before GATE B.

Scope to design in its own plan doc:
- A Laravel-style schema builder (`Schema.create('users', t => { t.id(); t.string(); … })`).
- Migration files + a runner + a state table; `migrate` / `migrate:fresh` /
  `migrate:status` / `make:migration` wired to native instead of shelling out.
- Schema **diffing** (the hard part) or an explicit up/down-only model (cheaper, more
  Laravel-faithful — likely the right call).
- `model:prune`, factories/seeders already work (native to ORM).

Decision to make there: full diff engine vs. up/down migrations only. Recommend
up/down-only first — it's more Laravel-like and an order of magnitude less surface.

---

## Phase 8 — Wiring, scaffolder, docs, release
- `NativeDatabaseProvider` + `config/database.ts` driver option (`'native'`).
- Auto-discovery (`rudderjs.provider`), doctor checks (mirror orm-prisma's `./doctor`).
- `create-rudder` profile option: native as the **zero-external-ORM default** for
  new SQLite apps.
- Docs: ORM guide adapter-comparison row; `@rudderjs/orm-native` README; migration
  guide (Phase 7).
- Release: `@rudderjs/orm-native` 1.0 + any contract bump from Phase 4.

---

## Explicitly NOT in this plan (yet)
- Replacing prisma/drizzle — **all three stay**. Native = batteries-included default.
- A schema-diff engine (Phase 7 leans up/down-only).
- Query-result streaming, read-replicas, multi-tenant connection switching.
- ORM-level caching beyond what `@rudderjs/cache` already offers.

## Open questions for the user
1. **Primary motivation** (drives GATE B): drop the external dep / own migration DX /
   fix `whereHas` friction / identity? Determines whether we go past SQLite.
2. **Migrations model**: up/down-only (recommended) vs. full schema diffing?
3. **Transactions scope** (GATE A): native-only, or add to the shared contract for
   all three adapters at once?
