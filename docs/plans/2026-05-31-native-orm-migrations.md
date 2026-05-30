# Native ORM Migrations + Schema Builder — Implementation Plan

> Phase 7 of `docs/plans/2026-05-30-native-orm-adapter.md`, broken out into its own
> plan as that doc promised. Laravel `Schema`/`Blueprint`-style migrations for the
> native engine — **with TypeScript types as a first-class output, not an
> afterthought.** That types story is what turns this from "tedious re-typing" into
> a genuine DX win.
>
> **Gated:** do not start implementing before **GATE B** of the parent plan (native
> SQLite query path proven). Designing it now (this doc) is fine.

---

## Why this exists, and the one condition that makes it a win

**The DX win (Laravel parity, driver-agnostic):** today the framework's `migrate` /
`make:migration` shell out to `prisma migrate` / `drizzle-kit`
(`packages/orm/src/commands/migrate.ts`). A Laravel dev hits an unfamiliar wall —
they write a `schema.prisma` DSL or a Drizzle TS schema instead of `Schema.create`
+ up/down migration files. Native migrations give one familiar workflow
(`make:migration` → write `up`/`down` → `migrate` / `migrate:rollback`) that is
**identical on SQLite / Postgres / MySQL**, with no external schema tool.

**The condition — TypeScript types.** This is the make-or-break, and the reason a
naive port would be a *regression*:

- Models declare their columns **by hand** today, e.g. `playground/app/Models/User.ts`:
  ```ts
  export class User extends Model {
    id!: string; name!: string; email!: string
    password!: string | null; createdAt!: Date; updatedAt!: Date
  }
  ```
  These are **already duplicated** against the Prisma/Drizzle schema — drift waiting
  to happen.
- Prisma generates a **fully-typed client** from `schema.prisma`; Drizzle infers
  types from its TS schema. A hand-written Laravel migration produces a *table* but
  **no typed Model** — so "Laravel-parity migrations" done naively would trade
  Prisma/Drizzle's typed models for tedium and drift.

**So the headline feature is not the migration runner — it's: migrations are the
single source of truth, and Model column types are generated from them.** Write the
migration once; the Model's field types come for free and stay in sync. That is the
differentiator (Laravel ergonomics **+** end-to-end TS safety), and it's designed
first below.

---

## Part 1 — The types story (designed first, on purpose)

### Goal

After `migrate`, a Model's column types are **generated**, not hand-maintained:

```ts
// app/Models/User.ts — the user writes only intent + behavior
export class User extends Model {
  static table = 'users'
  // no hand-typed id!/name!/... — those come from the generated schema types
}

// User.find(1) → typed as { id: number; name: string; email: string;
//                           password: string | null; createdAt: Date; ... }
```

### Mechanism — mirror the existing `.d.ts` generator pattern

`@rudderjs/vite`'s scanner already emits generated declaration files
(`pages/__view/registry.d.ts`, `pages/__view/routes.d.ts`) that augment framework
types from source. **Reuse that exact pattern** — it's framework-native, already
trusted, and keeps generated code out of hand-edited files.

A `schema:types` step (run automatically after `migrate` / `migrate:fresh`, and on
demand) produces `app/Models/__schema/registry.d.ts`:

```ts
// AUTO-GENERATED — do not edit. Source: database/migrations + live schema.
import '@rudderjs/orm'
declare module '@rudderjs/orm' {
  interface SchemaRegistry {
    users: {
      id:         number
      name:       string
      email:      string
      password:   string | null
      created_at: Date
      updated_at: Date
    }
    // ...one entry per table
  }
}
```

### How the generated types reach a Model — two candidate bindings (decide in 7.x)

- **(A) Generic `Model<TName>`** — `class User extends Model<'users'>`. The base
  `Model` resolves columns via `SchemaRegistry['users']`. Explicit, no magic, one
  string to write. **Recommended** — most discoverable, plays well with
  `exactOptionalPropertyTypes`.
- **(B) `static table` inference** — augment so `User`'s instance type is derived
  from `SchemaRegistry[typeof User.table]`. Zero extra syntax, but TS can't always
  infer instance shape from a static literal cleanly. Riskier.

Whichever wins, `casts` must **override** the generated raw column type (a `json`
column generates `unknown`/`string` but the cast turns it into the rich type; a
`date` cast → `Date`). The generator emits the **storage** type; declared `casts`
refine it. Document this precedence explicitly.

### Source of the types — introspect the live schema (not parse migrations)

Two ways to know a table's shape:

- **Derive statically from migration definitions** — parse every `Schema.create` /
  `Schema.table` and fold them into a current shape. Pure (no DB), but **alters
  make it messy** (the current shape is the accumulation of N migrations, including
  drops/renames/changes) and it re-implements the DB's own truth.
- **Introspect the migrated database** — after `migrate`, read `PRAGMA table_info`
  (SQLite) / `information_schema.columns` (pg/mysql) and emit types from reality.
  **Recommended** — always accurate (handles alters/renames for free), and it's
  exactly how `prisma generate` / drizzle-kit work. Needs a DB connection, which
  `migrate` already has.

> Trade-off to accept: introspection means types regenerate after `migrate`, not at
> the instant you save a migration file. That matches Prisma's `generate` step and
> is fine. A `schema:types` command lets users regenerate on demand without a full
> migrate.

### Types-story acceptance bar

- Edit a migration, run `migrate` → the Model's column types change with zero
  hand-edits, and a wrong column name / type fails `tsc`.
- `casts` refine generated storage types (json/date/encrypted/vector).
- Nullable columns → `T | null`; columns with defaults stay required on read,
  optional on insert (a `Partial`-on-create nuance to design).
- Works with no renderer / standalone Node (it's a `.d.ts`, no runtime cost).

---

## Part 2 — The `Schema` / `Blueprint` surface (Laravel parity)

Mapped against Laravel 13 migrations. **v1 targets the common 80%**; exotic types are
deferred (listed under *Not in scope*).

### Table operations

```ts
Schema.create('users', (t) => { ... })          // CREATE TABLE
Schema.table('users', (t) => { ... })           // ALTER TABLE (add/change/drop/rename)
Schema.drop('users')        Schema.dropIfExists('users')
Schema.rename('users', 'accounts')
await Schema.hasTable('users')                  // boolean (introspection)
await Schema.hasColumn('users', 'email')
```

### Column types (Blueprint)

| Native builder | SQLite | Postgres | MySQL |
|---|---|---|---|
| `t.id()` / `t.bigIncrements('id')` | INTEGER PK AUTOINCREMENT | bigserial PK | BIGINT AUTO_INCREMENT PK |
| `t.string('name', 255)` | TEXT | varchar(255) | varchar(255) |
| `t.text('bio')` | TEXT | text | text |
| `t.integer` / `t.bigInteger` | INTEGER | int / bigint | INT / BIGINT |
| `t.boolean('active')` | INTEGER 0/1 | boolean | tinyint(1) |
| `t.dateTime` / `t.timestamp` | TEXT | timestamptz | datetime/timestamp |
| `t.timestamps()` | created_at + updated_at | " | " |
| `t.softDeletes()` | deleted_at nullable | " | " |
| `t.json('meta')` | TEXT | jsonb | json |
| `t.uuid('id')` | TEXT | uuid | char(36) |
| `t.decimal('amt', 8, 2)` / `t.float` | NUMERIC/REAL | numeric/double | DECIMAL/DOUBLE |
| `t.enum('status', [...])` | TEXT + CHECK | text + CHECK (or native enum) | ENUM(...) |
| `t.foreignId('user_id')` | INTEGER | bigint | BIGINT |
| `t.binary` | BLOB | bytea | BLOB |
| `t.vector('embedding', { dimensions })` | (unsupported → throw) | vector(N) + reuse #B7 | (unsupported) |

### Modifiers (chained)

`.nullable()` · `.default(value)` · `.unique()` · `.index()` · `.primary()` ·
`.unsigned()` · `.comment('…')` · `.useCurrent()` (timestamp default now) ·
`.after('col')` (MySQL) · `.change()` (alter an existing column, in `Schema.table`).

### Indexes & foreign keys

```ts
t.index(['last_name', 'first_name'])    t.unique('email')    t.primary(['a', 'b'])
t.foreign('user_id').references('id').on('users').onDelete('cascade').onUpdate('cascade')
t.foreignId('user_id').constrained()    // Laravel shorthand → users.id, FK inferred
t.dropColumn('votes')   t.renameColumn('from', 'to')   t.dropForeign(['user_id'])   t.dropIndex(...)
```

### Implementation note

The `Blueprint` records column/index/FK **intents** (no SQL yet); a per-dialect
**DDL compiler** (extends the parent plan's `Dialect` seam) turns intents into
`CREATE/ALTER` statements + bindings, executed through the same `Driver`. This keeps
the schema builder dialect-agnostic and the SQL generation in one auditable place.

---

## Part 3 — Migrations: files, runner, state, CLI

### Migration file shape (up/down, hand-authored)

```ts
// database/migrations/2026_05_31_120000_create_users_table.ts
import { Migration, Schema } from '@rudderjs/orm'
export default class extends Migration {
  async up()   { await Schema.create('users', (t) => { t.id(); t.string('name'); t.timestamps() }) }
  async down() { await Schema.dropIfExists('users') }
}
```

`make:migration <name>` generates the stub (timestamped filename, table-name
inference for `create_*_table` / `add_*_to_*_table` like Laravel).

### State + runner

- A `migrations` table (`id`, `migration`, `batch`) tracks applied migrations — the
  Laravel model. Created on first run.
- `migrate` runs all **pending** migrations in one new batch (filename order).
- `migrate:rollback` reverts the **last batch** (calls `down()` in reverse).
- `migrate:refresh` = rollback-all + migrate. `migrate:fresh` = drop all tables +
  migrate (no `down()` needed; faster, dev-default).
- `migrate:status` lists ran / pending with batch numbers.
- Every batch runs inside a **transaction** where the dialect supports
  transactional DDL (Postgres yes; SQLite mostly; MySQL no — DDL auto-commits, so
  document partial-apply risk + recommend small migrations there). *This is the
  concrete reason transactions (parent-plan Phase 4) should land first.*

### CLI wiring (replaces the shell-out)

`migrate` / `migrate:fresh` / `migrate:status` / `make:migration` route to the
native runner when the app uses the native engine; **prisma/drizzle apps keep
shelling out** (the existing `buildArgs` path stays for them). Add `migrate:rollback`
and `migrate:refresh` (native-only initially). After any apply, run `schema:types`.

### Up/down vs schema-diff — recommend up/down

A full schema-diff engine (compute the delta between desired schema and live DB, à
la Prisma) is an order of magnitude more surface and is where Prisma has
person-years. **Hand-authored up/down is more Laravel-faithful, an order of
magnitude smaller, and gives explicit, reviewable, reversible intent.** Ship up/down;
revisit diffing only if real demand appears.

---

## Part 4 — Dialect portability (where the real difficulty is)

- **SQLite `ALTER TABLE` is the gnarly one.** It supports `ADD COLUMN` and
  `RENAME`, but **not** drop-column (pre-3.35), change-type, or add-constraint in
  many builds. The portable path is the **12-step table-rebuild dance** (create new
  table → copy data → drop old → rename) that Laravel/Rails do. This is the single
  biggest implementation cost in `Schema.table`; budget for it explicitly. `better-
  sqlite3` ships a recent SQLite, so use native `DROP COLUMN` where available and
  fall back to rebuild.
- **Postgres**: richest DDL (transactional, `ALTER ... TYPE`, native enums). Easiest.
- **MySQL**: non-transactional DDL (each statement auto-commits) → a failed
  multi-statement migration can half-apply. Document; keep migrations small.
- The `Dialect` seam from the parent plan extends with a DDL compiler; the `Driver`
  executes the generated statements. RN/WASM drivers inherit DDL for free (same
  compiler), so RN apps can run migrations too (subject to the SQLite limits above).

---

## Sub-phases & checkpoints

- [ ] 7.0 — This plan landed (PR)
- [ ] 7.1 — `Blueprint` + DDL compiler (SQLite): `Schema.create` + core column
      types/modifiers → real tables; unit-tested SQL shape + execution
- [ ] 7.2 — Migration runner + `migrations` state table + `migrate` / `migrate:status`
- [ ] 7.3 — `make:migration` generator (name → stub, table inference)
- [ ] **GATE 7-types** — **the types story**: introspect → `__schema/registry.d.ts`
      → `Model<TName>` binding green end-to-end. *If this doesn't land cleanly,
      stop and reconsider — without it the feature is a regression.*
- [ ] 7.4 — `Schema.table` (alter): add/change/drop/rename incl. the SQLite rebuild
- [ ] 7.5 — `rollback` / `refresh` / `fresh` + batch tracking; transactional batches
- [ ] 7.6 — Indexes + foreign keys (`constrained()`, `onDelete`, drop variants)
- [ ] 7.7 — Postgres dialect DDL
- [ ] 7.8 — MySQL dialect DDL (+ non-transactional caveats)
- [ ] 7.9 — Scaffolder: native migrations as an option; docs (migration guide +
      "Eloquent-style schema" + the types-generation contract)

Each is one or more PRs. **GATE 7-types is the most important checkpoint** — it is
the whole reason to build this.

## Cross-cutting rules

1. **Types-first, not types-last.** No sub-phase ships a column type whose generated
   TS type isn't covered. The generator and the builder evolve together.
2. **Parameterize / quote** (inherits parent-plan rule 5): DDL identifiers are
   validated + dialect-quoted; any value (defaults) binds. Migration names already
   go through `assertSafeName`.
3. **Generated `.d.ts` is never hand-edited** and is `.gitignore`-able (or committed
   — decide in 7.x; Prisma commits generated client, Drizzle commits schema — lean
   *commit* so CI/`tsc` is green without a generate step).
4. **Additive**: prisma/drizzle apps are untouched; native migrations are opt-in.
5. **`fix:`/`feat:` changeset** for `@rudderjs/orm` per shipping sub-phase (minor).

## Open decisions (resolve as we go)

1. **Model↔types binding**: `Model<'users'>` generic (recommended) vs `static table`
   inference.
2. **Commit vs gitignore** the generated `__schema/registry.d.ts` (lean commit).
3. **Where `Schema`/`Migration` live** — main `@rudderjs/orm` entry is client-safe;
   the DDL compiler + introspection are node-only → they belong at the
   `@rudderjs/orm/native` subpath (same client-bundle rule as the query engine).
4. **Insert-vs-read type asymmetry**: columns with DB defaults / auto-increment are
   required on read but optional on `create()` — design the generated insert type
   (likely a derived `Partial`-ish) so `User.create({...})` doesn't demand `id`.

## Explicitly NOT in scope (v1)

- A schema-**diff** engine (up/down only).
- Exotic Laravel column types (`morphs` helper aside, `geometry`/`spatialIndex`,
  `ipAddress`/`macAddress`, generated/stored columns, `set`) — add on demand.
- Cross-database migration portability guarantees beyond SQLite/pg/mysql.
- Seeders/factories — already native to `@rudderjs/orm`; unchanged.
- Online/zero-downtime migration orchestration.

## Relationship to the parent plan

- Depends on the native **query** engine (Phases 1–6) and on **transactions**
  (parent Phase 4) — transactional migration batches need it. So: do this **after**
  GATE B, ideally after transactions land.
- The `Dialect`/`Driver` seams are shared; this plan adds a **DDL compiler** beside
  the existing query compiler, and an **introspector** per dialect.
