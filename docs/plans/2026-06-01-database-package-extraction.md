# `@rudderjs/database` — Data-Layer Extraction (boundary now, fill incrementally)

> Date: 2026-06-01. Follows the gap analysis in
> `docs/plans/2026-06-01-laravel-db-orm-gap-analysis.md` (PR #822). That doc
> settled **what** (don't rename `@rudderjs/orm`; add a `DB` facade; lean toward
> extracting a foundation `@rudderjs/database` package; Redis stays separate).
> This doc settles **how** for the chosen strategy: **establish the package
> boundary now, then fill it incrementally** — rather than a big-bang extraction
> of the just-shipped native engine, or deferring the package to a later phase.

---

## 1. Decision recap

- **Package:** new `@rudderjs/database`, published at **1.0** (per the new-package
  policy), framework-scoped. It is the **foundation**; `@rudderjs/orm` (Eloquent
  models) sits on top — mirroring Laravel's `Illuminate\Database` → Eloquent.
- **Dependency direction (the whole point):** `@rudderjs/orm → @rudderjs/database`,
  and every adapter (`orm-prisma`, `orm-drizzle`, the native engine) implements a
  contract **owned by `@rudderjs/database`** (re-exported from / aligned with
  `@rudderjs/contracts`). `@rudderjs/database` must **never** depend on
  `@rudderjs/orm`.
- **Node-only.** Connections/drivers are server-side. `@rudderjs/database` is not
  client-bundle-reachable; the `Model` layer in `@rudderjs/orm` stays light and
  client-safe (Client Bundle Smoke gate stays green by construction).
- **Redis:** out of scope — separate `@rudderjs/redis` facade (or fold into
  `@rudderjs/cache`) in its own arc. Not bundled here.

### Why "boundary now" and not the alternatives

- **vs. full extract first:** the native engine (`orm/src/native/{compiler,dialect,
  driver,query-builder,schema}`) only just shipped (SQLite + Postgres + migrations
  + GATE 7-types, #794–#821) and is still settling (MySQL 7.8 + native E2E fixture
  pending). Physically relocating it into a brand-new 1.0 package right now is the
  highest-churn, highest-risk option at the worst possible time.
- **vs. facade-in-place then extract (the gap doc's Phase-1/Phase-2):** that builds
  a `@rudderjs/orm/database` subpath API and then **moves it later** — double
  import churn, and the seam is drawn against orm internals instead of a real
  package boundary.
- **Boundary now** gets the dependency direction and the public contract right
  **from day one** (no double move), while letting the engine internals migrate
  physically in a controlled, later step.

---

## 2. Architecture / seam

### What `@rudderjs/database` contains (filled incrementally)

1. **Execution contract** (model-independent). The native engine already defines
   exactly the right shape in `orm/src/native/driver.ts`:
   - `Executor.execute(sql, bindings) → Row[]`
   - `Transaction extends Executor` (+ nested `transaction()` → SAVEPOINT)
   - `Driver extends Transaction` (+ `close()`)
   These are currently native-only types. Promote the **model-independent**
   surface (`Executor`, `Transaction`, plus a `Connection` notion) to live in /
   be owned by `@rudderjs/database` (re-exported through `@rudderjs/contracts` so
   adapters keep a single import point). The native engine then *implements*
   `@rudderjs/database`'s contract instead of owning it.
2. **`DB` facade** — `DB.select/insert/update/delete/statement/unprepared` +
   `DB.transaction(fn)` + `DB.raw(...)`. Delegates to the **active connection's
   `Executor`** obtained from a registry (below). It does **not** import any
   engine — that's what keeps `database` free of an `orm` dependency.
3. **`Expression` / `raw()`** — the raw-SQL escape hatch, threaded through the
   compiler (compiler stays in `orm/native` for now; it imports `Expression`
   from `database` → `orm → database`, correct direction).
4. **Connection access** — *no new registry needed in PR1.* `ModelRegistry`
   (`orm/src/index.ts:233`) **already is** the active-connection holder for the
   default connection: all three adapters call `ModelRegistry.set(adapter)` in
   their `DatabaseProvider.boot()` (`orm-prisma/src/index.ts:1311`,
   `orm-drizzle/src/index.ts:1296`, native `orm/src/native/provider.ts`). The
   `DB` facade reads `ModelRegistry.getAdapter()` and calls a raw-exec method on
   it. A dedicated `ConnectionRegistry` (named connections + read/write split)
   is a **later fill**, not a PR1 prerequisite.
5. *(Later fills)* query-builder breadth (`whereX` sugar, joins, `chunk`/`lazy`,
   `upsert`, cursor pagination infra), schema-introspection facade
   (`getTables`/`getColumns` already exist in `native/schema/introspect.ts`),
   `db:show`/`db:table` CLI.

### What stays in `@rudderjs/orm`

- `Model` + relations + casts + observers + serialization + factories/seeders
  (the Eloquent layer). Client-safe entry preserved.
- The native **engine internals** (`native/compiler|dialect|driver|query-builder|
  schema`) **physically stay here for now** and relocate to `@rudderjs/database`
  in a later, deliberate "engine migration" step — the explicitly-deferred part of
  "fill incrementally."

### Registration seam (load-bearing for PR1)

There is **no central `database()` helper** — each adapter package ships its own
`DatabaseProvider extends ServiceProvider` whose `boot()` builds the adapter and
calls `ModelRegistry.set(adapter)`:
- `orm-prisma/src/index.ts:1291` (class) → `:1311` (`ModelRegistry.set`)
- `orm-drizzle/src/index.ts:1274` (class) → `:1296` (`ModelRegistry.set`)
- native: `orm/src/native/provider.ts` (`NativeDatabaseProvider`)

Because `ModelRegistry` already holds the active adapter, **PR1 needs no provider
edits and no second connection** — the `DB` facade reads
`ModelRegistry.getAdapter()` and the `Model` layer already routes through the same
instance. The only contract change is a **raw-exec seam on `OrmAdapter`** (see
PR1) that each adapter implements over its existing raw path (native
`Executor.execute`; prisma `$queryRawUnsafe`/`$executeRawUnsafe`; drizzle
`db.execute`).

---

## 3. PR sequence

Each PR is independent + shippable. PR1 establishes the boundary; the rest fill it
(and close the gap-analysis §8 correctness items) in priority order.

1. **PR1 — scaffold `@rudderjs/database` + `DB` facade skeleton.**
   - New package (1.0, build, exports map, `rudderjs` field if it ships a provider).
   - Add a **raw-exec method to the `OrmAdapter` contract** in
     `@rudderjs/contracts` (e.g. optional `execute(sql, bindings) → Promise<Row[]>`),
     implemented on all three adapters over their existing raw path (native
     `Executor.execute`; prisma `$queryRawUnsafe`/`$executeRawUnsafe`; drizzle
     `db.execute`).
   - In `@rudderjs/database`: own the model-independent execution types
     (`Executor`/`Transaction`/`Connection`, promoted from `orm/native/driver.ts`),
     `Expression`/`raw()`, and the `DB` facade — `DB.select/insert/update/delete/
     statement/raw` delegating to `ModelRegistry.getAdapter().execute(...)`.
   - `@rudderjs/orm` depends on `@rudderjs/database`. **No provider edits**
     (`ModelRegistry` already holds the active adapter).
   - Tests: `DB.select('select 1')`, `DB.raw`, facade↔ModelRegistry wiring,
     client-bundle smoke (database stays out of the client graph; add to gate
     TARGETS as needed).
   - Changeset: `feat` minor — new `@rudderjs/database`, `@rudderjs/contracts`
     (new optional contract method), each adapter (impl), `@rudderjs/orm` (new dep).

2. **PR2 — cross-adapter `transaction()`** *(gap §8 #1, top correctness gap).*
   Implement `transaction()` on `orm-prisma` (`$transaction`) + `orm-drizzle`
   (`db.transaction`); native already has it. Expose `DB.transaction(fn)` and make
   `Model` writes inside the callback join it (native already threads via ALS —
   mirror the join semantics for prisma/drizzle). The `OrmAdapter.transaction?`
   contract is already optional in `@rudderjs/contracts:366`.

3. **PR3 — Drizzle eager `with()`** *(gap §8 #2).* Kill the silent no-op at
   `orm-drizzle/src/index.ts:303` (`with(..._relations){ return this }`) —
   implement relation eager-loading, or throw a clear error. Silent no-op = missing
   relations masquerading as success.

4. **PR4 — `upsert()`** across native + prisma + drizzle (ON CONFLICT / bulk).

5. **PR5 — `chunk()` / `lazy()`** — promote the `model:prune` chunk loop to a
   public QB method + an async-generator `lazy()`.

6. **PR6 — `cursorPaginate()`** — keyset paginator on the existing order-by infra.

7. **PR7+ — raw-expression breadth + `whereX` sugar** landing in
   `@rudderjs/database`'s query-builder surface (threaded through the native
   compiler). This is also where the eventual engine relocation gets staged.

> Parallelizable across the two machines (no/low file overlap): PR2 (adapters) ∥
> PR3 (drizzle) ∥ PR1 (new package) can largely proceed independently once PR1's
> contract location is merged or pinned.

---

## 4. Risks / guardrails

- **Client bundle:** `@rudderjs/database` is node-only. Do **not** import it from
  any `Model`-reachable path. Keep the `DB` facade off the `@rudderjs/orm` main
  barrel's client-reachable surface (subpath or core/client split as needed).
- **Contract ownership churn:** moving `Executor`/`Transaction` ownership must keep
  a single import point for adapters — re-export through `@rudderjs/contracts` to
  avoid a flag-day across `orm-prisma`/`orm-drizzle`/native.
- **One connection, not two:** the `DB` facade and `Model` must share the same
  adapter instance via `ConnectionRegistry` — never open a second connection
  (pool exhaustion + HMR-reboot leak; see the orm-prisma/orm-drizzle
  globalThis-client reuse rules in CLAUDE.md).
- **Don't relocate the engine yet.** PR1–PR7 leave `native/*` in `@rudderjs/orm`.
  The physical engine move is a separate, later plan once the contract surface has
  proven out.
- **1.0 blast radius:** new dep edge `orm → database` is additive; no consumer
  import changes required for existing `Model` users. `DB` is net-new surface.
