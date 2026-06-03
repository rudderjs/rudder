# ORM Multi-Connection + Read/Write Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Laravel-parity database connections — named connections (`DB.connection('reporting')`, `Model.on('reporting')`, per-model `static connection`) and read/write replica splitting with sticky reads, on top of the existing single-adapter architecture.

**Architecture:** A lazy, memoized `ConnectionManager` in `@rudderjs/orm` holds *factories* (registered by each adapter provider at boot) and opens connections on first use — preserving today's "connections config is a menu" semantics. The transaction ALS store becomes per-connection-name so transactions on different connections don't cross-join. Read/write split lands fully on the native engine (two driver pools + routing at the executor seam + an ALS sticky flag), on Drizzle as a follow-on, and as a clear-throw on Prisma (pointer to `@prisma/extension-read-replicas`).

**Tech Stack:** TypeScript strict/NodeNext, `node:async_hooks` AsyncLocalStorage, existing `OrmAdapter` contract (`@rudderjs/contracts`), `@rudderjs/database` bridge hooks, native engine drivers (better-sqlite3 / porsager postgres / mysql2).

---

## 0. Context for a fresh session

Read these before starting (they are the architecture this plan extends):

- `docs/plans/2026-06-01-database-package-extraction.md` — the `@rudderjs/database` boundary. §2.4 explicitly defers "a dedicated ConnectionRegistry (named connections + read/write split)" to a later fill. **This plan is that fill.**
- `packages/orm/src/index.ts:257-277` — `ModelRegistry`: single `_store.adapter`, `getAdapter()` checks the transaction ALS (`_store.txStorage`) first. The store lives on `globalThis.__rudderjs_orm_registry__` (survives Vite SSR module re-eval).
- `packages/orm/src/index.ts:150-187` — `transaction()`: `AsyncLocalStorage<OrmAdapter>` threads the tx-scoped adapter.
- `packages/database/src/registry-bridge.ts` — push-based bridge (`registerAdapterResolver` / `registerTransactionRunner`); `@rudderjs/database` must NEVER import `@rudderjs/orm`.
- `packages/database/src/db.ts` — the `DB` facade over the bridge.
- `packages/orm/src/db-bridge.ts` — orm side-effect module that pushes `ModelRegistry.getAdapter` + `transaction` into the bridge.
- `packages/orm/src/native/provider.ts` — `NativeDatabaseProvider.boot()`: reads `config('database')`, builds **one** adapter for `connections[cfg.default]` when `engine: 'native'`, calls `ModelRegistry.set(adapter)`.
- `packages/orm/src/native/adapter.ts:54-180` — `NativeAdapter.make()` + the `globalThis.__rudderjs_native_client__` HMR client cache, **single entry** keyed by signature `driver::url`. Same pattern in `orm-prisma/src/index.ts:34-82` (`__rudderjs_prisma_client__`) and orm-drizzle (`__rudderjs_drizzle_client__`).
- `packages/orm-prisma/src/index.ts:1490-1510` + `packages/orm-drizzle/src/index.ts:2146-2168` — the adapter `DatabaseProvider`s (each reads `cfg.connections[cfg.default]`, `ModelRegistry.set`).
- CLAUDE.md pitfall: **never construct a fresh DB client per dev re-boot** — the per-signature globalThis caches exist to prevent pooled-connection leaks (MySQL `max_connections` exhaustion in ~9 edits). Every cache change here must preserve that.

**Hard constraints:**

1. `@rudderjs/orm`'s main entry is **client-bundle-reachable**. `ConnectionManager` and the deferred QB (Task 3) must have no top-level `node:` imports and no unguarded `process.env`. The Client Bundle Smoke gate (`pnpm test:client-bundle`) enforces this.
2. **Menu semantics:** existing apps list sqlite/postgresql/mysql alternates in `connections` with only one driver installed. Never eagerly open (or even `import()` the driver for) a connection nobody asked for.
3. **One adapter instance per connection name** — `DB.connection('x')` and a Model bound to `'x'` must share the same adapter/pool.
4. orm tests live in `packages/orm/src/**/*.test.ts`, compile via `tsconfig.test.json` to `dist-test/`, run with `pnpm test` (glob discovery since #852 — no test-list edits needed).

---

## 1. Config shape (target)

```ts
// config/database.ts — all new keys optional; existing configs keep working untouched
export default {
  default: Env.get('DB_CONNECTION', 'sqlite'),

  connections: {
    sqlite: { driver: 'sqlite' as const, url: Env.get('DATABASE_URL', 'file:./dev.db') },

    // named connection — opened lazily on first use
    reporting: {
      engine: 'native' as const,
      driver: 'pg' as const,
      url:    Env.get('REPORTING_DATABASE_URL', ''),
    },

    // read/write split (native engine)
    primary: {
      engine: 'native' as const,
      driver: 'pg' as const,
      url:    Env.get('DATABASE_URL', ''),          // write URL (alias: write.url)
      read:   { url: [Env.get('DB_REPLICA_1', ''), Env.get('DB_REPLICA_2', '')] },
      sticky: true,                                  // reads-after-write go to the writer
    },
  },
}
```

Semantics (Laravel parity):
- `read.url` — one URL or an array (round-robin per query). `write.url` optional, defaults to top-level `url`.
- Reads (un-locked SELECTs, `selectRaw`, `DB.select`) → read pool. Writes, DDL, `affectingStatement`, **all transactions**, and locked selects (`lockForUpdate`/`sharedLock`) → write pool.
- `sticky: true` — after any write on that connection *within the current request scope*, subsequent reads in the same scope use the write pool.

---

## 2. PR sequence

Each task = one PR, independently shippable, with its own changeset (`feat` → minor; the txStorage shape change in Task 1 is internal, not a major). Branch per task off `main`. TDD throughout: write the failing test, see it fail, implement, see it pass, commit.

---

### Task 1: ConnectionManager + per-name transactions + `DB.connection(name)` (native engine end-to-end)

**Files:**
- Create: `packages/orm/src/connection-manager.ts`
- Create: `packages/orm/src/connection-manager.test.ts`
- Modify: `packages/orm/src/index.ts` (ModelRegistry + transaction ALS shape, re-export ConnectionManager)
- Modify: `packages/orm/src/db-bridge.ts` (push connection resolver + named tx runner)
- Modify: `packages/orm/src/native/provider.ts` (register factories for every `engine: 'native'` connection)
- Modify: `packages/database/src/registry-bridge.ts` + `packages/database/src/db.ts` (`DB.connection(name)`)
- Create: `packages/database/src/db-connection.test.ts` (or extend the existing facade test file)

**Step 1 — ConnectionManager (client-safe, globalThis-backed like ModelRegistry):**

```ts
// packages/orm/src/connection-manager.ts
import type { OrmAdapter } from '@rudderjs/contracts'

export type ConnectionFactory = () => Promise<OrmAdapter>

interface Entry {
  factory: ConnectionFactory
  adapter: OrmAdapter | null            // memoized once opened
  opening: Promise<OrmAdapter> | null   // single-flight guard
}
// store on globalThis.__rudderjs_orm_connections__ — same dev-reboot rationale
// as ModelRegistry's __rudderjs_orm_registry__

export class ConnectionManager {
  /** Provider boot: register a lazy factory. Re-registering (dev re-boot)
   *  replaces the factory and clears the memoized adapter — the underlying
   *  client is still reused via the adapter package's per-signature
   *  globalThis cache, so this does NOT leak connections. */
  static register(name: string, factory: ConnectionFactory): void
  static has(name: string): boolean
  /** Sync; null when registered-but-not-yet-opened. Never opens. */
  static peek(name: string): OrmAdapter | null
  /** Opens on first call (single-flight), memoizes. Throws a clear
   *  "unknown connection 'x' — configured names are [...]" error. */
  static async ensure(name: string): Promise<OrmAdapter>
  static defaultName(): string | null
  static setDefaultName(name: string): void
  /** @internal test-only */
  static __reset(): void
}
```

No `node:` imports, no top-level `process` reads — this module is on the client-reachable graph.

**Step 2 — per-name transaction scoping.** In `packages/orm/src/index.ts`, change the ALS payload from `OrmAdapter` to a map so a transaction on `reporting` doesn't capture default-connection queries (and vice versa):

```ts
// was: AsyncLocalStorage<OrmAdapter>
// now: AsyncLocalStorage<ReadonlyMap<string, OrmAdapter>>   // name → tx-scoped adapter

export async function transaction<T>(fn: () => Promise<T>, opts?: { connection?: string }): Promise<T> {
  const name    = opts?.connection ?? ConnectionManager.defaultName() ?? '__default__'
  const adapter = opts?.connection ? await ConnectionManager.ensure(name) : ModelRegistry.getAdapter()
  // … capability check unchanged …
  return adapter.transaction((tx) => {
    const parent = storage.getStore()
    const next   = new Map(parent ?? [])
    next.set(name, tx)
    return storage.run(next, fn)
  })
}
```

`ModelRegistry.getAdapter(name?)` gains an optional name: scoped-map lookup by `name ?? defaultName` first, then `ConnectionManager.peek(name)` for named connections, then the legacy `_store.adapter` for the default. **Back-compat:** zero-arg `getAdapter()` behaves byte-for-byte as today (default name maps to `_store.adapter`; nested default transactions still resolve through the map).

**Step 3 — native provider registers factories.** In `NativeDatabaseProvider.boot()`: keep the existing default-connection eager path (`ModelRegistry.set`) untouched, then additionally:

```ts
ConnectionManager.setDefaultName(cfg.default)
for (const [name, conn] of Object.entries(cfg.connections)) {
  if (conn.engine !== 'native') continue
  ConnectionManager.register(name, () => NativeAdapter.make({ /* conn’s driver/url/primaryKey */ }))
}
```

`NativeAdapter.make` already lazy-imports the driver package — registering a factory does **no I/O and no import** (menu semantics hold).

**Step 4 — native HMR client cache → per-name map.** In `packages/orm/src/native/adapter.ts`, `__rudderjs_native_client__` becomes `Map<cacheKey, NativeClientCacheEntry>` where `cacheKey` includes the connection identity. Simplest correct key: keep the entry keyed by the existing `driver::url` *signature* (a map of signatures). Same dispose-superseded-on-signature-change behavior per entry. Add a test that two `make()` calls with different URLs coexist (today the second evicts the first — that eviction would close a live named connection).

**Step 5 — DB facade.** In `packages/database`:

```ts
// registry-bridge.ts — new hooks, same push pattern
export type ConnectionResolver = (name: string) => Promise<OrmAdapter>
export type NamedTransactionRunner = <T>(name: string, fn: () => Promise<T>) => Promise<T>
export function registerConnectionResolver(fn: ConnectionResolver): void
export function registerNamedTransactionRunner(fn: NamedTransactionRunner): void
```

```ts
// db.ts
DB.connection(name: string)  // returns a scoped facade:
//   select/insert/update/delete/statement — await resolver(name), then same seams
//   transaction(fn) — namedTxRunner(name, fn)
//   listen(listener) — async on the scoped facade (await resolver first); document the divergence
```

`packages/orm/src/db-bridge.ts` pushes `(name) => ConnectionManager.ensure(name)` and `(name, fn) => transaction(fn, { connection: name })`.

**Step 6 — tests** (sqlite, two temp files — the two-files trick proves isolation without a server):

- `connection-manager.test.ts`: register/peek/ensure single-flight (two concurrent `ensure()` → one factory call), unknown-name error text, re-register clears memo.
- tx isolation: open `a` (default) + `b` (named); inside `transaction(fn, { connection: 'b' })` write via both connections, throw — `b`'s write rolls back, `a`'s committed. And the inverse with a default-connection transaction.
- `db-connection.test.ts`: `DB.connection('b').select/insert` hits file B; `DB.select` still hits file A; `DB.connection('b').transaction` rollback; unknown name rejects.
- Run: `cd packages/orm && pnpm test`, `cd packages/database && pnpm test`, root `pnpm typecheck` + `pnpm test:client-bundle`.

---

### Task 2: `Model.on(name)` + `static connection` (deferred QB)

**Files:**
- Create: `packages/orm/src/deferred-connection-qb.ts`
- Create: `packages/orm/src/model-connection.test.ts`
- Modify: `packages/orm/src/index.ts` (`static connection`, `Model.on()`, `_q()` routing)

**Design — the sync-construction problem.** `Model.query()` obtains the adapter QB synchronously (`_q()` → `ModelRegistry.getAdapter().query(table)`), but a lazily-opened named connection only materializes via `await ConnectionManager.ensure(name)`. Bridge it with a **record-and-replay QB**:

```ts
// deferred-connection-qb.ts (client-safe)
const TERMINALS = new Set(['get','first','count','paginate','cursorPaginate','pluck','value',
  'sum','max','min','avg','exists','doesntExist','_aggregate','create','update','delete',
  'restore','insertMany','deleteAll','upsert','increment','decrement','chunk','lazy'])

export function deferredQuery(ensure: () => Promise<OrmAdapter>, table: string, opts?: OrmAdapterQueryOpts): QueryBuilder<…>
```

A Proxy that queues every non-terminal method call (`{ method, args }`, returns itself) and, on a terminal, does `const qb = (await ensure()).query(table, opts)` → replays the queue in order → invokes the terminal. `lazy` wraps as `async function*` (await ensure inside the generator). Answer `Symbol.for('rudderjs.orm.qb.target')` with `undefined` — `union()` across an unopened named connection then throws the existing "members must be native builders" error; document that `union` members must share a connection.

**Routing in `_q()`:**

```ts
const connName = onOverride ?? this.connection          // new `static connection?: string`
if (connName && connName !== ConnectionManager.defaultName()) {
  // tx-scoped first (per-name map from Task 1), then opened adapter, then deferred
  const adapter = ModelRegistry.getScopedAdapter(connName) ?? ConnectionManager.peek(connName)
  target = adapter ? adapter.query(table, opts) : deferredQuery(() => ConnectionManager.ensure(connName), table, opts)
}
```

Only the *first* query per process on a connection pays the recorder; after `ensure()` memoizes, `peek()` hits and the path is identical to today's. `Model.on('reporting')` is a static returning the hydrating QB with `onOverride` set (Laravel: `User::on('reporting')->where(...)`). The hydrating proxy needs no changes — it wraps the deferred QB like any adapter QB.

**Tests** (sqlite two files): model with `static connection = 'b'` does full CRUD against file B while another model stays on A; `Model.on('b')` one-off; first-query-deferred path (assert factory ran exactly once across 3 concurrent first queries); chainable breadth through the recorder — `where`+`whereIn`+`orderBy`+`limit`, `whereHas`, `withCount`, `chunk`, `lazy`; writes inside `transaction(fn, { connection: 'b' })` join the tx; observer events still fire (they're Model-layer, above the recorder).

Also verify the client-bundle gate still passes (new modules are on the client-reachable graph).

---

### Task 3: Read/write split on the native engine + sticky

**Files:**
- Modify: `packages/orm/src/native/adapter.ts` (read pool(s) + routing)
- Modify: `packages/orm/src/native/query-builder.ts` (terminal read/write hint)
- Modify: `packages/orm/src/native/provider.ts` (config keys `read`/`write`/`sticky`; middleware install)
- Create: `packages/orm/src/sticky.ts` (ALS flag, client-safe lazy `node:async_hooks` like `ensureTxStorage`)
- Create: `packages/orm/src/native/read-write-split.test.ts`

**Adapter:** `NativeAdapter.make` opens the write driver as today, plus N read drivers when `read.url` is set (each lazy via the same `openDriver`). The adapter keeps `readExecutors: Executor[]` + round-robin index. Routing decision lives where the statement kind is known — the native QB's terminals pass a hint:

- read pool: un-locked `compileSelect` terminals, `selectRaw`
- write pool: everything else — writes, DDL (`affectingStatement`, schema builder), locked selects, **and the entire `transaction()` scope** (tx-scoped adapter gets `readExecutors = []`)

Sticky check happens at routing time: `if (sticky && stickyWrote(connName)) use write`. Any write through the adapter calls `markWrote(connName)`.

**Sticky scope (`sticky.ts`):** `AsyncLocalStorage<Set<string>>` (connection names that wrote), entered per request by a tiny `databaseContextMiddleware` the provider appends to **both** `web` and `api` groups via `appendToGroup` (core export — see CLAUDE.md middleware-groups section). Outside a request scope (queue jobs, rudder commands) the flag is a no-op and reads go to the replica — document this divergence (Laravel resets per request anyway; long-lived Node would otherwise go sticky-forever after the first write).

**HMR cache:** the per-name cache entry's signature becomes `driver::writeUrl::read1,read2` so a replica-list edit disposes and reopens that connection only.

**onQuery:** the query-event `connection` field currently carries the driver name (`adapter.ts:150`) — carry the connection *name* instead, and add `target: 'read' | 'write'` to the event payload. Telescope/`DB.listen` consumers get routing visibility for free.

**Tests:** two sqlite files as write/read "replicas" — seed file R directly via a second adapter, then through the split adapter: un-locked select returns R's data (read pool), write goes to W, select-inside-transaction returns W's data, `lockForUpdate().get()` returns W's data; sticky: within `runWithDatabaseContext`, write-then-read returns W's data with `sticky: true` and R's without; round-robin across two read files alternates (assert via `onQuery` events or data divergence). Gated live-pg run (`PG_TEST_URL`, read=write same server) asserting `target` tags on events. The TZ lesson from #858/#860 applies: any timestamp assertions on live pg compare server-side via `::text`.

---

### Task 4: Prisma + Drizzle named connections; Drizzle read/write; Prisma clear-throw

**Files:**
- Modify: `packages/orm-prisma/src/index.ts` (provider factories, per-name client-cache map, read/write throw)
- Modify: `packages/orm-drizzle/src/index.ts` (provider factories, per-name client-cache map, read/write routing)
- Create: `packages/orm-prisma/src/connections.test.ts`, `packages/orm-drizzle/src/connections.test.ts`

**Both providers** mirror Task 1's native pattern: keep the eager default path, register lazy factories for every connection whose shape they own (prisma: no `engine` key or `engine: 'prisma'`; drizzle likewise — reuse the same inertness discriminator each provider already gates on so the two adapter providers don't claim each other's connections). Client caches `__rudderjs_prisma_client__` / `__rudderjs_drizzle_client__` become per-name maps, preserving dispose-on-signature-change per entry (the CLAUDE.md leak rule).

**Prisma specifics:** factory = `new PrismaClient({ datasourceUrl: conn.url })` wrapped in `PrismaAdapter`. All named connections share the one generated schema — document that named Prisma connections must be schema-compatible databases. `read`/`write` keys on a prisma connection → **throw at boot** with a pointer to `@prisma/extension-read-replicas` (consistent with the established Prisma throw-with-pointer pattern — locking #856, selectRaw, etc.).

**Drizzle specifics:** factory builds the per-driver client (postgres / mysql2 / better-sqlite3 / libsql) + drizzle instance; `DrizzleTableRegistry` stays shared across connections (tables describe shape, not location — document). Read/write split: construct read client(s), route at terminal execution with the same rules as Task 3 (un-locked selects → read; tx/locks/writes → write; sticky via the shared `sticky.ts` helpers imported from `@rudderjs/orm`). **Decision point:** if threading the read instance through Drizzle's builder chain turns out to be invasive, ship named connections + a clear-throw for `read`/`write` on Drizzle in this PR and split routing into its own follow-up — don't let it block the rest.

**Tests:** sqlite-driver variants of the Task 1/2 suites (two temp DBs, named CRUD isolation, per-name tx); drizzle read/write routing mirrors Task 3's two-file suite; prisma `read:` config boot-throw asserts the error text.

---

### Task 5: Docs + playground + CLAUDE.md

**Files:**
- Create: `docs/guide/database/connections.md` (named connections, `DB.connection`, `Model.on`/`static connection`, read/write + sticky, per-adapter support matrix)
- Modify: `docs/guide/database.md` (link), `playground/config/database.ts` (commented `reporting` + `read/sticky` example), root `CLAUDE.md` (pitfalls: lazy menu semantics; per-name client caches; sticky scope boundaries; `union` single-connection rule), `packages/orm/CLAUDE.md`
- Post-merge: rudderjs.com 4-step docs sync (sync, delete, rebuild index/OG, sidebar).

Deferred follow-ups (note in the doc, don't build): `Schema.connection(name)` + `migrate --connection` (migration runner is default-connection-only for now), `pnpm rudder db:*` connection flags, queue-worker sticky scoping.

---

## 3. Risks / guardrails

- **Client bundle:** `connection-manager.ts`, `deferred-connection-qb.ts`, `sticky.ts` are client-reachable — no top-level `node:` imports (lazy `await import('node:async_hooks')` like `ensureTxStorage`), no unguarded `process.env`. Gate: `pnpm test:client-bundle`.
- **Connection leaks on dev re-boot:** every client cache stays globalThis-backed with per-entry signature disposal. Re-registering factories must NOT bypass those caches. Validate with the #652 methodology if touching pooled drivers.
- **Menu semantics:** registering ≠ opening. A configured-but-unused mysql connection in a sqlite app must never `import('mysql2')`.
- **No second connection for the same name:** `DB.connection('x')`, `Model.on('x')`, and `static connection = 'x'` all resolve through `ConnectionManager.ensure('x')` — one adapter, one pool.
- **txStorage shape change is internal** (`AsyncLocalStorage` payload type) — no public API change, but grep for direct `txStorage` consumers before changing (`getStore()` call sites in orm only).
- **Transactions/locks never touch replicas.** Locked selects route write-side even outside transactions.
- **Don't break the perf fast path:** zero-arg `getAdapter()` and default-connection `_q()` must not gain per-query map allocations — default path short-circuits before any named-connection logic.
