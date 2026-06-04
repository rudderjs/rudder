# `@rudderjs/database` — Phase 2: relocate the native engine internals

> Date: 2026-06-04. Sequel to `docs/plans/2026-06-01-database-package-extraction.md`
> (Phase 1 — "boundary now, fill incrementally"). Phase 1 is DONE: PR #823 shipped
> the `@rudderjs/database` package (1.1.0), the `DB` facade, the registry bridge,
> and the `orm → database` dependency edge; the gap-analysis §8 Phase-1 fills
> (#824–#857) are merged. This doc plans the deliberately-deferred step: physically
> relocating the native engine internals
> (`packages/orm/src/native/{compiler,dialect,driver,query-builder,schema}` +
> drivers) from `@rudderjs/orm` into `@rudderjs/database`.
>
> **Invariant (the whole point): `@rudderjs/orm` depends on `@rudderjs/database`;
> `@rudderjs/database` must NEVER depend on `@rudderjs/orm` — not even as a
> devDependency (turbo's `^build` topology counts devDeps; a `database → orm`
> dev edge is a package-graph cycle and turbo rejects it).**

---

## 1. Goal / non-goals

**Goal.** The engine (~6,600 source lines: SQL compiler, dialects, driver seam,
three concrete drivers, `NativeQueryBuilder`, `NativeAdapter`, the schema
builder + migrator + type generator) becomes `@rudderjs/database`'s code — its
conceptual home per the gap analysis §6/§7 (`Illuminate\Database` → Eloquent).
`@rudderjs/orm` keeps the Eloquent layer (Model, relations, casts, factories,
resources) plus thin glue.

**Non-goals (explicitly out of scope):**

- **No public API break.** Every `@rudderjs/orm/native*` and
  `@rudderjs/orm/sticky` import keeps working (see §4.2 — shims). No app, doc,
  scaffolded migration file, or playground changes required.
- **No behavior change.** Pure relocation + import rewrites; SQL output,
  globalThis cache semantics, and provider boot order are byte-identical.
- **`orm-prisma` / `orm-drizzle` untouched** (another agent owns those lanes;
  the `@rudderjs/orm/sticky` shim is specifically what keeps
  `orm-drizzle/src/index.ts:28` working without edits).
- **No connection-manager move** (see §3.3 — `ConnectionManager` is
  client-reachable and stays in orm).
- **Redis, `db:show`/`db:table` CLI, QB breadth** — separate arcs.

---

## 2. Current state (verified 2026-06-04, post-#883)

- `packages/database` (1.1.0): `db.ts` (DB facade incl. `DB.connection()`),
  `expression.ts` (re-export from contracts), `execution.ts` (re-export from
  contracts), `registry-bridge.ts` (adapter/transaction/connection resolver
  injection — module-scoped state, re-registered each boot by orm's
  `db-bridge.ts`). Deps: `@rudderjs/contracts` only. Exports map: `.` only.
  No `rudderjs` provider field. Test script already uses the quoted glob
  `node --test "dist-test/**/*.test.js"`.
- `packages/orm` (1.14.0): deps `@rudderjs/contracts` + `@rudderjs/database`
  (edge exists since #823). Optional peers: `@rudderjs/console`,
  `@rudderjs/core`, `better-sqlite3`, `postgres`, `mysql2`. Exports: `.`,
  `./db-bridge`, `./sticky`, `./native`, `./native/provider`, `./doctor`,
  `./commands/*`. `rudderjs` field: `{ provider: 'NativeDatabaseProvider',
  providerSubpath: './native/provider', stage: 'infrastructure', optional: true }`.
- `packages/orm/src/native/`: 25 source files (6,610 lines) + 48 test files.

### 2.1 The engine's only couplings into orm core (file-level)

The engine is already nearly clean. Every `native/* → orm-core` import:

| Site | Imports | Kind |
|---|---|---|
| `native/adapter.ts:19` | `markWrote, stickyWrote` from `../sticky.js` | runtime (read/write-split sticky marking) |
| `native/provider.ts:22–30` | `ModelRegistry, ConnectionManager` from `../index.js`; `databaseContextMiddleware` from `../sticky.js`; side-effect `import '../db-bridge.js'`; `ServiceProvider, config, appendToGroup` from `@rudderjs/core` | runtime (the orm↔database glue) |
| `native/schema/types-generator.ts:17` | `type BuiltInCast` from `../../cast.js` | **type-only** |

Everything else in `native/**` imports only `@rudderjs/contracts` or
intra-`native` modules (verified by grep). The orm **main entry never imports
`native/**`** — the only orm-core file touching native is
`commands/migrate.ts` (type import of `ModelCastInfo` + `MigratorAdapter`,
dynamic `await import('../native/index.js')` at 6 call sites, and the generated
migration-stub string at `:506`).

---

## 3. Recon findings — the seven questions, resolved

### 3.1 Client-bundle boundary

- `@rudderjs/orm`'s main entry (`src/index.ts`) has **zero** native imports.
  The QB-unwrap symbol `Symbol.for('rudderjs.orm.qb.target')` is defined
  **independently** in `index.ts:1714` and `native/query-builder.ts` (no
  cross-module import — `Symbol.for` makes runtime identity work without one).
  This pattern survives the move verbatim: the definition in
  `query-builder.ts` relocates with the file; orm's copy stays.
- `scripts/client-bundle-smoke.mjs` `TARGETS` lists `@rudderjs/orm` (main
  entry) — **unchanged**. `@rudderjs/database` is node-only by policy and is
  NOT added as a target (the gate proves listed entries evaluate in a browser;
  database is intentionally not such an entry). The move cannot regress the
  gate because the orm main entry's import graph doesn't change at all.
- `db-bridge.ts` stays orm-side and stays off the main entry (imported for
  side effect only from adapter providers) — its header comment documents
  exactly this rule; nothing changes.
- `connection-manager.ts` (client-reachable, re-exported from orm main) keeps
  its no-`node:`-imports discipline and **stays in orm** (§3.3).

### 3.2 `@rudderjs/orm/native*` import inventory (repo + templates + docs)

Every site that would break under a no-shim move:

**Code (repo-controlled):**
- `packages/orm/src/commands/migrate.ts` — 6× dynamic
  `await import('../native/index.js')`, type imports
  (`ModelCastInfo`, `MigratorAdapter`), and the **generated stub string**
  `import { Migration, Schema } from '@rudderjs/orm/native'` (`:506`);
  `migrate.test.ts:624` asserts that exact string.
- `packages/queue/src/native/adapter.ts:163` —
  `resolveOptionalPeer('@rudderjs/orm/native')` (see §3.4).
- `packages/queue/src/native/migrations.ts:49,74` — generated stub strings.
- `create-rudder/src/templates/native/create-users-migration.ts:9` —
  scaffolded migration stub string.
- `scripts/orm-standalone-smoke.mjs:106` —
  `import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/orm/native'`
  (already packs `@rudderjs/database` since #823 — no script change needed).

**Docs / notes:**
- `docs/guide/database.md:96,112` (provider import + standalone snippet),
  `docs/guide/database/native.md:74,96`, `packages/orm/README.md:42`,
  `claude-notes/create-app.md`, root + orm `CLAUDE.md`.

**App-side (uncontrolled — the decisive constraint):** every app scaffolded
with the native engine has `database/migrations/*.ts` files importing
`{ Migration, Schema } from '@rudderjs/orm/native'`, and hand-wired apps import
`nativeDatabase` from `@rudderjs/orm/native/provider` (documented pattern).
These files live in user repos and **cannot be migrated by us**.

**Decision: re-export shims, minor bump — not a breaking move.**
`@rudderjs/orm` already depends on `@rudderjs/database`, so
`packages/orm/src/native/index.ts` becomes
`export * from '@rudderjs/database/native'` (one line; `export *` carries
types) and `./sticky` becomes the same for `@rudderjs/database/sticky`.
`./native/provider` is NOT a shim — the provider physically stays in orm
(§3.5). Generated stub strings keep emitting `@rudderjs/orm/native` for now
(zero churn; a scaffolded app would otherwise need `@rudderjs/database` as a
direct dependency under pnpm's isolated `node_modules` — switching the stubs is
a later, deliberate scaffolder PR that also adds the dependency). The shims are
cheap, permanent-until-2.0, and make this a **minor** on orm.

### 3.3 HMR / globalThis caches — what moves, what stays, keys frozen

| Key | Lives in | Phase-2 fate |
|---|---|---|
| `__rudderjs_native_client__` (per-connection `Map`: write driver + `readDrivers` + dialect, keyed `connectionName ?? signature`) | `native/adapter.ts:92` | **Moves with `adapter.ts` to database. Key and signature format UNCHANGED.** |
| `__rudderjs_orm_sticky__` (ALS for sticky reads) | `src/sticky.ts:25` | **Moves with `sticky.ts` to `@rudderjs/database/sticky`. Key UNCHANGED.** |
| `__rudderjs_orm_connections__` (`ConnectionManager` store) | `src/connection-manager.ts:46` | **Stays in orm.** `ConnectionManager` is re-exported from the client-reachable orm main entry and `Model._adapterQb()` calls `peek()` synchronously on that path; moving it would drag node-only `@rudderjs/database` into the client graph. `DB.connection()` already reaches it via the injected `ConnectionResolver` (registry bridge) — no move needed. |
| `__rudderjs_orm_registry__` (`ModelRegistry`) | `src/index.ts:142` | Stays (pure Eloquent). |
| `__rudderjs_drizzle_client__` / `__rudderjs_prisma_client__` | adapter packages | Untouched. |

**Why keys must not change:** the keys exist precisely because two module
copies must converge on one store (bundled-inline + node_modules dual-load),
and because a dev re-boot across a *version upgrade* must reuse-or-dispose live
driver handles. Renaming `__rudderjs_native_client__` would orphan the old
bundle's drivers on the first re-boot after upgrading → leaked MySQL pools
(~16–20 server connections each; `max_connections` exhaustion in ~9–10 edits —
the exact failure CLAUDE.md's HMR bullet documents). There is even precedent
for *shape* migration under a stable key (`nativeClientCache()` pre-maps the
legacy single-entry shape) — follow that bar: stable key, stable signature
format. Same argument for `__rudderjs_orm_sticky__`: the orm shim, the moved
database module, and `orm-drizzle`'s import all converge on one ALS only
because the key is shared.

`@rudderjs/database`'s `registry-bridge.ts` keeps its module-scoped (non-
globalThis) state — it is re-registered on every boot by orm's `db-bridge.ts`
side-effect import from the providers, which is unchanged.

### 3.4 `@rudderjs/queue` native driver (PR #837 dep)

What it actually uses (all duck-typed / late-bound — no compile-time dep):

- `adapter.ts:163` — `resolveOptionalPeer('@rudderjs/orm/native')` →
  `NativeAdapter.make(...)` (dedicated-`engine` queue connections only).
- `adapter.ts:174` — `resolveOptionalPeer('@rudderjs/orm')` →
  `ModelRegistry.getAdapter()` (default path; stays correct — `ModelRegistry`
  stays in orm).
- `lockForUpdate` is reached by **capability check on the QB instance**
  (`typeof qb.lockForUpdate === 'function'`), never by import — no path change.
- `migrations.ts` — local structural `Blueprint` type + generated stub strings
  importing `@rudderjs/orm/native` (app-side files; covered by the shim).

**Plan:** zero queue changes required for correctness (the shim covers
`:163`). A small follow-up PR (PR-B3) retargets `:163` to try
`resolveOptionalPeer('@rudderjs/database/native')` first and fall back to
`'@rudderjs/orm/native'` (older orm installs), so queue stops depending on the
shim's continued existence. Internal-only → `refactor:`, no changeset.

### 3.5 Provider auto-discovery

**`NativeDatabaseProvider` stays in `@rudderjs/orm` (real file, not a shim).**
It is the orm↔database glue by construction: it wires `ModelRegistry.set()`,
`ConnectionManager.register()/ensure()`, imports `db-bridge.js` for side
effect, and installs `databaseContextMiddleware` — all orm-side state. Moving
it to database would require `database → orm` imports (forbidden) or doubling
the registry-bridge injection machinery for no user-visible gain.

Consequences (all zero-churn):
- `packages/orm/package.json`'s `rudderjs` field is **unchanged**
  (`providerSubpath: './native/provider'`) — no `providers:discover` rerun, no
  manifest churn in any app.
- `@rudderjs/database` gets **no** `rudderjs` field (it ships no provider).
- `provider.ts`'s imports retarget: `NativeAdapter`/`NativeDriverName` from
  `@rudderjs/database/native`, `databaseContextMiddleware` from
  `@rudderjs/database/sticky`; `ModelRegistry`/`ConnectionManager`/`db-bridge`
  imports unchanged.

### 3.6 Contracts split — verified, one addition

Already owned by `@rudderjs/contracts` (Phase 1 / #835 / #854 — verified at
`contracts/src/index.ts:462+`): `Row`, `Executor`, `Transaction`, `Connection`,
`QueryEvent`, `QueryListener`, `Expression`/`raw()`, the `QueryBuilder` +
`OrmAdapter` contracts (incl. optional `selectRaw`/`affectingStatement`/
`onQuery`/`transaction`/`upsert`), `JoinClause`. `native/driver.ts` already
re-exports the canonical types from contracts. **Nothing moves back.**

Engine-internal seams that move WITH `driver.ts` into database and deliberately
do NOT go to contracts: `AffectingExecutor`/`AffectingResult` (MySQL
no-RETURNING seam — `driver.ts:24–45`, documented as "a native-only seam, not
in `@rudderjs/contracts`") and `Driver` (the per-platform connection marker).
`Dialect` likewise stays an engine export (database), not a contract.

**One addition:** `BuiltInCast` (the cast-name string union in `orm/src/cast.ts`)
moves to `@rudderjs/contracts`, with orm's `cast.ts` re-exporting it. This is
the only way to keep `types-generator.ts`'s type-only import (`:17`) without a
`database → orm` package edge (type-only imports still require the dependency
declared for TS resolution → turbo cycle). Duplicating the union in database
was considered and rejected (drift risk on a parity-critical mapping).

### 3.7 Test relocation + CI

`packages/orm` has 79 test files; **48 under `src/native/`**. The split is
determined by one criterion: **does the test import the orm Model layer?**
(grep for `from '../index.js'` / `'../../index.js'` inside `src/native/`):

- **27 stay in orm** (Model-coupled E2E — they exercise Model↔engine
  integration and cannot move without a forbidden `database → (dev)orm` edge):
  `native-read/write/relations/transactions`, `joins`, `union`, `distinct`,
  `group-having`, `raw-expr`, `where-column/not/has-ops`, `json-where`,
  `json-where-has`, `nested-where-has`, `json-update`, `date-helpers`,
  `boolean-binding`, `eager-with`, `named-connections`, `on-query`,
  `db-facade`, `provider`, **`drivers/postgres.test.ts`**,
  **`drivers/mysql.test.ts`**, `schema/model-for`, `schema/schema-builder`.
  They keep their current paths; only their engine imports rewrite
  (`./adapter.js` → `@rudderjs/database/native`, etc.).
- **~21 move to `packages/database/src/native/`** (pure engine units):
  `compiler`, `compiler-relations`, `compiler-write`, `dialect-pg`,
  `dialect-mysql`, `lock`, `no-returning-write`, `read-write-split` (its only
  orm import is `../sticky.js`, which moves first), `errors`-adjacent units,
  and the pure `schema/` suites (`blueprint`, `ddl-compiler`, `migrator`,
  `rebuild`, `alter`, `column`, `types-generator`, `introspect`,
  `pg-introspect`, `mysql-introspect`, `types-story-e2e`, `schema-facade`).
  Exact membership = the complement of the grep above, re-run at
  implementation time.

**Live-gated suites** (14 files reference `PG_TEST_URL`/`MYSQL_TEST_URL`) end
up split across BOTH packages (e.g. `drivers/postgres.test.ts` stays orm-side,
`schema/pg-introspect.test.ts` moves) — so the CI jobs change from
`--filter @rudderjs/orm` to
`pnpm turbo run test --filter @rudderjs/orm --filter @rudderjs/database --force`
in both `orm-pg` and `orm-mysql` (`.github/workflows/ci.yml:418,471`), with the
job comments updated to name both packages.

**Warm-up finding (verified, currently a real CI hole):** turbo 2.9.16 runs in
**strict env mode** with no `env`/`passThroughEnv`/`globalEnv` declared in
`turbo.json` — confirmed via `--dry=json` (`envMode: "strict"`, task env
`[]`). The CI step-level `PG_TEST_URL`/`MYSQL_TEST_URL` are therefore
**stripped before reaching `node --test`**, and the "ORM Postgres (live)" /
"ORM MySQL (live)" jobs have been green while every live suite silently
self-skips. Fix: add `"env": ["PG_TEST_URL", "MYSQL_TEST_URL"]` to the `test`
task in `turbo.json` (preferred over `passThroughEnv` so the vars participate
in the task hash for local non-`--force` runs; CI already uses `--force`).
**This must land before the move PRs** — otherwise the relocation ships with
its live conformance suites unverified.

Mechanics: both packages already use the quoted glob
`node --test "dist-test/**/*.test.js"`, which matches moved subdirectories.
`@rudderjs/database` gains the engine's test devDeps (`better-sqlite3`, and
`postgres`/`mysql2` if the moved live suites need them) and the same
`tsconfig.test.json` shape orm uses. **Always `rm -rf dist-test` in both
packages when moving test files** — stale compiled tests under `dist-test/`
otherwise keep passing/failing from the old tree and poison the counts.

---

## 4. Target layout

### 4.1 `@rudderjs/database` after Phase 2

```
packages/database/src/
├── db.ts / expression.ts / execution.ts / registry-bridge.ts   (unchanged)
├── sticky.ts                  ← moved from orm (key __rudderjs_orm_sticky__ unchanged)
└── native/                    ← moved from packages/orm/src/native (dir name kept)
    ├── adapter.ts             (sticky imports become './sticky.js' → '../sticky.js')
    ├── compiler.ts / dialect.ts / dialect-pg.ts / dialect-mysql.ts
    ├── driver.ts / errors.ts / query-builder.ts / index.ts (engine barrel)
    ├── drivers/{better-sqlite3,postgres,mysql}.ts
    └── schema/**              (types-generator imports BuiltInCast from contracts)
```

Exports map gains `./native` (the engine barrel, byte-compatible with today's
`@rudderjs/orm/native` surface) and `./sticky` (node conditions, mirroring
orm's current subpath shapes). The **main entry additionally re-exports the
user-facing engine API** (`Migration`, `Schema`, `NativeAdapter`, `native`,
drivers, `Dialect` types) as the canonical new home —
`import { Migration, Schema } from '@rudderjs/database'` is the
documented-going-forward form; the package is node-only so there is no client
constraint. `package.json` gains optional peers `better-sqlite3` / `postgres`
/ `mysql2` (moved from orm's role as engine host; orm RETAINS them too — they
are marked optional, harmless, and dropping them in the same PR would churn
installer warnings for every orm consumer; remove orm's copies in a later
major or once telemetry shows no direct engine use through the shim).

### 4.2 `@rudderjs/orm` after Phase 2

```
packages/orm/src/
├── index.ts                   (unchanged — still zero native imports)
├── sticky.ts                  → shim: export * from '@rudderjs/database/sticky'
├── db-bridge.ts               (unchanged)
├── connection-manager.ts      (stays — client-reachable)
├── commands/migrate.ts        (type + dynamic imports retarget to '@rudderjs/database/native';
│                               stub string still emits '@rudderjs/orm/native')
└── native/
    ├── index.ts               → shim: export * from '@rudderjs/database/native'
    ├── provider.ts            (stays — real provider, imports engine from database)
    └── *.test.ts              (the 27 Model-coupled suites, imports rewritten)
```

`rudderjs` provider field, exports map keys, and the Client Bundle Smoke
target are all **unchanged**.

---

## 5. PR sequence — two zero-overlap lanes

Two machines. Lane A owns the relocation critical path; Lane B owns warm-ups
and consumers. **Shared-file rule:** `packages/orm/package.json`,
`packages/database/package.json`, and `.github/workflows/ci.yml` are touched by
Lane A only; `turbo.json` by Lane B only; `.changeset/*` entries are unique
files (no conflict). Lane B's post-move PRs (B2–B4) gate on A3 merging — that
is deliberate sequencing, not parallelism lost: B1 is independent and lands
first, and B2 was *chosen* to run in the new home rather than racing the move.

### Lane B (machine 2)

- **PR-B1 — `ci:` turbo live-env fix.** `turbo.json` `test` task gains
  `"env": ["PG_TEST_URL", "MYSQL_TEST_URL"]`. Restores real live coverage to
  `orm-pg`/`orm-mysql` **before** anything moves. Expect this PR to surface
  any live-suite rot that accumulated while the jobs were vacuous — budget for
  fixing those failures here (they are pre-existing bugs, not regressions).
  Files: `turbo.json` only. No changeset (`ci:`).
- **PR-B2 — `feat(orm):`/`feat(database):` mysql JSON null-vs-missing-key
  distinction** (the deferred gap from the JSON-where arc). Runs **after A3**
  so it lands in the engine's new home (`packages/database/src/native/
  dialect-mysql.ts` + `compiler.ts`) instead of racing the move; its
  Model-level assertions extend `json-where.test.ts`, which stays orm-side.
  Changeset: minor (database; orm only if the Model surface changes).
- **PR-B3 — `refactor(queue):` retarget the database queue driver** (after
  A3): `adapter.ts:163` tries `resolveOptionalPeer('@rudderjs/database/native')`
  first, falls back to `'@rudderjs/orm/native'`. No behavior change → no
  changeset.
- **PR-B4 — `docs:` sweep** (after A3): `docs/guide/database.md`,
  `docs/guide/database/native.md`, `docs/guide/database/connections.md`
  (sticky import: document `@rudderjs/database/sticky` as canonical,
  `@rudderjs/orm/sticky` as the compatible alias), `packages/orm/README.md`,
  new `packages/database/README.md` section, `claude-notes/`, root +
  `packages/orm/CLAUDE.md` (+ a new `packages/database/CLAUDE.md`). Present
  the engine as living in `@rudderjs/database` with `@rudderjs/orm/native`
  back-compat noted. Docs-only, no changeset.

### Lane A (machine 1)

- **PR-A1 — `feat:` decouple the engine from orm core.**
  1. Move `src/sticky.ts` → `packages/database/src/sticky.ts`; add the
     `./sticky` export to database; orm's `sticky.ts` becomes the re-export
     shim. globalThis key untouched → orm-drizzle (`index.ts:28`) and queue
     job wrappers keep working with zero edits.
  2. Move `BuiltInCast` to `@rudderjs/contracts`; `orm/src/cast.ts` re-exports.
  3. No `native/**` edits at all (adapter still imports `../sticky.js`, which
     now resolves through the shim — proof the shim works before the big move).
  - Files: `packages/database/{src/sticky.ts,src/index.ts?,package.json}`,
    `packages/orm/src/{sticky.ts,cast.ts}`, `packages/contracts/src/index.ts`
    (+ its expression/cast section). Changesets: database minor, contracts
    minor, orm minor (subpath now re-exports — public surface identical).
- **PR-A2 — `feat:` move the query-engine core.** `git mv` of `compiler.ts`,
  `dialect.ts`, `dialect-pg.ts`, `dialect-mysql.ts`, `driver.ts`, `errors.ts`,
  `query-builder.ts`, `drivers/*` → `packages/database/src/native/`; database
  gains the `./native` subpath (partial barrel) + driver optional peers + test
  devDeps; orm's remaining native files (`adapter.ts`, `schema/**`,
  `index.ts` barrel) rewrite those imports to `@rudderjs/database/native`;
  move the pure tests for the moved files (`compiler*`, `dialect-*`, `lock`,
  `no-returning-write`, `read-write-split`); `ci.yml` `orm-pg`/`orm-mysql`
  filters gain `--filter @rudderjs/database`. **`adapter.ts` and `schema/`
  deliberately do NOT move here** — `adapter.ts` imports `SchemaBuilder` +
  `ModelCastInfo` from `./schema/`, so it can only move with (or after)
  `schema/`; moving it earlier would point database at orm. Changesets:
  database minor, orm minor.
- **PR-A3 — `feat:` move schema + adapter, finalize shims.** `git mv` of
  `schema/**` (types-generator now imports `BuiltInCast` from contracts) and
  `adapter.ts` (sticky import becomes intra-package `../sticky.js`;
  `__rudderjs_native_client__` key + signature format untouched);
  `native/index.ts` becomes the one-line shim; `provider.ts` +
  `commands/migrate.ts` + `commands/schema-types.ts` retarget engine imports;
  database main entry re-exports the canonical engine API; move the remaining
  pure tests (`schema/` units + introspect/types-story live suites); rewrite
  the 27 staying tests' engine imports. Verify `pnpm test:client-bundle` and
  `node scripts/orm-standalone-smoke.mjs` locally (the smoke already packs
  database). Changesets: database minor, orm minor.

A1→A2→A3 are stacked in spirit but **each lands on main before the next
starts** (per the stacked-PR CI gotcha: PRs not targeting main get no CI —
rebase onto main after each merge rather than stacking branches).

---

## 6. Versioning / changesets (per CLAUDE.md policy)

| Package | Bump | Why |
|---|---|---|
| `@rudderjs/database` | **minor** (1.1 → 1.2 across A1–A3) | Gains sticky, the engine, `./native` + `./sticky` subpaths, driver peers — additive surface. |
| `@rudderjs/orm` | **minor** | `feat:` relocation with every public import path preserved (`./native`, `./native/provider`, `./sticky` all still resolve to identical surfaces). **Not a major** — nothing a consumer can observe breaks. |
| `@rudderjs/contracts` | **minor** (PR-A1) | New `BuiltInCast` export. |
| `@rudderjs/queue` | none | PR-B3 is `refactor:` — resolution-order change with identical behavior. |
| `orm-prisma` / `orm-drizzle` | none | Untouched. |

Release ordering is handled by changesets (`workspace:^` rewrites): database
publishes in the same release PR as (or before) the orm that references its new
subpaths. Pre-push check per policy: `git diff --stat main..HEAD .changeset/`
must show entries on every `feat:` PR (A1, A2, A3, B2).

---

## 7. Risks / guardrails

- **Turbo cycle.** Never add `@rudderjs/orm` to database's `devDependencies`
  "just for a test" — it cycles the task graph. Model-coupled tests stay in
  orm; that is the rule that keeps the graph a DAG.
- **globalThis keys + signature formats are frozen** (§3.3). A renamed key or
  reformatted signature orphans live drivers across the upgrade re-boot →
  pooled-connection leaks. If a shape change is ever needed, follow the
  existing legacy-pre-mapping precedent in `nativeClientCache()`.
- **Client bundle.** orm main entry's import graph is untouched by
  construction; `pnpm test:client-bundle` runs in CI on every PR. Do not
  re-export anything from `@rudderjs/database` on orm's main entry; database
  never becomes a smoke target.
- **Shim fidelity.** `export *` re-exports both values and types, but NOT
  default exports (none exist in these barrels — verified). After A3, diff
  `dist/native/index.d.ts` (orm shim) against the old surface to confirm
  byte-equivalent re-export coverage.
- **Live-suite truthfulness.** PR-B1 first. When the move PRs run, watch that
  the `orm-pg`/`orm-mysql` job logs actually show the live tests *executing*
  (not `skipped`) for both filters — the whole point of sequencing B1 ahead.
- **`rm -rf dist-test`** in orm AND database around every test move — stale
  compiled tests lie about counts (standing repo guardrail).
- **HMR watch path.** `@rudderjs/vite`'s `rudderjs({ watch })` is package-name
  based; apps linking the engine for development should now watch
  `@rudderjs/database` too — a one-line note in PR-B4's docs sweep.
- **Windows CI flake** (`Build & Test (windows-latest)` exit-1 with no
  diagnostics) — re-run before assuming a move PR broke Windows.

---

## 8. Acceptance checklist (end state)

- [ ] `packages/orm/src/native/` contains only `provider.ts`, the `index.ts`
      shim, and the 27 Model-coupled test files.
- [ ] `grep -r "from '@rudderjs/orm'" packages/database/src` → empty (dep
      direction proven), and database's `package.json` has no orm entry in any
      dependency block.
- [ ] `pnpm build && pnpm typecheck` green at repo root after each PR.
- [ ] Client Bundle Smoke green; `orm-standalone-smoke` green.
- [ ] `orm-pg` / `orm-mysql` CI logs show live suites executing under both
      `--filter @rudderjs/orm` and `--filter @rudderjs/database`.
- [ ] A playground app with `engine: 'native'` boots, migrates
      (`pnpm rudder migrate`), and serves queries with **zero** app-file edits.
- [ ] Dev-HMR check: edit a route file in such an app twice; confirm one
      driver handle total (no per-re-boot client construction reintroduced).
