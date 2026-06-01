# PR1 — Scaffold @rudderjs/database + DB facade skeleton (resume plan)

> Status: **design complete, implementation not started** (no branch yet, repo clean).
> Blocked mid-research by a harness output-staging bug (random tool-output
> truncation/loss — see memory `env-harness-tmpfs-output-truncation`). All the
> source facts below were captured from clean reads before the channel degraded.
> A fresh session with `CLAUDE_CODE_TMPDIR` set (or restarted) can execute this
> end-to-end.

Branch: `feat/database-package-pr1` off fresh `main`. Commits authored
`Suleiman Shahbari <13323859+suliemandev@users.noreply.github.com>`, no Claude
trailer.

## Key architecture decisions (for the PR description)

### Decision A — execution types live in @rudderjs/contracts, NOT @rudderjs/database
Item 2 asks for the types "owned by @rudderjs/database and re-exported through
@rudderjs/contracts." That direction is a **hard build cycle**: `@rudderjs/database`
depends on `@rudderjs/contracts` (for `OrmAdapter`), so having `contracts`
re-export from `database` makes `contracts ⇄ database` mutually dependent —
and `contracts` is the repo's zero-dependency foundation. So:
- **Canonical `Row` / `Executor` / `Transaction` / `Connection` are defined in
  `@rudderjs/contracts`** (beside `OrmAdapter` — exactly the layering Laravel uses:
  contracts are the foundation, the DB facade sits on top).
- **`@rudderjs/database` re-exports them** and is the conceptual home of the DB
  *facade*.
- Single import point = `@rudderjs/contracts`, which every adapter already
  depends on → **no flag-day** (the stated goal of item 2's parenthetical).

### Decision B — registry bridge runs orm → database (item 4)
`@rudderjs/database` can't import `@rudderjs/orm`. `@rudderjs/orm` PUSHES its
`ModelRegistry.getAdapter` accessor into `@rudderjs/database` via
`registerAdapterResolver(fn)`. Chosen over "move the registry getter behind a
contracts-owned interface" because it's a 3-line module and keeps `ModelRegistry`
authoritative. Bonus: resolving through `getAdapter()` (not a cached adapter)
means `DB.*` inside a `Model.transaction()` callback transparently joins the open
transaction (getAdapter already returns the ALS-scoped adapter).

### Decision C — DB kept off the client/Model graph
`scripts/client-bundle-smoke.mjs` TARGETS include `@rudderjs/orm` (main
`src/index.ts`) — it IS client-reachable. So the bridge must NOT be imported by
`orm/src/index.ts` or `orm/src/client.ts`. It lives in a separate node-only
module `orm/src/db-bridge.ts`, imported for side effect only from the three
adapter providers. (`@rudderjs/database` is itself browser-safe — no `node:`
imports, no top-level `process.env` — so it wouldn't fail the smoke gate; we keep
it off the client path on principle per the task.)

## Verified source facts (ground truth)

- `packages/contracts/src/index.ts` (739 ln): `OrmAdapter` at L348 with
  `query`/`connect`/`disconnect`/`transaction?` (transaction? at L366, closes L367).
  No `Row`/`Executor` yet. contracts has ZERO deps (version 1.9.0).
- `packages/orm/src/native/driver.ts` (74 ln): defines `Row = Record<string,unknown>`
  (L14), `Executor` (L29, `execute(sql, bindings: readonly unknown[]): Promise<Row[]>`),
  `Transaction extends Executor` (L52, `transaction<T>(fn)`), `Driver extends
  Transaction` (L71, `close()`). **No `Connection` and no `types.ts`** — `native/types.ts`
  does NOT exist; Row is in driver.ts. (Earlier garbled reads claiming a types.ts /
  QueryDriver / Connection in driver.ts were corruption — ignore them.)
- `packages/orm/src/native/adapter.ts` (224 ln): `class NativeAdapter implements
  OrmAdapter` (L76), `private readonly executor: Executor` (L79). `query<T>` at
  L122-125: `return new NativeQueryBuilder<T>(this.executor, this.dialect, table, pk)`.
  `transaction` L159-164, `connect` L166-168, `disconnect` L170-182. imports
  `import type { Driver, Executor, Transaction } from './driver.js'` (L17).
- `packages/orm/src/index.ts` (2613 ln): `ModelRegistry.getAdapter()` at L242
  (returns ALS-scoped adapter when inside a tx, else `_store.adapter`, throws if
  none). `ModelRegistry.set(adapter)` at L234.
- `packages/orm/src/client.ts` = browser-safe entry (exports Model etc.); main
  `index.ts` is node-side but IS a client-bundle TARGET.
- `packages/orm/package.json` (v1.13.0): deps only `@rudderjs/contracts`. exports
  has `.`, `./native`, `./native/provider`, `./doctor`, `./commands/*`. provider =
  `NativeDatabaseProvider` @ `./native/provider`. Long explicit test list.
- `packages/orm-prisma/src/index.ts` (1404 ln): `class PrismaAdapter implements
  OrmAdapter` at L1122; `connect` L1216, `disconnect` L1220. Provider `DatabaseProvider`
  boot at L1294 → `ModelRegistry.set(adapter)`, `app.instance('prisma', adapter.prisma)`.
  Client has `$queryRawUnsafe(sql, ...params): Promise<unknown>` (returns
  `Array<Record<string,unknown>>`) and `$executeRawUnsafe`. orm-prisma deps already
  include `@rudderjs/orm`. **TODO: CONFIRMED below — see "CONFIRMED verbatim anchors". (was: class
  head + prisma field decl) and L1216-1223 (connect/disconnect) and the contracts
  import block to build Edit old_strings.**
- `packages/orm-drizzle/src/index.ts`: `type DrizzleDb` at L38; `class DrizzleAdapter
  implements OrmAdapter` at L1048, `readonly db: DrizzleDb` (L1050); `connect` L1149,
  `disconnect` L1153 (`const end = this.db.$client?.end`). QB raw path uses
  `const exec = this.db.execute` then `await exec.call(this.db, fullSql)` /
  `await exec<T[]>(this.db…)`; `sql.raw(opStr)` used at L762 (so `sql` is imported
  from 'drizzle-orm'). contracts import block L9-20 (AggregateFn, AggregateRequest,
  OrmAdapter, OrmAdapterProvider, QueryBuilder, WhereClause, WhereOperator,
  OrderClause, PaginatedResult, RelationExistencePredicate). **CONFIRMED: `sql` +
  `type SQL` imported at L1-8; `execute?(query: SQL): Promise<unknown>` at L46;
  disconnect at L1153-1156 (see "CONFIRMED verbatim anchors").**
- tsconfig.base.json: ES2022, NodeNext, strict, exactOptionalPropertyTypes,
  noUncheckedIndexedAccess, declaration+maps. Per-pkg tsconfigs mirror cache's
  (build → outDir dist/rootDir src/exclude *.test.ts; test → outDir dist-test;
  json → noEmit).

## Implementation steps

### 1. contracts/src/index.ts
Add BEFORE `export interface OrmAdapter` (after `OrmAdapterQueryOpts`, ~L347):
```ts
// ─── DB execution contracts (DB-facade seam) ───────────────
// Model-independent SQL execution surface. Owned here (the zero-dep foundation,
// beside OrmAdapter) and surfaced to apps via @rudderjs/database's DB facade,
// which re-exports these. The native engine implements them; every adapter
// shares this one import point (no flag-day if the data layer is later split).
export type Row = Record<string, unknown>
export interface Executor {
  execute(sql: string, bindings: readonly unknown[]): Promise<Row[]>
}
export interface Transaction extends Executor {
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
}
export interface Connection extends Transaction {
  close(): Promise<void>
}
```
Add INSIDE OrmAdapter, after the `transaction?` member (before the closing `}` at L367):
```ts
  /** Raw SELECT escape hatch — read half of @rudderjs/database's DB facade.
   *  Optional; the facade throws an adapter-named error when omitted. */
  selectRaw?(sql: string, bindings: readonly unknown[]): Promise<Row[]>
  /** Raw writing-statement escape hatch — write half (insert/update/delete/
   *  statement). Resolves to rows affected. Optional, same as selectRaw. */
  affectingStatement?(sql: string, bindings: readonly unknown[]): Promise<number>
```
(Update contracts/CLAUDE.md exports line + bump minor via changeset.)

### 2. New package packages/database/
- `package.json`: name `@rudderjs/database`, version `1.0.0`, type module, engines
  node ^20.19.0||>=22.12.0, files ["dist"], main/types dist, exports `.` only,
  scripts mirror cache (build `tsc -p tsconfig.build.json`, dev, typecheck, lint,
  clean, test `tsc -p tsconfig.test.json && node --test dist-test/index.test.js`),
  dependencies `{ "@rudderjs/contracts": "workspace:^" }`, devDeps
  `@types/node ^20`, `typescript ^5.4`, `tsx ^4`. **No `rudderjs` provider field**
  (database has no provider — the bridge is pushed by orm). author Suleiman Shahbari.
- `tsconfig.json` / `tsconfig.build.json` / `tsconfig.test.json`: copy cache's verbatim.
- `src/execution.ts`:
  ```ts
  export type { Row, Executor, Transaction, Connection } from '@rudderjs/contracts'
  ```
- `src/expression.ts`: `class Expression { constructor(private readonly value: string|number){} getValue(){return this.value} toString(){return String(this.value)} }` + `export function raw(value: string|number){ return new Expression(value) }`.
- `src/registry-bridge.ts`: module-level `let resolver: (()=>OrmAdapter)|null = null`;
  `registerAdapterResolver(fn)`, `resolveAdapter()` (throws clear error if null),
  `__resetAdapterResolver()` (internal, for tests). import type OrmAdapter from contracts.
- `src/db.ts`: `DB` object with `select`→selectRaw, `insert/update/delete/statement`
  →affectingStatement (all `(sql, bindings: readonly unknown[] = [])`; writes return
  number), `raw(v)`→Expression. Guards `requireSelectRaw`/`requireAffecting` throw
  `[RudderJS DB] <AdapterCtorName> does not implement selectRaw()/affectingStatement()`.
  Adapter name via `adapter.constructor?.name`.
- `src/index.ts`: re-export DB, Expression, raw, registerAdapterResolver,
  resolveAdapter, and `export type { Row, Executor, Transaction, Connection } from './execution.js'`.
- `src/index.test.ts`: fake-adapter tests — (a) resolveAdapter throws when empty,
  (b) DB.select round-trips + passes sql/bindings through, (c) writes return affected
  count, (d) missing-seam throws adapter-named error, (e) DB.raw wraps. Reset resolver
  between tests via `__resetAdapterResolver`.

### 3. orm/src/native/driver.ts — replace whole body
```ts
// ─── Driver seam (per-platform) ───
// (keep the existing explanatory comment block)
// Canonical Row/Executor/Transaction/Connection are owned by @rudderjs/contracts
// and surfaced via @rudderjs/database; the native engine implements them
// unchanged. Re-exported here so existing './driver.js' import sites keep working.
export type { Row, Executor, Transaction, Connection } from '@rudderjs/contracts'
import type { Connection } from '@rudderjs/contracts'
/** Per-platform connection the native engine drives — alias of the canonical
 *  Connection; the name marks the swappable driver seam. */
export interface Driver extends Connection {}
```
(adapter.ts/query-builder.ts/drivers import Driver/Executor/Transaction/Row from
'./driver.js' — all still exported. better-sqlite3/postgres drivers implement
Driver = Connection: execute+transaction+close — unchanged.)

### 4. orm/src/native/adapter.ts
- L17 import: add `Row` → `import type { Driver, Executor, Transaction, Row } from './driver.js'`.
- After the `query<T>` method (L122-125), insert:
  ```ts
  async selectRaw(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    return this.executor.execute(sql, bindings)
  }
  async affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number> {
    const rows = await this.executor.execute(sql, bindings)
    return rows.length   // native execute returns affected/RETURNING-* rows
  }
  ```

### 5. orm/src/db-bridge.ts (new)
```ts
// Node-only. Pushes ModelRegistry's adapter accessor into @rudderjs/database so
// the DB facade resolves the SAME active adapter as the Models (one connection).
// Imported for side effect ONLY from adapter providers — never from orm's
// main/client entry, so DB stays out of client bundles.
import { registerAdapterResolver } from '@rudderjs/database'
import { ModelRegistry } from './index.js'
registerAdapterResolver(() => ModelRegistry.getAdapter())
```

### 6. orm/package.json
- dependencies: add `"@rudderjs/database": "workspace:^"`.
- exports: add
  ```json
  "./db-bridge": { "import": "./dist/db-bridge.js", "default": "./dist/db-bridge.js", "types": "./dist/db-bridge.d.ts" }
  ```
- test script: append ` dist-test/native/db-facade.test.js`.
- bump minor via changeset (new dep + re-export surface).

### 7. orm/src/native/provider.ts
Add side-effect import at top: `import '../db-bridge.js'`.

### 8. orm/src/native/db-facade.test.ts (new) — the required native round-trip
```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DB } from '@rudderjs/database'
import { ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import '../db-bridge.js'
test('DB.select round-trips on the native engine', async () => {
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
  ModelRegistry.set(adapter)
  const rows = await DB.select('select 1 as one', [])
  assert.equal(rows.length, 1); assert.equal(rows[0]?.one, 1)
  await adapter.disconnect()
})
```

### 9. orm-prisma/src/index.ts
- contracts import block: add `Row`.
- After `disconnect` (L1220-~1222), inside PrismaAdapter, insert:
  ```ts
  async selectRaw(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    const client = this.prisma as unknown as {
      $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T>
    }
    return (await client.$queryRawUnsafe<Row[]>(sql, ...bindings)) ?? []
  }
  async affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number> {
    const client = this.prisma as unknown as {
      $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>
    }
    return client.$executeRawUnsafe(sql, ...bindings)
  }
  ```
- Provider boot: add `import '@rudderjs/orm/db-bridge'` at top of file.
- bump patch/minor via changeset (impl).

### 10. orm-drizzle/src/index.ts
- contracts import block (L9-20): add `Row`.
- Confirm `sql` and `SQL` imported from 'drizzle-orm' (L1-8); add `SQL` if missing.
- Add a module helper:
  ```ts
  function rawSql(text: string, bindings: readonly unknown[]): SQL {
    if (bindings.length === 0) return sql.raw(text)
    const parts = text.split(/\?|\$\d+/)            // positional placeholders
    const chunks: SQL[] = []
    parts.forEach((part, i) => {
      chunks.push(sql.raw(part))
      if (i < bindings.length) chunks.push(sql`${bindings[i]}`)
    })
    return sql.join(chunks)
  }
  ```
- After DrizzleAdapter `disconnect`, insert:
  ```ts
  async selectRaw(text: string, bindings: readonly unknown[]): Promise<Row[]> {
    const exec = this.db.execute
    if (typeof exec !== 'function') throw new Error('[RudderJS DB] db.execute() is not available on this Drizzle driver.')
    const result = await exec.call(this.db, rawSql(text, bindings))
    return Array.isArray(result) ? result as Row[] : ((result as { rows?: Row[] })?.rows ?? [])
  }
  async affectingStatement(text: string, bindings: readonly unknown[]): Promise<number> {
    const exec = this.db.execute
    if (typeof exec !== 'function') throw new Error('[RudderJS DB] db.execute() is not available on this Drizzle driver.')
    const result = await exec.call(this.db, rawSql(text, bindings)) as unknown
    if (Array.isArray(result)) return result.length
    const r = result as { rowCount?: number; rowsAffected?: number; changes?: number; affectedRows?: number }
    return r?.rowCount ?? r?.rowsAffected ?? r?.changes ?? r?.affectedRows ?? 0
  }
  ```
  (Verify against DrizzleDb.execute's real return shape — pg/postgres-js returns
  array; better-sqlite3 returns `{ changes }`; mysql2 `{ affectedRows }`. The
  fallback covers all. **Drizzle has no runtime test for these in PR1 — relies on
  typecheck + existing suite not breaking; note this in the PR.**)
- Provider boot: add `import '@rudderjs/orm/db-bridge'` at top of file.
- bump patch/minor via changeset (impl).

### 11. Changeset
One file, minor: `@rudderjs/database` (new, but new package → its own 1.0.0 entry
may be `minor`/`major`; check repo convention — new packages typically land at
1.0.0 with a `minor`), `@rudderjs/contracts` minor (new optional contract members),
`@rudderjs/orm` minor (new dep + db-bridge subpath), `@rudderjs/orm-prisma` minor
(impl), `@rudderjs/orm-drizzle` minor (impl).

## Verify (required before PR — currently BLOCKED by the env)
- `pnpm install` (link new package).
- `pnpm build` from root; `pnpm typecheck`.
- `pnpm test` (FULL `turbo run test` — CI re-runs cli/boost dependents on any
  orm-touching change; #817 history). `rm -rf dist-test` in orm before trusting counts.
- `pnpm test:client-bundle` (database must stay out of `@rudderjs/orm` client graph).
- New tests: database/src/index.test.ts + orm native db-facade round-trip.

## CONFIRMED verbatim anchors (captured clean — use directly for Edit old_strings)

### orm-prisma/src/index.ts
- Contracts import is a multi-line block `import type {` … `} from '@rudderjs/contracts'`
  ending at L90 — add `Row,` to that list.
- PrismaAdapter (L1122) holds `readonly prismaClient: PrismaClient` and exposes
  `get prisma(): PrismaClient { return this.prismaClient }`. `this.prisma` is typed
  `PrismaClient` — `$queryRawUnsafe`/`$executeRawUnsafe` may not be on that type, so
  cast as in step 9.
- Insert the two methods after this exact block (L1220-1222):
  ```ts
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect()
  }
  ```
- Provider section starts L1288 (`import { ServiceProvider, config } from '@rudderjs/core'`,
  then L1289 `import { ModelRegistry } from '@rudderjs/orm'`). Add
  `import '@rudderjs/orm/db-bridge'` beside L1289. (NOTE these provider imports sit
  mid-file, not at the very top — place the side-effect import next to L1288-1289.)

### orm-drizzle/src/index.ts
- L1-8 already import `sql` and `type SQL` from 'drizzle-orm' — no import change needed
  for those; just add `Row,` to the contracts block (L9-20).
- `DrizzleDb.execute?(query: SQL): Promise<unknown>` (L46) — optional, takes an `SQL`.
  So `rawSql()` must return `SQL` and the methods guard `typeof this.db.execute !== 'function'`.
- Insert the two methods after this exact block (L1153-1156):
  ```ts
  async disconnect(): Promise<void> {
    const end = this.db.$client?.end
    if (typeof end === 'function') await end()
  }
  ```
- Provider boot is also in this file; add `import '@rudderjs/orm/db-bridge'` near the
  other top-of-file imports (drizzle index top imports are at L1-21).

### orm/src/native/adapter.ts
- L17 verbatim: `import type { Driver, Executor, Transaction } from './driver.js'` → add `Row`.
- Insert selectRaw/affectingStatement after this exact block (L122-125):
  ```ts
  query<T>(table: string, opts?: OrmAdapterQueryOpts): QueryBuilder<T> {
    const pk = opts?.primaryKey ?? this.primaryKey
    return new NativeQueryBuilder<T>(this.executor, this.dialect, table, pk)
  }
  ```

### contracts/src/index.ts
- OrmAdapter ends L367 (`transaction?<T>…` at L366, `}` at L367). Add the two optional
  members before L367's `}`. Add the execution-types block before `export interface
  OrmAdapter {` (L348).

## Then
Open PR with description covering Decisions A/B/C + the contract additions; STOP for
review. Do NOT start PR2.
