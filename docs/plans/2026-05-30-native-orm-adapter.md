# Native ORM Engine (built into `@rudderjs/orm`) — Implementation Plan

> Build a first-party database engine that talks **directly** to `better-sqlite3` /
> `pg` / `mysql2` / `@libsql/client`, shipped **inside `@rudderjs/orm`** as the
> built-in default adapter — alongside (not replacing) the optional `orm-prisma`
> and `orm-drizzle` packages.
>
> **No new package, no new name.** The engine lives at a node-only **subpath**
> (`@rudderjs/orm/native`); `@rudderjs/orm`'s main entry stays the pure, client-safe
> Model layer. Users opt in with a config value (`driver: 'sqlite' | 'pg' | 'mysql'`),
> not a package install — so `@rudderjs/orm` becomes batteries-included: install it,
> get a working database out of the box.

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

### Why built-in (subpath), not a separate package

`@rudderjs/orm` is **client-bundle-reachable** — a `Model` can be imported from
client code, and the `Client Bundle Smoke` CI gate (`scripts/client-bundle-smoke.mjs`)
evaluates the package's main entry in a browser-like VM with no `process` / `node:`.
The Prisma/Drizzle adapters `import 'better-sqlite3'` freely *only because they are
separate, server-only packages* never in the client graph.

Folding the native engine in therefore requires **strict subpath isolation**:

- **`@rudderjs/orm` (main entry)** — unchanged: pure, client-safe Model / relations /
  contract / casts / factories. **No driver imports, no `node:` at eval time.**
- **`@rudderjs/orm/native` (subpath)** — node-only SQL compiler + driver execution.
  Drivers (`better-sqlite3` / `pg` / `mysql2` / `@libsql/client`) are **optional peers**,
  lazy-loaded. This subpath is **never imported from client code**, so the client gate
  stays green *by construction*.
- The built-in **provider loads from the subpath** via the existing
  `rudderjs.providerSubpath` mechanism (the same trick `@rudderjs/ai` uses to keep its
  runtime-agnostic main entry clean).

> **Merge-policy note (CLAUDE.md):** the package-merge checklist says adapters are a
> boundary that should stay *separate* — but that rule targets *third-party*
> integrations (Prisma/Drizzle) with independent release cadence. The native engine is
> co-developed with `@rudderjs/orm` and is the *default*; the subpath preserves the
> isolation the policy actually cares about while keeping one package, one version, no
> name.

### Runtime-agnostic by design (Node, React Native, browser)

A secondary goal — same shape as the runtime-agnostic split of `@rudderjs/ai`: the
ORM must be usable **outside Rudder**, in plain Node projects **and React Native**.
We're most of the way there already:

- `@rudderjs/orm`'s main entry has **no node-native deps** (only `@rudderjs/contracts`
  + `@rudderjs/console`) and **already passes the client-bundle gate** — the
  Model/relations/casts/QueryBuilder layer is portable today.
- Standalone use needs no Rudder app: `ModelRegistry.set(adapter)` is a plain call.
  `import { Model }`, set an adapter, query.

The seam that makes this work is a **hard split inside the native engine**:

| Layer | Portable? | Notes |
|---|---|---|
| **SQL compiler** (`Dialect`: build `SELECT … WHERE … $1` + bindings) | **Universal** | pure string building, zero platform deps — identical in Node/RN/browser |
| **Driver** (`execute(sql, bindings) → rows`) | **Per-platform** | the *only* thing that differs |

So per-platform support is a **thin driver**, not a reimplementation:

- **Node** → `better-sqlite3` / `pg` / `mysql2` (Phases 1–6)
- **React Native** → `op-sqlite` / `expo-sqlite` (async — fine, terminals are already `Promise<T>`) — **Phase 9**
- **Browser** → `wa-sqlite` / `sql.js` (WASM) — later, optional

**Design rule:** the `Driver` interface is defined and the compiler is kept
driver-free **from Phase 1**, so RN/browser drivers drop in later without touching the
compiler. Retrofitting this seam later is expensive; defining it now is nearly free.

**RN-specific caveat to verify early:** `@rudderjs/orm` currently depends on
`@rudderjs/console` (pulls `@clack` in its graph). It passes the browser eval gate, but
Metro (RN's bundler) may still try to bundle it. Confirm the import is lazy / move the
CLI-only bits (factory/seeder are already subpaths) so RN never sees `@clack`; add a
`"react-native"` export condition and test Metro resolution of the driver subpath.

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
- [ ] Phase 1 — Subpath scaffold + SQLite **read** path (conformance harness green)
- [ ] **GATE A** — contract sufficiency review (does the spike reveal missing contract surface?)
- [ ] Phase 2 — SQLite **write** path (create/update/delete/increment/bulk/soft-delete)
- [ ] Phase 3 — Relations (whereHas/whereDoesntHave, withAggregate, eager `with()`)
- [ ] Phase 4 — **Transactions** (contract addition — cross-cutting, all adapters)
- [ ] **GATE B** — "native query adapter, SQLite, full Model parity" — ship or stop?
- [ ] Phase 5 — Postgres dialect (`pg`)
- [ ] Phase 6 — MySQL dialect (`mysql2`) + libsql/Turso
- [ ] Phase 7 — **Schema builder + migrations** (separate plan; own gate)
- [ ] Phase 8 — Provider wiring, config, scaffolder, docs, release
- [ ] Phase 9 — **Runtime portability**: React Native driver (`op-sqlite`/`expo-sqlite`)
      + standalone-Node docs (browser/WASM optional). Can start any time after the
      `Driver` seam lands in Phase 1.

Each phase = one or more PRs. Stop at any gate. The `Driver`/`Dialect` split is a
**Phase-1 design requirement** (Task 1.1) even though the RN driver itself is Phase 9.

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
5. **Client-bundle discipline (the governing rule).** All native-engine code lives at
   the `@rudderjs/orm/native` subpath. `@rudderjs/orm`'s **main entry must never**
   statically import the native subpath, a driver, or `node:*` at eval time. Every PR
   in this plan runs `pnpm test:client-bundle` (the smoke gate) — green is mandatory.
   Driver loads are lazy `await import()` inside functions only.
6. **`fix:`/`feat:` changeset** for `@rudderjs/orm` (the engine ships inside it). Each
   driver-enabling phase is a **minor** bump.
7. **Keep the SQL compiler driver-free (portability rule).** The `Dialect`/compiler
   layer builds SQL strings + bindings only — no `import` of any driver, no `node:`, no
   I/O. All execution goes through the `Driver` interface (`execute(sql, bindings) →
   rows`). This is what lets a React Native / browser driver drop in later without
   touching the compiler. If compiler code reaches for a driver, that's a bug.

---

## Phase 0 — Plan-doc landing

### Task 0.1
Open this plan as a PR (`docs:` — no changeset). Get sign-off on scope, the
keep-all-three-adapters positioning, and the Phase-7 separation before any code.

---

## Phase 1 — Subpath scaffold + SQLite read path

Goal: prove the contract is sufficient for reads against a real driver, fast.

### Task 1.1 — Add the `@rudderjs/orm/native` subpath
- New source tree under `packages/orm/src/native/` exported via a `./native` entry in
  `@rudderjs/orm`'s `package.json#exports` (node-only condition; `default` →
  `./dist/native/index.js`). **Do not** re-export it from the main `src/index.ts`.
- `better-sqlite3` added as the first **optional peer** of `@rudderjs/orm`.
- `NativeAdapter implements OrmAdapter`; `NativeQueryBuilder<T>` skeleton throwing
  `NotImplemented` on every terminal.
- **Two seams, defined now (portability requirement):**
  - `Dialect` — `{ quoteId, placeholder(i), supportsReturning, ... }`, `SqliteDialect`
    first. The seam pg/mysql plug into.
  - `Driver` — `{ execute(sql, bindings): Promise<rows>, close() }`. The **per-platform**
    seam: a `BetterSqlite3Driver` now; `op-sqlite`/`expo-sqlite` (RN) and WASM (browser)
    later. The `NativeQueryBuilder`/compiler talks **only** to `Driver` + `Dialect`,
    never a concrete driver — so RN/browser drop in without touching the compiler
    (cross-phase rule 7). Defining this seam now is nearly free; retrofitting it is not.
- **Client gate first:** before any logic, add `@rudderjs/orm` to the smoke-gate
  TARGETS (if not already) and confirm `pnpm test:client-bundle` is green with the new
  subpath present but unreferenced from the main entry. This locks the constraint in
  on day one.

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
is wanted, we can ship it here as the built-in default (`@rudderjs/orm` minor) and stop.

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
- `NativeDatabaseProvider` (loaded from `@rudderjs/orm/native` via
  `rudderjs.providerSubpath`) + `config/database.ts` driver values
  (`'sqlite' | 'pg' | 'mysql'`) selecting the built-in engine.
- Doctor checks for the native engine (mirror orm-prisma's `./doctor`); the smoke-gate
  TARGETS entry from Task 1.1.
- `create-rudder`: native as the **zero-external-ORM default** for new SQLite apps
  (no `orm-prisma`/`orm-drizzle` install needed).
- Docs: ORM guide — native as the default + adapter-comparison row; document the
  `@rudderjs/orm/native` subpath and the client-safety contract; migration guide (Phase 7).
- Release: `@rudderjs/orm` minor bumps per driver phase + any contract bump from Phase 4.

---

## Phase 9 — Runtime portability (React Native, standalone Node, browser)
> Unblocked once the `Driver` seam lands in Phase 1. Independent of the migration
> sub-project; can run in parallel with Phases 5–8.

- **React Native driver:** a `Driver` impl over `op-sqlite` (or `expo-sqlite`) exposed at
  a subpath (e.g. `@rudderjs/orm/native/expo`), driver as an optional peer. Reuses the
  universal SQL compiler + `SqliteDialect` unchanged.
- **Bundler plumbing:** add a `"react-native"` export condition; verify Metro resolves
  the driver subpath and does **not** drag `@clack`/`@rudderjs/console` into the RN
  bundle (make that import lazy or move CLI-only bits out — flagged in "Runtime-agnostic
  by design"). Confirm `reflect-metadata` is only needed if Models use decorators
  (they're static-property-based today — verify).
- **Standalone Node:** doc + example showing the ORM used outside Rudder
  (`import { Model }` + `ModelRegistry.set(new NativeAdapter(...))`, no app bootstrap).
- **Browser/WASM (optional, later):** a `wa-sqlite`/`sql.js` `Driver` for the same
  compiler — only if there's demand.
- **Conformance:** run the dialect-agnostic Model suite against the RN driver in an RN
  test harness (or at minimum the SQL-compiler-level tests, since the compiler is shared).

---

## Explicitly NOT in this plan (yet)
- Replacing prisma/drizzle — both **stay** as optional packages. Native = the
  batteries-included default that ships inside `@rudderjs/orm`.
- A separate `@rudderjs/orm-native` package — rejected; the engine lives at the
  `@rudderjs/orm/native` subpath (one package, one version, no name).
- A schema-diff engine (Phase 7 leans up/down-only).
- Query-result streaming, read-replicas, multi-tenant connection switching.
- ORM-level caching beyond what `@rudderjs/cache` already offers.

## Open questions for the user
1. **Primary motivation** (drives GATE B): drop the external dep / own migration DX /
   fix `whereHas` friction / identity? Determines whether we go past SQLite.
2. **Migrations model**: up/down-only (recommended) vs. full schema diffing?
3. **Transactions scope** (GATE A): native-only, or add to the shared contract for
   all three adapters at once?
4. **Runtime portability priority**: is React Native (Phase 9) a near-term target that
   should gate design choices now, or a "keep the door open, build later" — the `Driver`
   seam is required either way, but RN-target raises the bar on the `@rudderjs/console`
   dependency cleanup and Metro testing.
