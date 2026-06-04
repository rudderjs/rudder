# @rudderjs/database

The SQL data-layer foundation (`Illuminate\Database` analog): the `DB` facade + registry bridge (Phase 1, #823) and — since the Phase-2 relocation (#889/#891/#892, plan: `docs/plans/2026-06-04-database-extraction-phase-2.md`) — the **native SQL engine's home**. `@rudderjs/orm` (Eloquent layer) sits on top; `@rudderjs/orm/native` and `@rudderjs/orm/sticky` are permanent re-export shims of this package.

## Hard invariants

- **NEVER depend on `@rudderjs/orm`** — not even as a devDependency (turbo's `^build` topology counts devDeps; a `database → orm` dev edge is a package-graph cycle and turbo rejects it). Tests that need the `Model` layer live in `packages/orm/src/native/` instead. Doc comments / test-fixture strings mentioning `@rudderjs/orm` are fine; imports are not.
- **Node-only.** Never reachable from a client bundle. The orm-side `db-bridge.ts` (the only orm module importing this package at runtime) is imported solely from adapter providers, never from orm's client-reachable main entry.
- **globalThis cache keys are frozen** — they keep their historical `orm` names on purpose (dual-load convergence + dev re-boot reuse across version upgrades; renaming orphans live driver handles → pooled-connection leaks):
  - `__rudderjs_native_client__` (`native/adapter.ts`) — per-connection Map `{signature, driver, readDrivers, dialect}` keyed `connectionName ?? signature`. Don't change the signature format either.
  - `__rudderjs_orm_sticky__` (`sticky.ts`) — the sticky-read AsyncLocalStorage, shared with the orm shim and orm-drizzle.
- **`stripInternal` trap**: `tsconfig.base.json` sets `stripInternal: true`, and tsc text-scans **leading comments (line comments included)** for the literal JSDoc internal tag — a tagged (or even *mentioning*) comment strips the next declaration from the emitted `d.ts`, silently breaking cross-package consumers (orm's engine suites import internals like `makeBindings`/`quoteSqlString`). Don't tag engine exports; don't spell the tag out in comments above exports.

## Layout

- `src/db.ts` — `DB` facade (`select/insert/update/delete/statement/transaction/raw/listen/connection`); resolves the active adapter via the registry bridge — one connection shared with Models, never a second.
- `src/registry-bridge.ts` — inversion seam: orm's `db-bridge.ts` *pushes* `ModelRegistry.getAdapter` / `transaction()` / the named-connection resolver in (database can't import orm). Module-scoped state, re-registered each boot by the providers.
- `src/sticky.ts` — sticky-read request scope, exported at `./sticky` (node-only; orm re-exports it).
- `src/expression.ts` / `src/execution.ts` — re-exports from `@rudderjs/contracts` (`Expression`/`raw`, `Row`/`Executor`/`Transaction`/`Connection`). Contracts owns them to avoid a build cycle and keep the QB raw methods client-safe.
- `src/native/` — the engine: `compiler.ts` (SQL compiler, shared positional `Bindings`), `dialect.ts` + `dialect-pg.ts` + `dialect-mysql.ts`, `driver.ts` (seam; `AffectingExecutor` = MySQL no-RETURNING path), `drivers/` (lazy-load their optional-peer package), `query-builder.ts` (`NativeQueryBuilder`), `adapter.ts` (`NativeAdapter`, dev-HMR client cache), `isolation.ts` (`transaction(fn, { isolationLevel })` support — the lowercase-ANSI → SQL-keyword map IS the injection gate, the level is spliced never bound; pg emits `SET TRANSACTION ISOLATION LEVEL` as the FIRST statement inside BEGIN, mysql must emit it BEFORE `beginTransaction` — the un-scoped form applies to the NEXT transaction only, so the pooled connection releases clean; sqlite + savepoint scopes throw), `schema/` (Blueprint, DDL compiler, `SchemaBuilder`, `Migration`/`Schema`/`Migrator`, introspection, schema→TS type generator).
- `src/native/index.ts` — full engine barrel (`./native` subpath); the main entry re-exports the headline API (`Migration`, `Schema`, `NativeAdapter`, drivers). The barrel header documents what must stay un-tagged and why.

## What does NOT live here (by design)

- **`NativeDatabaseProvider`** — stays at `@rudderjs/orm/native/provider` (wires `ModelRegistry`/`ConnectionManager`/db-bridge, all orm state; auto-discovery reads orm's `rudderjs.providerSubpath`).
- **`ConnectionManager`** (`__rudderjs_orm_connections__`) — stays in orm: it's re-exported from orm's client-reachable main entry and `Model._adapterQb()` calls `peek()` on that path. `DB.connection()` reaches it via the injected resolver.
- **Model-coupled engine tests** (28 suites incl. `drivers/postgres.test.ts`, `drivers/mysql.test.ts`, `types-story-e2e.test.ts`) — in `packages/orm/src/native/`; they exercise Model↔engine integration. `types-story-e2e` looks pure but spawns `tsc` over a fixture importing `@rudderjs/orm` and reads orm's `dist-test` via cwd — coupling via fixtures, not imports.

## Testing

- `pnpm test` = `tsc -p tsconfig.test.json && node --test "dist-test/**/*.test.js"`. **`rm -rf dist-test` before trusting counts** (stale compiled tests lie).
- Live suites (`schema/pg-introspect`, `schema/mysql-introspect`, parts of moved dialect tests) gate on `PG_TEST_URL` / `MYSQL_TEST_URL` — declared in turbo's `test.env` (#885; before that, turbo's strict env mode stripped them and live CI was green-by-skip). CI: the `orm-pg` / `orm-mysql` jobs run `--filter @rudderjs/orm --filter @rudderjs/database`.
- Moved tests import their subjects **relatively** (`./compiler.js`), not via `@rudderjs/database/native` self-reference — self-reference resolves to `dist/` which turbo's `^build` does not rebuild for the package's own test task.
