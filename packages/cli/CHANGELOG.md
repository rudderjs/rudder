# @rudderjs/cli

## 4.15.0

### Minor Changes

- daa531f: feat(doctor): new `deps:version-skew` check — catch @rudderjs/\* sibling version skew before it becomes a cryptic ESM link error

  When sibling `@rudderjs/*` packages drift out of their declared version windows (typically via exact `pnpm.overrides` pins — the documented single-copy practice — silently overriding a dependency's floor), the failure surfaces at runtime as `SyntaxError: The requested module '@rudderjs/contracts' does not provide an export named '…'`, naming no package and no version. The new fast-path doctor check walks every installed `@rudderjs/*` package, reads its declared dependencies/peerDependencies on sibling `@rudderjs/*` packages, and verifies each against the version that actually resolves from that package's location (nested copy → pnpm virtual-store sibling → top level). Violations report the exact pair: `@rudderjs/session@2.3.0 requires @rudderjs/contracts ^1.16.0 — found 1.15.2`, with the overrides fix hint. Optional peers, `workspace:` ranges, and unparseable ranges never false-fire.

### Patch Changes

- Updated dependencies [b1205e4]
  - @rudderjs/core@1.12.2

## 4.14.0

### Minor Changes

- e8bd81f: Add maintenance mode — `rudder down` / `rudder up` (Laravel parity).

  `@rudderjs/schedule` already had `evenInMaintenanceMode()` on tasks, but nothing ever checked app maintenance state, so the flag was dead. This wires up the missing piece end to end:

  - **`@rudderjs/core`** gains node-only helpers (`isDownForMaintenance`, `maintenanceData`, `down`, `up`) backed by a JSON flag file at `storage/framework/down` (fields: `time`, `message`, `retry`, `secret`, `allow`), plus a kernel `maintenanceMiddleware()`. The middleware is auto-installed first in the request pipeline (a pure `existsSync` no-op when the app is up) and returns `503` with a `Retry-After` header while down — except requests matching the allow-list or carrying the bypass secret (`?secret=<token>` sets a bypass cookie). All exported from the main entry only, never `@rudderjs/core/client` (it statically imports `node:fs`); `app-builder` reaches it via a lazy server-only import, so the client bundle stays clean.
  - **`@rudderjs/cli`** adds the skip-boot `down` (`--secret`, `--retry`, `--message`, `--allow`) and `up` commands.
  - **`@rudderjs/schedule`** now skips due tasks while down unless they're flagged `evenInMaintenanceMode()`, in both `schedule:run` and `schedule:work`.

- ca13326: Add four missing `make:*` generators — `make:policy`, `make:observer`, `make:cast`, `make:notification`.

  Each scaffolds against a real framework base class:

  - **`make:policy`** → `app/Policies/<Name>Policy.ts`, `extends Policy` (`@rudderjs/auth`) with ability methods.
  - **`make:observer`** → `app/Observers/<Name>Observer.ts`, `implements ModelObserver` (`@rudderjs/orm`) with lifecycle hooks (`Model.observe(...)`).
  - **`make:cast`** → `app/Casts/<Name>.ts` (no suffix, Laravel parity), `implements CastUsing` (`@rudderjs/orm`) with the sync `get`/`set` pair.
  - **`make:notification`** → `app/Notifications/<Name>Notification.ts`, `extends Notification` (`@rudderjs/notification`) with `via()` + a `toDatabase()` builder.

  All four support `--with-test` (unit). `make:rule` and `make:scope` were deliberately **not** shipped: Rudder validation is zod-based via `FormRequest` (no first-class `Rule` type) and global scopes are inline `ScopeFn` functions in `static globalScopes` (no standalone `Scope` class) — neither has an abstraction to scaffold against.

- fd2bb54: New opt-in package: `@rudderjs/openapi` — auto-generate an OpenAPI 3.1 spec from typed routes.

  Walks `router.list()` and turns the introspectable schemas Phase 1 retains on each route (`name` / `bodySchema` / `querySchema` / `responses`) into an OpenAPI 3.1 document — path templating (`:id{[0-9]+}` → `{id}`, integer-typed), query parameters, `requestBody`, per-status `responses`, and unique `operationId`s.

  **Converter registry.** Standard Schema standardizes validate+infer but not JSON-Schema export, so emission dispatches a per-validator converter by the `~standard` vendor tag. zod 4's native `z.toJSONSchema()` is registered as the default (`'zod'`); `registerSchemaConverter(vendor, fn)` lets a Valibot/ArkType user plug in their own. A route whose validator has no registered converter is warned about and skipped — never a broken document.

  **Surface.**

  - `generateOpenApiDocument(router, info)` — the emitter.
  - `rudder openapi:generate [--out=openapi.json] [--yaml]` — write the spec from the live route table (CLI loader entry added).
  - `registerOpenApiRoutes(router, { path, specPath })` — serve Swagger UI at `/docs` + the spec JSON. **Opt-in only**; gate behind auth in production.
  - `OpenApiProvider` — wires `config('openapi')`; auto-discovery is OFF by default so docs are never exposed unless the app asks.

  Depends on `@rudderjs/contracts` (types) and zod; `@rudderjs/core`/`@rudderjs/router` are optional peers. v1 inlines schemas (no `$ref` de-dup) and omits auth-scheme docs / response validation (deferred).

- 6441725: Auto-generate the typed `config()` registry — no more hand-written `AppConfig` augmentation.

  `@rudderjs/core` already types `config('section.key')` over an `AppConfig` interface, but apps had to hand-write `declare module '@rudderjs/core' { interface AppConfig extends typeof configs {} }` to populate it. A new config scanner (sibling to the typed-env scanner) emits `.rudder/types/config.d.ts` augmenting `AppConfig` from the app's `config/index.ts` barrel via `import type` — so `config('app.name')` autocompletes and returns the real section type with zero boilerplate.

  The scanner runs in the same Vite generation pass as the env/routes scanners (dev + build), and ships a skip-boot `rudder config:sync` command to regenerate on demand. A missing `config/index.ts` removes any stale emit (symmetric shrink). Like the other registries, `.rudder/types/config.d.ts` is committed so `tsc` stays green on fresh clones.

### Patch Changes

- Updated dependencies [e8bd81f]
- Updated dependencies [7c79edc]
- Updated dependencies [5c80378]
  - @rudderjs/core@1.11.0
  - @rudderjs/router@1.9.0

## 4.13.0

### Minor Changes

- e33199c: Add `-t, --with-test` to every CLI-owned `make:*` generator — also writes `tests/<Name>.test.ts` shaped for what was scaffolded: a feature test (AppTestCase + HTTP) for `make:controller`, a unit test (plain node:test, no app boot) for everything else. An existing test file is never overwritten without `--force`, and the generated test carries a `// Covers <path>` pointer back at the scaffolded file.
- f5595cc: Add `optimize:clear` and `rudder fresh`. `optimize:clear` removes the framework's filesystem caches (`bootstrap/cache/` provider manifest, `node_modules/.vite/` dep-optimizer cache) and is skip-boot, so it works when a corrupt cache is the reason the app won't boot. `fresh` is the one-command dev reset: `migrate:fresh` (pass `--seed` to also seed) → `cache:clear` (best-effort) → framework filesystem caches, aborting before touching caches if the migrate fails. Pair with `@rudderjs/core`'s self-healing provider manifest — clearing `bootstrap/cache/` relies on boot regenerating it.
- 6de07fc: Add `make:exception` — scaffolds a domain exception class into `app/Exceptions/` with the duck-typed `httpStatus` rendering opt-in baked in. `--status <code>` (4xx/5xx, default 500) sets the status the exception renders with; invalid codes are rejected before anything is written.

### Patch Changes

- Updated dependencies [d6f0e79]
  - @rudderjs/core@1.10.0

## 4.12.0

### Minor Changes

- bef393f: New doctor check `structure:rudder-types-tsconfig`: warns when `.rudder/types/` exists but the `tsconfig.json` `include` array doesn't cover it (or uses the bare `".rudder"` form, which tsc ignores for dotted directories) — the silent failure mode where typed `view()`/`route()`/`Model.for<>()` stop resolving.
- 00e3b83: Typed `Env`: `Env.get('APP_NAME')` (and `getNumber`/`getBool`/`has`/`env()`) now autocompletes the keys your app declares. `@rudderjs/vite`'s new env scanner parses `.env.example` — the committed contract, never the secret `.env` — and emits `.rudder/types/env.d.ts` augmenting the new `EnvRegistry` interface in `@rudderjs/support`. Runs on dev/build, re-emits when `.env.example` changes, and the loose `string` overload stays for keys packages read that apps don't declare.

  New `rudder env:sync` command (skip-boot): regenerates the registry AND diffs `.env` against `.env.example` — missing keys are flagged, `--fix` appends them with their example values (or creates `.env` wholesale when absent). Keys only your `.env` carries are reported but never deleted.

- 940406d: `vendor:publish` now detects the native database engine: an app with `@rudderjs/orm` / `@rudderjs/database` but no orm-prisma/orm-drizzle adapter resolves as `orm: 'native'`, and `PublishGroup.orm` accepts `'native'` so packages can ship native-engine assets (e.g. `@rudderjs/sync`'s `syncDocument` migration under `--tag=sync-schema`).

### Patch Changes

- 166895c: `rudder add notifications` no longer suggests running `make:notification` — that command doesn't exist. The hint now shows the real API (extend `Notification`, dispatch via `notify(...)`).
- 51d6026: `module:publish` now merges module Prisma shards into `prisma/schema/modules.prisma` when the app uses Prisma's multi-file layout (the scaffolder default — `prisma.config.ts` points `schema` at the `prisma/schema/` directory). Previously it always wrote a sibling `prisma/schema.prisma`, a file Prisma never reads on that layout, so the publish was a silent no-op for every scaffolded app. Legacy single-file projects keep the `prisma/schema.prisma` target.
- 7107ed9: One-shot `rudder` commands no longer hang on a native pg/mysql connection. The pooled drivers (`postgres` / `mysql2`) hold sockets that keep the event loop alive after a command's handler resolves, so `rudder migrate` (and any command booting an app whose default connection is native pg/mysql) never exited — sqlite was unaffected because better-sqlite3 is synchronous. The CLI now closes every cached native driver after the command completes; long-running commands (`queue:work`, `schedule:work`) are unaffected since they only reach the exit path on shutdown.
- Updated dependencies [87783f7]
- Updated dependencies [940406d]
  - @rudderjs/core@1.8.0

## 4.11.0

### Minor Changes

- f88660f: feat: `db:show` / `db:table` CLI commands — Laravel-parity database inspection over the native engine. `db:show` lists every table with on-disk sizes (`--counts` adds row counts, `--views` adds the view list); `db:table <name>` shows columns, indexes (incl. a synthesized PRIMARY entry on SQLite rowid tables), and foreign keys with update/delete rules. Both support `--json`. New `@rudderjs/database` exports: `inspectDatabase`/`inspectTable`/`readIndexes`/`readForeignKeys` (+ `NativeAdapter.inspectDatabase()`/`.inspectTable()`). Prisma/Drizzle apps get a friendly pointer to `prisma studio` / `drizzle-kit studio`.

## 4.10.0

### Minor Changes

- 7e6dc85: Require Node ≥ 22.12 (drop Node 20)

  Node 20 ("Iron") reached end-of-life in April 2026, so `engines.node` is now `>=22.12.0` (was `^20.19.0 || >=22.12.0`). CI tests against the current Active LTS lines, Node 22 and 24. Consumers still on Node 20 will see an `engines` warning at install time — upgrade to Node 22 or 24. The scaffolder-generated app template now declares the same floor.

- 0dcecaf: New `make:resource` scaffolder — `pnpm rudder make:resource User` writes `app/Resources/UserResource.ts` with a `JsonResource` subclass stub (inferred model import, `toArray()` body, conditional-helper examples). Spec lives at `@rudderjs/orm/commands/make-resource` (same MakeSpec pattern as `make:factory`/`make:seeder`); the CLI loader registers it automatically.

### Patch Changes

- c954a37: Exit non-zero on an unknown command. `rudder <unknown-command>` previously printed the full help text and exited 0 — a typo'd command looked like success. It now prints a clear `Unknown command: <name>` error with a `rudder --help` hint and exits with code 1, matching Laravel Artisan / npm / cargo. Bare `rudder` (no args) still shows help and exits 0.
- 083672b: feat(orm): native `migrate:rollback` / `migrate:refresh` / `migrate:fresh` + transactional batches

  The native SQLite engine can now reverse migrations, not just apply them:

  - **`migrate:rollback`** reverts the last batch — each migration's `down()` runs in reverse apply order and its `migrations` row is deleted.
  - **`migrate:refresh`** rolls every migration back and re-runs them all.
  - **`migrate:fresh`** drops all tables and re-applies from scratch (now wired for native; prisma/drizzle keep shelling out).
  - On prisma/drizzle apps, `migrate:rollback` / `migrate:refresh` print a clear "forward-only — use `migrate:fresh`" message instead of shelling out.

  Each batch (the `up()`s in a `run()`, the `down()`s in a rollback) now executes inside a **single transaction**, so a failure mid-batch rolls the whole batch back atomically — the DDL and the `migrations` state-table writes commit or roll back together. The `Migrator` gains `rollback()`, `rollbackAll()`, `lastBatch()`, `migrationsInBatch()`, and `dropAllTables()`; `MigratorAdapter` now requires `transaction()` (already implemented by `NativeAdapter`).

- b31d1be: feat(orm): native migration runner — `Migration` + `Schema` facade + `migrate` / `migrate:status` (Phase 7.2)

  Builds the migration runner on top of the 7.1 schema builder, so the native SQLite engine now runs Laravel-style migrations in-process (no external tool):

  - **`Migration`** base class (`up()` / `down()`) and the static **`Schema`** facade (`Schema.create` / `drop` / `dropIfExists` / `hasTable` / `hasColumn`) that migration files call — exported from `@rudderjs/orm/native`.
  - **`Migrator`** — tracks applied migrations in a `migrations` table (`id`, `migration`, `batch`, mirroring Laravel), applies pending ones in a new batch, and reports status. Plus **`discoverMigrations(dir)`** which loads `database/migrations/*.{ts,js,mts,mjs}` files sorted by name.
  - **`NativeAdapter.schemaBuilder()`** — exposes a connection-bound `SchemaBuilder` for the runner.
  - **CLI**: `rudder migrate` and `rudder migrate:status` now detect a native-engine app (no prisma/drizzle adapter package installed) and run the in-process `Migrator` against the booted adapter, instead of shelling out. Prisma/Drizzle apps are unchanged. The CLI boots the app on demand for the native path (`migrate*` otherwise skip boot).

  `migrate:rollback` / `migrate:refresh` (which reverse a batch via `down()`) and transactional batches land in 7.5; the `batch` column is recorded now so rollback has the grouping it needs. `make:migration` for native (the stub generator) is 7.3 — for now, author migration files by hand. SQLite only; additive and opt-in.

- 6bd32b0: feat(orm): generated model types — `Model.for<'table'>()` binding + `rudder schema:types` (GATE 7-types)

  Finishes the GATE 7-types consumption layer on top of the #817 generator. A model can now derive its column types from the migrated schema with zero hand-declared fields:

  ```ts
  export class User extends Model.for<"users">() {
    static override table = "users";
  }

  await User.find(1); // u.id / u.name / u.email — typed
  await User.where("active", true).first(); // chains are typed too
  await User.create({ name, email }); // unknown columns fail tsc
  ```

  - `Model.for<TName>()` resolves a model's instance type from `SchemaRegistry[TName]` (open-decision #1 → generic binding). Purely additive: `static casts` still refine the storage type, plain `extends Model` and hand-declared fields are unaffected.
  - `rudder schema:types` regenerates `app/Models/__schema/registry.d.ts` on demand (native engine; boots on demand like `migrate*`).
  - Native `migrate` / `migrate:fresh` / `migrate:refresh` / `migrate:rollback` auto-regenerate the registry after a successful apply.
  - The generated `registry.d.ts` should be **committed** (so `tsc`/CI is green without a generate step).

- Updated dependencies [7e6dc85]
  - @rudderjs/console@1.4.0
  - @rudderjs/core@1.7.0
  - @rudderjs/router@1.8.0

## 4.9.1

### Patch Changes

- edd1747: Native engine Phase 8 (scoped) — ship native as an opt-in SQLite engine.

  The native engine (`@rudderjs/orm/native`) is now wired as a selectable, batteries-included database engine — no external ORM package, just `@rudderjs/orm` + `better-sqlite3`.

  - **`NativeDatabaseProvider`** (auto-discovered via `rudderjs.providerSubpath: './native'`) boots a `NativeAdapter` from `config('database')`. It's **opt-in and inert by default**: it activates only when the default connection sets `engine: 'native'`. Because `@rudderjs/orm` is installed in every app, this config gate is what lets the provider be auto-discovered without clobbering a Prisma/Drizzle adapter — in those apps it discovers, sees no `engine: 'native'`, and returns early. An explicit `nativeDatabase()` helper is also exported for hand-wired `bootstrap/providers.ts`.
  - **Doctor:** new `@rudderjs/orm/doctor` subpath contributes an `orm-native:db-connect` `--deep` check that reuses the driver opened during boot (skips cleanly when the app isn't on native). Registered in the CLI's doctor loader.
  - **`@rudderjs/core`** is now an optional peer of `@rudderjs/orm` (used only by the node-only native provider; the client-bundle gate is unaffected since the main entry never imports the subpath).
  - **Docs:** the database guide documents native as a selectable engine, the `engine: 'native'` config, transactions, the client-safety contract, and the explicit "no native migrations yet — bring your own schema" caveat.

  **Not in scope (deliberate):** `create-rudder` still defaults to Prisma/Drizzle — flipping the scaffolder default needs a native schema/migration story (Phase 7, deferred). Postgres/MySQL and native migrations remain out.

## 4.9.0

### Minor Changes

- c757914: `rudder doctor --production` — pre-deploy readiness mode.

  ```bash
  pnpm rudder doctor --production           # strict prod-readiness check
  pnpm rudder doctor --production --deep    # ...with app-boot runtime checks too
  ```

  Adds a new `production` category of strict invariants gated behind `--production` (so they don't false-fire in dev). Each maps to a real "I almost shipped a security bug" class:

  | Check                           | Enforces                                                                                         |
  | ------------------------------- | ------------------------------------------------------------------------------------------------ |
  | `production:app-debug`          | `APP_DEBUG` is NOT `true`/`1` (would leak stack traces + `dump()` output)                        |
  | `production:app-env`            | `APP_ENV` is `production`                                                                        |
  | `production:app-url`            | `APP_URL` starts with `https://`                                                                 |
  | `production:database-url`       | `DATABASE_URL` is NOT SQLite or `localhost`/`127.0.0.1`/`0.0.0.0` (creds redacted in the report) |
  | `production:rudder-pinning`     | No `@rudderjs/*` deps on floating ranges (`latest`/`*`/`next`)                                   |
  | `production:workspace-refs`     | No `workspace:*` refs in `package.json`                                                          |
  | `production:dist-exists`        | `dist/` build output exists                                                                      |
  | `production:providers-manifest` | `bootstrap/cache/providers.json` is present                                                      |

  Designed for the deploy pipeline:

  ```yaml
  - name: Pre-deploy doctor
    run: pnpm rudder doctor --production
  ```

  Non-zero exit on any non-green outcome — catches the bug before the deploy lands.

  **Internal:** `DoctorCheck.productionOnly?: boolean` is the new flag on the registry interface (`@rudderjs/console` minor bump). Both the `--production` gate AND the existing `--deep` gate are applied in the orchestrator's filter; `--deep --production` runs everything.

- 6ea97d7: `rudder make:test` — Laravel-parity test-file scaffolder.

  ```bash
  pnpm rudder make:test User             # tests/User.test.ts — feature test (boots the app via AppTestCase)
  pnpm rudder make:test Math --unit      # tests/Math.test.ts — bare node:test, no app boot
  ```

  Defaults to a feature test using `AppTestCase` (the `tests/TestCase.ts` convention from `docs/guide/testing.md`). When the consumer hasn't created `tests/TestCase.ts` yet, the command emits a hint pointing back to the setup snippet — same shape as the doctor's fix hints.

  The `--unit` variant generates a stub using only `node:test` + `node:assert/strict` — no app boot, no `@rudderjs/testing`. Right for pure functions, validators, and domain logic.

  The filename uses the `.test.ts` suffix so the generated file matches the documented `tsx --test tests/**/*.test.ts` glob without any extra config.

- 2977d05: `rudder test` — unified test-runner entry point.

  ```bash
  pnpm rudder test                                      # run every test under tests/
  pnpm rudder test User                                 # filter by name pattern
  pnpm rudder test tests/UserController.test.ts         # run one specific file
  pnpm rudder test --watch                              # re-run on file changes
  pnpm rudder test --coverage                           # Node --experimental-test-coverage
  pnpm rudder test --bail                               # stop on first failure
  pnpm rudder test --reporter=spec                      # spec / dot / tap / junit
  ```

  Pairs with the just-shipped `rudder make:test` so the test-driven workflow has a one-liner from scaffold to run:

  ```bash
  pnpm rudder make:test User
  pnpm rudder test User
  ```

  Spawns `tsx --test` under the hood against the documented `tests/` directory. Auto-locates `tsx` in `node_modules/.bin` (walks up to handle monorepo hoisting); prints a clear install hint when it's missing. Skip-boot — fast startup, doesn't need the app to be bootable.

  Positional arg semantics:

  - Ends in `.ts` → file path (Node runs just that file)
  - Anything else → `--test-name-pattern=<arg>` (matches `describe` / `it` labels)

  Both can be combined with `--filter <regex>` — explicit `--filter` wins over a non-`.ts` positional.

### Patch Changes

- eafdc7a: fix: close file check-then-write races (TOCTOU) in CLI scaffolders, the view/route scanners, and OAuth key generation

  Replaced `existsSync(path)` → later `write` patterns with a single atomic
  operation, so a concurrent process can't slip a file (or symlink) in between
  the check and the write:

  - **Scaffolders** (`make:*`, `make:module`, `rudder add`) now write with the
    exclusive `wx` flag and surface the same "already exists — use `--force`"
    message via an `EEXIST` catch. `--force` opts into truncation as before.
  - **`passport:keys`** writes the freshly generated keypair with `wx` (private
    key still `0o600`), so the write fails rather than following a pre-planted
    file/symlink at the key path. The non-`--force` guard now rejects when
    _either_ key already exists (previously only the private key), treating the
    pair atomically.
  - **`@rudderjs/vite` scanners** read-with-`ENOENT`-catch instead of
    `existsSync`-then-read for their idempotent codegen writes.

  No behavioral change for normal use; `--force` semantics are unchanged.

- Updated dependencies [eafdc7a]
- Updated dependencies [c757914]
  - @rudderjs/console@1.3.0

## 4.8.0

### Minor Changes

- 42619cb: `rudder key:generate` — Laravel-parity command for generating a 32-byte `APP_KEY` and writing it to `.env`.

  ```bash
  pnpm rudder key:generate            # generate + write to .env
  pnpm rudder key:generate --show     # print to stdout, leave .env alone
  pnpm rudder key:generate --force    # overwrite an existing non-empty APP_KEY
  pnpm rudder key:generate --path .env.local   # target a different .env file
  ```

  Idempotent behavior:

  - `.env` doesn't exist → created with `APP_KEY=base64:...`
  - `.env` exists but has no `APP_KEY` line → appended
  - `.env` has an **empty** `APP_KEY=` (the fresh-scaffold shape) → replaced silently
  - `.env` has a **non-empty** `APP_KEY=…` → refused with exit 1, unless `--force` is passed (protects production secrets from accidental overwrite)

  Commented-out lines (`# APP_KEY=...`) and similar-prefixed names (`APP_KEYS=...`) are not touched. Preserves all other lines, comments, and ordering in `.env`.

  Also updates every place in the framework that previously emitted the verbose `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` recipe:

  - **doctor → APP_KEY unset** now says `Run \`pnpm rudder key:generate\` to generate a 32-byte APP_KEY and write it to .env`
  - **doctor → APP_KEY too short** now says `Run \`pnpm rudder key:generate --force\` to replace it with a 32-byte key`
  - **`create-rudder` scaffolder** — `.env.example`'s `# Generate with:` hint now points at `pnpm rudder key:generate` instead of the inline `node -e` recipe.

  The scaffolder still generates `APP_KEY` automatically at scaffold time (it always did) — the change only affects the `.env.example` documentation hint, so users cloning a fresh project know which command to run when they need to rotate or regenerate.

- 14363de: `rudder about` — Laravel-parity snapshot of the app.

  ```bash
  pnpm rudder about           # human-readable
  pnpm rudder about --json    # machine-readable (bug reports, LLM context)
  ```

  Output covers:

  - **Application** — name from `package.json`, plus `APP_ENV` / `APP_DEBUG` / `APP_URL` from `.env`
  - **Runtime** — Node version, OS + arch, detected package manager
  - **Rudder** — installed `@rudderjs/core` and `@rudderjs/cli` versions
  - **Installed packages** — every `@rudderjs/*` present in `node_modules`, sorted, with versions

  Skip-boot (~50ms typical) — no app machinery runs, so the command works even when the app can't boot. `.env` is loaded directly so the snapshot reflects what the app would actually see at runtime.

  Use cases:

  - **Bug reports** — `pnpm rudder about --json` is the one-line attachment maintainers ask for first
  - **LLM context** — the JSON output gives an AI agent helping you debug everything it needs about your project's stack in one read
  - **Sanity check** — confirm what's actually installed after a deploy / `pnpm install` / framework upgrade

- 425c7f1: `rudder upgrade` — CHANGELOG snippets inline.

  For every package being bumped, the command now fetches the `CHANGELOG.md` from the framework's public GitHub repo (npm tarballs intentionally omit it via `files: ["dist"]`), parses every `## X.Y.Z` section in the window between current and target, and prints a one-line headline per intermediate version:

  ```
    @rudderjs/cli  4.6.5 → 4.7.1  (devDependencies)
        4.7.1  rudder upgrade — handle floating dist-tag ranges
        4.7.0  rudder upgrade — one-step bump of every @rudderjs/* dep to latest
        4.6.9  stripInternal: true is now set in tsconfig.base.json
        ...
  ```

  Headlines come from the first non-trivial bullet of each version's changeset entry; the cite-prefix (`abc1234:`) is stripped and `Updated dependencies [...]` lines are skipped.

  New flags:

  - `--no-changelog` — skip the fetch entirely (faster, quieter; useful for CI).
  - `--changelog-base <url>` — override the GitHub raw base URL (forks, mirrors). Default: `https://raw.githubusercontent.com/rudderjs/rudder/main`.

  Fetch failures degrade gracefully — a row whose CHANGELOG can't be fetched renders without the indented detail block.

  `parseChangelog()` + `collectChangelogs()` are exported with a pluggable fetcher so unit tests drive them with synthetic markdown, zero network in CI.

- 6aa9ab2: `rudder upgrade` — detect peer-dependency mismatches.

  After building the bump plan, the command now fetches each upgraded `@rudderjs/*` package's `peerDependencies` at the target version and diffs them against the peers declared in the consumer's `package.json`. When a framework package has bumped a peer major past what the consumer carries, a loud warning surfaces with the exact ranges and suggested fix:

  ```
    ⚠ Peer-dependency mismatches:
      vite  — required by @rudderjs/vite@3.0.0
        your package.json: devDependencies.vite = "^7.1.0"
        framework needs:    "^8.0.0"
        reason:             consumer accepts major 7, framework needs major 8
  ```

  `--check` mode treats peer mismatches as part of the exit-1 condition, so CI gates catch them.

  Closes the gap discovered on `rudderjs.com` (2026-05-29): `pnpm update --latest "@rudderjs/*"` happily bumps `@rudderjs/*` packages but doesn't notice when the framework has bumped a peer-dep major (`vite 7→8`, `react 18→19`, etc.). Apps stay on the old peer and miss the actual upgrade signal.

  Internal: `acceptedMajors(range)` reduces a semver range to its accepted-major set (or `'any'`); `diffPeerRange(consumer, required)` intersects two ranges and surfaces a reason on no-overlap. Both fail open on unparseable input so they never block a working upgrade.

## 4.7.1

### Patch Changes

- dc78211: `rudder upgrade` — handle floating dist-tag ranges (`latest`, `*`, `next`) gracefully instead of treating them as parse errors.

  Apps that use `"@rudderjs/core": "latest"` (a common pattern for auto-pickup of new releases) previously got a confusing "couldn't parse" message. The command now classifies every range into one of three shapes:

  - **`workspace:*`** — silently skipped (monorepo refs, resolved by pnpm at install time).
  - **floating** (`latest` / `*` / `next` / empty) — surfaced as info showing what each resolves to today. **Not rewritten** because converting to a caret range would change semantics (the user would stop auto-picking-up future majors).
  - **pinned** (`^1.2.3`, `~1.2.3`, `1.2.3`, etc.) — bumped normally.

  Discovered while dogfooding the upgrade command against `rudderjs.com`, which uses literal `"latest"` strings throughout `package.json`.

## 4.7.0

### Minor Changes

- c6ff344: `rudder upgrade` — one-step bump of every `@rudderjs/*` dep to the latest published version.

  ```bash
  pnpm rudder upgrade            # bump everything to latest
  pnpm rudder upgrade --check    # CI gate: exit 1 if updates available, no changes
  pnpm rudder upgrade --dry-run  # preview without modifying
  pnpm rudder upgrade --minor    # cap within current major (no breaking changes)
  pnpm rudder upgrade --patch    # cap within current minor (bug fixes only)
  ```

  Finds every `@rudderjs/*` package across `dependencies`, `devDependencies`, and `peerDependencies`. Queries the npm registry for each one's `latest` dist-tag. Rewrites `package.json` with new caret ranges, then runs your package manager's install (auto-detected from the lockfile — pnpm / npm / yarn / bun).

  Major bumps are highlighted red in the plan so reviewers can spot breaking-change risk before applying. Per-package CHANGELOG snippets and a `doctor` integration are queued for later releases — see `docs/guide/installation.md#keeping-up-to-date` for the current flag list.

  Workspace refs (`workspace:*`) are skipped with a clear "couldn't parse" notice — the command is intended for downstream apps, not the framework monorepo itself.

## 4.6.9

### Patch Changes

- 161c5c4: `stripInternal: true` is now set in `tsconfig.base.json` — symbols annotated `/** @internal */` no longer leak into the published `.d.ts` declarations. Runtime is unchanged; only the TypeScript public-types contract shrinks.

  Consumers using a `@internal`-annotated symbol (typically underscore-prefixed framework helpers like `_match`, `_attachFake`, internal observer registries) will see a fresh `TS2339` / `TS2724` from `tsc`. The fix is to stop reaching into framework internals; if you have a legitimate cross-package use-case, open an issue.

  Cross-package test/HMR escape hatches (`Application.resetForTesting`, observer registry `.reset()` methods, `Session._runWithSession`, `Command._setContext`, `DispatchOptions.__context`, `QueryBuilder._aggregate`, `setConfigRepository`/`getConfigRepository`) had their `@internal` annotations removed — these were legitimate cross-package contract members mis-tagged, and they remain on the public types.

  Found by the Phase 4 public-API-surface audit (`docs/plans/findings/2026-05-28-phase-4-public-api.md`).

- Updated dependencies [161c5c4]
  - @rudderjs/console@1.2.1
  - @rudderjs/core@1.5.1
  - @rudderjs/router@1.7.1

## 4.6.8

### Patch Changes

- 313e3f2: `make:controller` (and `--resource` / `--api` / `--singleton`) generated a file that didn't compile: every stub variant imported `Context` from `@rudderjs/core`, which doesn't export that type — `TS2305: Module '"@rudderjs/core"' has no exported member 'Context'`. Replaced with the real handler types `AppRequest, AppResponse` from `@rudderjs/contracts` (the same types `RouteHandler` is built on and that `make:middleware` already uses). Handler signatures now read `(req: AppRequest, res: AppResponse)` — typed out of the box, no edit required. Found by the Phase 1 scaffolder audit.
- cfcebed: `make:passport-client` was silently unreachable. The spec was registered inside `PassportProvider.boot()`, but the CLI deliberately skips `bootApp()` for `make:*` argv (the no-boot fast path) — so the spec was never wired into Commander, and `pnpm rudder make:passport-client <Name>` printed the top-level help (Commander treated it as an unknown command) instead of scaffolding the seeder. No error, no file, exit 0.

  Moved the spec to the documented CLI-loader subpath pattern used by every other package-contributed `make:*`: `@rudderjs/passport/commands/make-passport-client` exports `makePassportClientSpec` (same shape as `@rudderjs/terminal`'s `make-terminal`), and `@rudderjs/cli`'s `loadPackageCommands()` imports it eagerly. The in-boot registration block in `PassportProvider.boot()` is gone. End-to-end: `pnpm rudder make:passport-client <Name>` now creates `app/Seeders/<Name>.ts` as documented. Found by the Phase 1 scaffolder audit.

## 4.6.7

### Patch Changes

- 4e388a4: `rudder --version` and the `rudder` banner printed a hardcoded `0.0.2` regardless of the installed version. They now read the CLI's real version from its `package.json` at runtime (works in both the published `dist` and `tsx` source forms). Also fixes a stale "Display RudderJS version" → "Display Rudder version" string the rebrand missed.
- c6ddef0: Fix leftover "RudderJS" brand strings in user-facing output (the 2026 rebrand to "Rudder" missed these — found by dogfooding).

  - `@rudderjs/server-hono` — the dev (Ignition) error page rendered `<title>… — RudderJS</title>` and a `· RudderJS <version>` line in its Copy-as-Markdown report. Both now say "Rudder".
  - `@rudderjs/cli` — the `rudder` command banner read `RudderJS Framework`; now `Rudder Framework`.

- Updated dependencies [bdfb88c]
  - @rudderjs/console@1.2.0

## 4.6.6

### Patch Changes

- 2090604: fix(doctor): load `.env` before env-var checks so `rudder doctor` doesn't report set secrets as unset

  The fast-path `rudder doctor` runs skip-boot, so `bootstrap/app.ts`'s `import 'dotenv/config'` never ran — its env-var checks read `process.env` directly and falsely reported vars defined in `.env` (AUTH_SECRET, DATABASE_URL, APP_KEY, …) as "unset", producing red errors and a non-zero exit on a correctly-configured app. The doctor now loads `.env` (non-override, so real exported env vars from Docker/CI/Forge still win) before running checks, so they reflect what the app actually sees at runtime.

## 4.6.5

### Patch Changes

- 78e7f56: Introspection commands: `event:list`, `config:show`, `route:list --verbose`

  Three small commands that close debugging loops you'd otherwise solve with
  grep + restart. Plan: `docs/plans/2026-05-23-introspection-commands.md`.

  **`pnpm rudder event:list`** — registered events with each listener's class
  name. Wildcard (`*`) listeners surface as their own row; anonymous
  inline handlers render as `<anonymous>`. Flags: `--filter <substring>`,
  `--json`. Backed by a new `EventDispatcher.inspect()` method (additive
  alongside the existing `list()` count-only method).

  **`pnpm rudder config:show [section[.key]]`** — resolved configuration tree
  with sensitive-value redaction. Keys whose final token is one of
  `key, secret, password, token, dsn, webhook, signing, salt, pepper,
credentials` (camelCase / snake_case / dotted all handled) print as
  `***`. `--raw` opts out with a stderr warning. `--json` round-trips
  through the redaction pass; pass `--raw --json` for unredacted output.
  No-arg form prints a section summary (section → key count).

  **`pnpm rudder route:list --verbose`** — extends the existing command with
  the resolved `[global → group → route]` middleware stack matching the
  request-time composition order. Backed by a new
  `RudderJS.middlewareSnapshot()` method that combines the user's
  `withMiddleware()` block with provider-registered group middleware
  (`appendToGroup()` calls during `boot()`). `--verbose --json` emits a
  `resolved: { global, group, route }` triple per api route. Default
  output unchanged. Also accepts `-v` as a short alias.

  All three commands are loaded via the cli's `tryImport` mechanism — no
  changes for users who don't invoke them. `Router.list()` output now
  includes the route's `group` tag (additive `group?: 'web' | 'api'`),
  already declared in `@rudderjs/contracts` and previously inert.

- Updated dependencies [78e7f56]
  - @rudderjs/core@1.3.0
  - @rudderjs/router@1.7.0

## 4.6.4

### Patch Changes

- c9202fd: `rudder doctor`'s `env:dotenv-loadable` check now passes when config is supplied via `process.env` directly (Docker, CI, Forge / Fly / Render / Vercel / Railway, Kubernetes ConfigMap / Secret) — previously hard-errored on absent `.env`, breaking unscoped `rudder doctor` as a `predev` pre-flight in every non-`.env` deployment shape.

  Detection signal: any of `APP_KEY`, `APP_ENV`, or `DATABASE_URL` set in `process.env` means the operator has deliberately chosen the process.env shape. The per-key validation stays with the targeted sibling checks (`env:app-key`, `env:app-env`, `orm-prisma:database-url`) — this check only owns the file-shape concern.

  The fresh-clone case (bare repo, no `.env`, no env signals) still gets the actionable `Run cp .env.example .env` error. Composes with the previous workspace-friendliness pass (#619): an API-only app deployed via CI without `APP_KEY` (now a warn per the post-#619 lenient `env:app-key`) no longer trips this check either, because `DATABASE_URL` / `APP_ENV` is the signal.

## 4.6.3

### Patch Changes

- fbcdf93: `rudder routes:sync` from `@rudderjs/vite/commands/routes-sync` is now picked up by the CLI loader and added to the skip-boot list. Regenerates `pages/__view/routes.d.ts` from `routes/*.ts` without booting the app — useful in CI and on fresh clones.
- 5721df5: `rudder doctor` is now friendlier to workspace monorepos and apps that don't use session/auth:

  - **`env:package-manager`** walks up to the workspace root (`pnpm-workspace.yaml` / `lerna.json` / `.git` / `package.json#workspaces`) to find the lockfile. Previously it only looked in `process.cwd()` and reported red inside any sub-package.
  - **`deps:providers-manifest`** detects manual composition by the absence of `defaultProviders(` in `bootstrap/providers.ts` and returns ok — apps that hand-compose providers no longer get a permanent "missing manifest" warn.
  - **`env:app-key`** is downgraded from error to warn when `bootstrap/providers.ts` doesn't reference session / auth / passport providers. Apps that genuinely need APP_KEY (anything wiring `defaultProviders()`, `SessionProvider`, `AuthProvider`, or `PassportProvider`) keep the hard error.

  This unblocks unscoped `pnpm rudder doctor` as a `predev` pre-flight in workspace-shaped apps like `pilotiq/playground` and `pilotiq-pro/playground` — they can drop the `--only structure` filter once on this version.

## 4.6.2

### Patch Changes

- f1660bf: Doctor now picks up checks contributed by `@rudderjs/broadcast-redis` (`REDIS_URL` + deep connectivity probe). The package is silently skipped when not installed in the user app.

## 4.6.1

### Patch Changes

- 732aa41: chore(brand): runtime banner rebrand `RudderJS Tinker` / `RudderJS Doctor` → `Rudder Tinker` / `Rudder Doctor`

  Aligns the user-visible CLI output with the framework's product name. Surface change only — no behavior delta. Same change applied across README, docs guides, and the matching test assertion in `reporter.test.ts`.

  The `@rudderjs/*` npm scope, github org, and `rudderjs.com` domain are unchanged — those are infrastructure names.

## 4.6.0

### Minor Changes

- e118f0d: feat(cli): `rudder tinker` — interactive REPL with the app booted

  Laravel `php artisan tinker` equivalent. Drops into a Node REPL after a full app boot; pre-populates the context with the DI container accessor, route helpers, and every model under `app/Models/`. Top-level `await` works; history persists to `~/.rudder-tinker-history`.

  ```bash
  $ pnpm rudder tinker
  RudderJS Tinker — node v22.14.0, env=local

  > await User.count()
  12

  > const u = await User.where('email', 'alice@example.com').first()
  > u.posts().count()
  5

  > route('users.show', { id: u.id })
  '/users/42'
  ```

  Context entries:

  - `app()` — DI container accessor
  - `config` — typed config reader
  - `Route`, `route()`, `Url` — router + URL helpers (from `@rudderjs/router` when installed)
  - `rudder` / `Rudder` — command registry
  - Every model class under `app/Models/` (named + default exports)

  Flags: `--no-banner`, `--no-history`. Meta-command: `.boot` to re-run the app boot after a code change.

  The CLI sets `RUDDERJS_TINKER=1` before booting so providers that actively poll or open connections on `boot()` (`@rudderjs/horizon`'s `WorkerCollector` is the canonical case) can short-circuit. Same shape as the existing `RUDDERJS_QUEUE_WORKER=1` sentinel set for `queue:work` — zero new core API surface.

  Phase 1 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Subsequent phases: editor-launch on error frames, typed `route()` URL generator, `make:factory` + `make:seeder` scaffolders.

### Patch Changes

- e8707af: feat: `make:factory` + `make:seeder` scaffolders, plus dev-mode loader fix

  Completes the `make:*` family. Both scaffolders mirror existing patterns (`make:migration` / `make:agent` / `make:terminal`):

  ```bash
  $ pnpm rudder make:factory User
  ✓ Factory created: app/Factories/UserFactory.ts

  $ pnpm rudder make:seeder Users
  ✓ Seeder created: database/seeders/UsersSeeder.ts
  ```

  Generated stubs match the **real** `ModelFactory` + `Seeder` abstract-class APIs (not the `Factory.define()` callback shape the plan doc misremembered): subclass + `protected modelClass` + `definition()` for factories, subclass + `async run()` for seeders. Factory stems infer the model name (`UserFactory` imports `User`). Seeder stems show the matching `<Name>Factory` import + `this.call(...)` composition example commented out.

  Phase 4 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Final phase — all four DX gaps now closed.

  ## Bundled fix (load-bearing): `loadPackageCommands` cwd-walks

  The cli's `tryImport(pkg, subpath)` was building bare specifiers (`<pkg>/<subpath>`) and dispatching to `import()`. When the cli runs in dev mode via `tsx node_modules/@rudderjs/cli/src/index.ts` (the pnpm symlink target), Node resolves those specifiers relative to the SOURCE file — `packages/cli/src/`, where pnpm-strict has no peer-package entries. The catch in `Promise.all(loaders.map(fn => fn().catch(() => {})))` silently swallowed every failure. **Every package-contributed `make:*` was a no-op in dev:** `make:agent`, `make:mcp-tool`, `make:terminal`, `make:migration` — all silently broken.

  Phase 4 surfaced it (my new `make:factory` wasn't registering); without the fix, this PR ships a non-functional scaffolder. Bundled per the load-bearing-fix rule.

  Fix: walk `<cwd>/node_modules/<pkg>/dist/<subpath>.js` directly + `pathToFileURL` for Windows portability. Same shape doctor's `load-package-checks.ts` already uses for the identical reason.

- Updated dependencies [34b008f]
  - @rudderjs/router@1.5.0

## 4.5.0

### Minor Changes

- 108c7a2: doctor: Phase 5 — `--fix` mode

  `pnpm rudder doctor --fix` now auto-applies safe fixes for failing checks that declare a `fixer()`. Add `--yes` to skip prompts. The flow runs the fast-path checks, prompts (or auto-applies under `--yes`) for each fixable failure, then re-runs the same checks to confirm.

  First three fixers ship in this release:

  - `deps:providers-manifest` → regenerates `bootstrap/cache/providers.json` in-process (same logic as `rudder providers:discover`)
  - `orm-prisma:client-generated` → shells out `pnpm exec prisma generate`
  - `auth:views-vendored` → copies `node_modules/@rudderjs/auth/views/<fw>/` to `app/Views/Auth/` (never overwrites existing files)

  Fixers must be idempotent regenerate-style operations. Doctor never modifies `.env`, `package.json`, or DB schema, and a fixer that throws is reported as a red fix outcome — doctor itself never crashes.

- b28e51f: Add `rudder doctor` — a diagnostic command that pre-flights common setup
  failures in a RudderJS app and reports them with paste-able fix instructions.

  **Why this exists:** when something breaks in a scaffolded app, the user
  typically sees a stack trace 8 frames deep into vike / hono / `@rudderjs/core`
  with nowhere to triage. `rudder doctor` flips that — one shell-out, every
  common setup failure gets a green / yellow / red icon + a one-line fix.

  **Phase 1 + 2 ship in this release.** Phase 3 (package-contributed checks)
  and Phase 4 (`--deep` runtime checks) and Phase 5 (`--fix` auto-recovery)
  follow in subsequent releases.

  What's new:

  - `@rudderjs/console`: new public API for package authors —
    `registerDoctorCheck()`, `getRegisteredChecks()`, `DoctorCheck` /
    `DoctorResult` / `DoctorStatus` types, plus a `DoctorRegistry` class.
    Singleton on `globalThis` so it survives Vite SSR module re-eval, with
    last-writer-wins semantics for duplicate ids (matches `rudder.command()`).

  - `@rudderjs/cli`: new `rudder doctor` command with 12 built-in CLI-owned
    checks across three categories:

    - **env** (5) — `env:node-version` (semver vs `engines.node`),
      `env:package-manager` (lockfile + user-agent mismatch),
      `env:dotenv-loadable`, `env:app-key` (length validated, both raw and
      base64), `env:app-env` (recognized values).

    - **structure** (4) — `structure:bootstrap-app`,
      `structure:bootstrap-providers`, `structure:routes`,
      `structure:welcome-view`.

    - **deps** (3) — `deps:providers-manifest` (mtime vs `package.json`),
      `deps:declared-installed` (every `@rudderjs/*` resolvable from
      `node_modules`), `deps:auth-views` (vendored when a frontend
      renderer is installed alongside `@rudderjs/auth`).

    Reporter renders icons + per-check `fix:` lines + footer counts and
    timing. Exit code is `1` if any check is `error`, else `0`. Flags:
    `--verbose` (show `detail` blocks under passing checks too) and
    `--only <substring>` (run a subset by id). `--deep` / `--fix` / `--json`
    are reserved with a clear "not implemented yet" message — they land in
    subsequent phases.

  Tests: 23 new tests across registry, orchestrator, reporter, and a
  temp-dir integration suite that covers golden-path scaffold + 10
  broken-state scenarios.

  Public API stability: `DoctorCheck` / `DoctorResult` / `registerDoctorCheck`
  are stable. The `--json` flag is intentionally reserved (currently errors
  with exit code 2) so the future machine-readable output can land without
  churn.

- a3a7368: Phase 3 of `rudder doctor` — first wave of package-contributed checks.

  Thirteen framework packages now ship a `<package>/doctor` subpath whose
  side-effect import registers domain-specific health checks on the shared
  doctor registry. The CLI's lazy loader auto-imports them when
  `rudder doctor` runs.

  New checks (14 total, grouped by category):

  - **auth** — `auth:secret` (AUTH_SECRET set + length sane), `auth:views-vendored`
    (vendored when a frontend renderer is installed).
  - **auth** (cont.) — `session:secret` (SESSION_SECRET length when set), `hash:driver`
    (config string ∈ {bcrypt, argon2}; flags missing `argon2` peer).
  - **orm** — `orm-prisma:schema` (schema files present), `orm-prisma:client-generated`
    (mtime check vs schema), `orm-prisma:database-url`, `orm-drizzle:schema`,
    `orm-drizzle:database-url`.
  - **billing** — `cashier-paddle:api-key`, `cashier-paddle:webhook-secret`
    (both conditional on a cashier route being mounted).
  - **queue** — `queue-bullmq:redis-url`, `queue-inngest:event-key`,
    `queue-inngest:signing-key`.
  - **ai** — `ai:provider-keys` (greps `config/ai.ts` for declared driver
    literals, then checks each cloud provider's API key env var).
  - **mcp** — `mcp:route-mounted` (if `app/Mcp/` has tools, mcp route is
    registered).
  - **monitoring** — `telescope:dashboard`, `pulse:dashboard`,
    `horizon:dashboard` (dashboard route reachable from `routes/web.ts`).

  Adding a new contributing package: ship a `<package>/doctor` subpath with
  side-effect `registerDoctorCheck` calls and append the package name to
  `PACKAGES_WITH_CHECKS` in `@rudderjs/cli/src/doctor/load-package-checks.ts`.

  Implementation notes:

  - The CLI's loader resolves doctor subpaths via direct path
    (`<cwd>/node_modules/<pkg>/dist/doctor.js`), not `createRequire.resolve`,
    because the `./doctor` exports condition is `import`-only (no `require`)
    and the strict-mode pnpm node_modules don't expose user-installed
    packages from the CLI's location. Documented as the ESM-only-peer
    resolution workaround.
  - `deps:auth-views` was removed from the CLI's built-in checks — the
    identical concern now lives at `auth:views-vendored` in
    `@rudderjs/auth/doctor`, where it belongs. Net check count for a user
    with `@rudderjs/auth` installed: same (one each); for a user without
    auth, doctor stays silent on the topic instead of saying "auth not
    installed — skip".

  No tests added in this phase — each check is small enough to be tested
  implicitly via integration smoke (the existing temp-dir test suite in
  `@rudderjs/cli`, plus a manual smoke against `playground/`). Per-package
  test suites for these checks may land in a follow-up.

  Phase 4 (`--deep`) and Phase 5 (`--fix`) follow in subsequent releases.

- aecb6a9: Phase 4 of `rudder doctor` — `--deep` runtime mode.

  `rudder doctor --deep` now boots the app (catching boot errors as a check
  result, never crashing doctor itself) and runs 6 new runtime checks
  that interrogate the live DI graph and external services.

  What's new:

  - **`runtime:app-boot`** (cli) — wraps `bootApp()` in try/catch. Boot
    success/failure becomes a check result with the error message + stack
    trace under `--verbose`. The fix line points at the most likely causes
    (missing env vars, unreachable services, missing provider deps).

  - **`runtime:port-free`** (cli) — `net.createServer().listen(PORT)` then
    immediately close. On `EADDRINUSE` it shells out to `lsof -ti :PORT`
    (macOS/Linux) to report the holding PID with a paste-able `kill <pid>`
    fix. Windows skips the PID lookup since `lsof` isn't standard there.

  - **`orm-prisma:db-connect`** — spawns a fresh PrismaClient via the
    user's resolved `@prisma/client`, runs `$connect()` + `$queryRaw\`SELECT
    1\``, disconnects. DSN passwords are redacted in error messages.

  - **`orm-prisma:migration-drift`** — runs `pnpm exec prisma migrate
status`; warns on pending migrations or drift, points at
    `pnpm rudder migrate`.

  - **`queue-bullmq:redis-ping`** — opens an ioredis connection with
    `lazyConnect: true`, `maxRetriesPerRequest: 0`, sends `PING`, closes.
    Fails fast (no retry storm), redacts the URL in the error.

  - **`mail:smtp-connect`** — raw TCP connect (no SMTP handshake, no
    credentials sent) to MAIL_HOST:MAIL_PORT or the host inferred from
    `config/mail.ts`. Times out after 2s.

  Implementation notes:

  - Boot status flows from the doctor command to runtime checks via a
    `globalThis['__rudderjs_doctor_boot_status__']` slot (the same pattern
    cli/router/orm use for cross-module singletons that survive Vite SSR
    re-eval).

  - The doctor command stays in `NO_BOOT_EXACT`. With `--deep`, the
    handler calls `bootApp()` itself inside try/catch, AFTER the
    built-in/package checks have registered. This means a boot crash
    doesn't take out the orchestrator — every runtime check still gets
    to render.

  - `--only <substring>` now matches both check id AND category. `--only
orm` catches `orm-prisma:*` + `orm-drizzle:*`; `--only runtime`
    catches every `category: 'runtime'` check regardless of package
    prefix.

  - Each runtime check that depends on an env var (DATABASE_URL,
    REDIS_URL, MAIL_HOST) skips with a clean "covered by <fast-path
    check>" message when the var is unset, instead of failing loudly.
    The fast-path check has already flagged the issue.

  End-to-end smoke against the playground: 28 checks across 10
  categories with `--deep`, every runtime check loads via the lazy
  loader and surfaces actionable findings or appropriate skips.

  Phase 5 (`--fix` idempotent auto-recovery) and Phases 6-7 (docs +
  ship) follow in subsequent PRs.

### Patch Changes

- Updated dependencies [b28e51f]
  - @rudderjs/console@1.1.0

## 4.4.0

### Minor Changes

- b04d3d4: Add `rudder add <package>` — install a RudderJS package end-to-end with one command.

  ## What it does

  ```
  $ pnpm rudder add queue

    Adding @rudderjs/queue...
    ✓ added 1 dependency
    Generated config/queue.ts
    Registered "queue" in config/index.ts
    Refreshing provider manifest...

    ✓ queue is ready.
      Background jobs: `import { Bus } from "@rudderjs/queue"; Bus.dispatch(new MyJob())`.
  ```

  Each invocation:

  1. Validates the alias against a known registry (25 packages — same set the scaffolder offers under "Custom").
  2. Checks dependencies (e.g. `passport` requires `auth` + Prisma).
  3. Runs the package manager (auto-detected from `npm_config_user_agent`) to install `@rudderjs/<name>`.
  4. Writes `config/<name>.ts` from a vendored template — skipped if the file already exists.
  5. Surgically inserts the new entry into `config/index.ts` (import line + `configs = { ... }` key). Idempotent: re-running returns "already registered" without duplicating anything.
  6. Re-runs `providers:discover` so the framework picks up the new provider.
  7. Prints a one-line hint specific to the package (e.g. `Set ANTHROPIC_API_KEY in .env` for `ai`).

  ## Why

  Pairs with the `create-rudder-app` recipe simplification (PR #519). The scaffolder now ships with a minimal default; `rudder add` is the natural growth path for "I want to add queue / mail / telescope later" without manually editing `package.json`, generating a config file, and re-running `providers:discover`.

  ## Supported aliases

  `auth`, `sanctum`, `passport`, `socialite`, `crypt`, `queue`, `storage`, `scheduler`, `mail`, `notifications`, `broadcast`, `sync`, `localization`, `pennant`, `http`, `process`, `concurrency`, `terminal`, `image`, `telescope`, `pulse`, `horizon`, `ai`, `mcp`, `boost`. Accepts either the short alias (`rudder add queue`) or the full npm name (`rudder add @rudderjs/queue`).

  ## Skip-boot

  `add` is in the CLI's skip-boot list — the freshly-added provider hasn't been registered with the manifest yet, so booting the app would crash on the missing provider before the command's own `providers:discover` step gets a chance to refresh the manifest.

- 44f4cdc: Add `rudder remove <package>` — the natural counterpart to `rudder add`.

  Reverses every step the `add` command makes:

  1. **Validates** the alias against the same registry (25 packages).
  2. **Refuses cleanly** when other installed packages still depend on the target. `rudder remove auth` while `sanctum` or `passport` is installed fails with: `"Cannot remove auth — these installed packages depend on it: passport. Remove them first, or keep auth installed."`
  3. **Uninstalls** the npm dependency via the auto-detected package manager.
  4. **Deletes** `config/<name>.ts` (unless `--keep-config` is passed).
  5. **Surgically unregisters** the entry from `config/index.ts` — removes the import line and drops the key from the `configs = { ... }` map. Idempotent: returns `not-registered` if the key is already gone.
  6. **Re-runs** `providers:discover` so the removed provider drops out of the manifest.

  Like `rudder add`, this lives in the skip-boot list — the about-to-be-deleted provider may still be in `node_modules` but is being torn out; booting the app would be wasted work at best and surface confusing errors at worst.

  ## Idempotency

  - `rudder remove queue` when `@rudderjs/queue` is already absent: prints `"@rudderjs/queue is not installed — nothing to remove"`, and opportunistically cleans up any orphaned `config/queue.ts` or `config/index.ts` entry left behind by a manual `pnpm remove`.
  - Running twice in a row is safe — the second invocation just hits the not-installed branch.

  ## --keep-config

  For users who want to uninstall the dependency but keep their tuned `config/<name>.ts` for later. The config file stays in place; the npm package goes away. Useful when temporarily uninstalling to test compatibility, or when migrating between adapter packages that share a config shape.

### Patch Changes

- 9f4ce0f: Make the scaffolder magical — turn the first 60 seconds with RudderJS into "scaffold → working app" instead of "scaffold → copy 4–5 commands → working app".

  ## What changed in `create-rudder-app`

  - **Recipe picker** replaces the 25-option package multiselect. One question — _"What are you building?"_ — picks from `web-app` / `saas` / `api-service` / `realtime` / `minimal` / `custom`. The Custom escape hatch preserves the full multiselect for power users.
  - **Frontend prompts collapsed**: 4 prompts (frameworks multi, primary, tailwind, shadcn) → 2 (framework single-select, styling single-select). Both auto-skipped for `api-service` and `minimal`.
  - **Demos dropped from the default scaffold.** The 15-option demo multiselect is gone; nothing scaffolds into `app/Views/Demos/`. The demos still live in the framework playground and at `rudderjs.com/examples` — link printed in the final panel.
  - **Auto-cascade after install** — what used to be 4–5 manual commands in the "Next Steps" panel now runs automatically:
    - `pnpm rudder db:generate` (always — no-op for Drizzle)
    - `pnpm rudder db:push` (SQLite by default; for Postgres/MySQL the scaffolder asks _"Is your DB running now?"_ first, falls through to manual steps if no)
    - `pnpm rudder vendor:publish --tag=auth-views-<framework>` (only if `@rudderjs/auth` couldn't vendor views via `fs.cp` — fallback path)
    - `pnpm rudder passport:keys` (only when passport is selected)
  - **`git init` + initial commit** — runs by default after the cascade (`--git=false` to skip). Skipped silently if `git` isn't on `$PATH` or `.git/` already exists.
  - **Final panel slimmed down**: when the auto-cascade succeeds end-to-end, the panel prints exactly one line — `cd app && pnpm dev`. When something needed user attention (DB not running, command failed), only the remediation steps appear.

  ## New flags

  | Flag                                         | What it does                                                                             |
  | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
  | `--recipe=<name>`                            | Preset bundle. Drives ORM default + packages + whether frontend prompts appear.          |
  | `--framework=react\|vue\|solid\|none`        | Singular shortcut — replaces `--frameworks` + `--primary-framework` for the common case. |
  | `--styling=tailwind+shadcn\|tailwind\|plain` | Single styling choice — collapses `--tailwind` + `--shadcn`.                             |
  | `--git=true\|false`                          | Whether to run `git init` after scaffolding (default `true`).                            |
  | `--db-ready=true\|false`                     | Pre-answer the "Is your DB running?" prompt; only matters for Postgres/MySQL.            |

  ## Backward compatibility

  All old flags (`--orm`, `--packages`, `--frameworks`, `--primary-framework`, `--tailwind`, `--shadcn`, `--demos`, `--install`) still parse and validate. JSON mode supports both shapes — either the new recipe-driven contract or the pre-recipe explicit contract. The `--demos` flag is now a silent no-op (demos were dropped from the default scaffold) — existing scripts and CI passing `--demos=...` keep working without modification.

  ## What changed in `@rudderjs/cli`

  Added `db:generate`, `db:push`, `migrate`, `migrate:fresh`, `migrate:status` to the CLI's skip-boot list. These commands all shell out to the underlying ORM binary (Prisma / drizzle-kit) and never touch app state.

  This is load-bearing for the create-rudder-app auto-cascade: `rudder db:generate` MUST work _before_ `@prisma/client` has been generated, which is exactly the chicken-and-egg the framework boot would hit on a fresh scaffolded project. Without this, `pnpm rudder db:generate` on a fresh app fails with `Could not load @prisma/client` because the framework's `DatabaseProvider` boots before generation runs. (`db:seed` is deliberately not in skip-boot — user seeders use the ORM and need a booted app.)

## 4.3.0

### Minor Changes

- 377212d: Add `rudder view:sync` command that regenerates `pages/__view/` (Vike stubs + `registry.d.ts` + `+config.ts`) from `app/Views/` without starting Vite. Useful when `tsc` runs in CI before any Vite step (typecheck-before-build order), on a fresh clone before the first dev server boot, or after manually clearing `pages/__view/`. Idempotent — safe to call repeatedly. Pass `--json` for machine-readable output.

  Also exposes `syncViewsFromDisk()` from `@rudderjs/vite/commands/view-sync` for programmatic use by tooling that needs to materialize the registry without booting the dev server.

  `view:sync` skips `bootApp()` (same pattern as `providers:discover`) so it works on apps that can't yet boot — exactly the scenarios it's designed for.

## 4.2.1

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

- Updated dependencies [b461123]
  - @rudderjs/console@1.0.2
  - @rudderjs/core@1.1.5
  - @rudderjs/router@1.2.1

## 4.2.0

### Minor Changes

- 343c96d: **Boost: `commands_list` + `command_run` MCP tools.** Agents can now discover and execute rudder commands directly from MCP — no more shelling out blindly.

  - `commands_list` returns built-in + package + user-defined commands with names, descriptions, args, options, and source. Optional `namespace` filter (e.g. `make`, `db`, `queue`).
  - `command_run` spawns a command as a subprocess, captures stdout/stderr/exit code/duration, enforces a timeout, and caps stream sizes. Subprocess isolation keeps the long-lived MCP server clean.
  - The CLI's `command:list` gains `--all` (include built-in + package commands) and `--json` (machine-readable output) flags. When the user app cannot boot, `command:list --json` still emits built-in + package commands plus a `bootError` field rather than crashing — partial info beats an opaque failure for an agent mid-session.

### Patch Changes

- f06331e: **A5 Phase 2 — `pnpm rudder ai:eval` CLI + JSON reporter.** Phase 1 shipped the eval framework; Phase 2 makes it a first-class command. The CLI walks `evals/**/*.eval.ts` (override via `config('ai').eval.pattern`), runs each suite serially, and reports pass/fail + cost + tokens.

  - **Console mode** (default) — uses Phase 1's `reportConsole` per suite.
  - **`--json`** — emits a `{ suites: [{ suite, passed, failed, cases: [{ name, status, pass, score?, reason?, tokens, cost, duration }] }] }` envelope to stdout. CI scripts can pipe directly into `jq`; matches the `command_run` MCP tool envelope shape so the boost agent surface and the eval CLI feel like one family.
  - **`--bail`** — stop on the first failing suite. Pairs with `--json` so a failing CI run streams the first failure without waiting for the rest.
  - **Positional name filter** — `pnpm rudder ai:eval support` runs only suites whose `name` includes `'support'` (case-insensitive substring).

  Exits 0 when every case passes, 1 otherwise (also 1 when no suites match in console mode; `--json` always exits 0 with an empty envelope so `jq` consumers don't crash).

  Phase 3 adds `jsonShape`/`semanticMatch`/`tokenCost` metrics; Phase 4 adds `--record`/`--replay` (AiFake-backed) + telescope `agent.eval.completed` events; Phase 5 adds the HTML report.

## 4.1.1

### Patch Changes

- 31d0c31: Add `@rudderjs/terminal` — `terminal('id', props)` renders Ink/React components from `app/Terminal/` in rudder commands, mirroring the `view()` ergonomics for the browser. Also adds `make:terminal` scaffolder to `@rudderjs/cli`.

## 4.1.0

### Minor Changes

- 5447fa9: Add `FormRequest` lifecycle hooks (Laravel parity #6).

  `FormRequest` now supports five optional protected methods that mirror Laravel's lifecycle:

  - `prepareForValidation(input)` — mutate merged input pre-parse (sync). Lowercase emails, trim strings, etc.
  - `messages()` — per-request error message overrides keyed by dot-path. Static string or `(issue) => string`.
  - `after()` — array of cross-field check closures with `addError(path, msg)`. Run serially after parse; all errors collected in one round-trip.
  - `passedValidation(data)` — final transform on parsed data (sync or async); return value replaces resolved data.
  - `failedValidation(errors)` — override the throw. Default throws `ValidationError`; return a Web `Response` to short-circuit (wrapped in a new `ValidationResponse` sentinel that the framework's exception handler unwraps).

  Existing `FormRequest` subclasses keep working unchanged — the hooks have empty default implementations.

  The `make:request` stub now includes commented-out hook signatures to aid discovery.

- 5703439: Pruning — `Prunable` / `MassPrunable` markers + `pnpm rudder model:prune` (Laravel parity #2 plan #8).

  Models declaring `static prunable()` are picked up by the new `model:prune` command. Default `pruneMode = 'instance'` re-queries each chunk and calls `instance.delete()` per row — soft-deletes apply, `deleting` / `deleted` observers fire, optional `static pruning(model)` runs first. `pruneMode = 'mass'` (`MassPrunable`) runs a single `qb.deleteAll()` per chunk — no observers, no hooks, soft-deletes bypassed (mirrors the existing bulk-delete primitive).

  CLI flags: `--model=A,B`, `--except=A`, `--chunk=N`, `--pretend`. Schedule it with `scheduler.command('model:prune').daily()` — first-class retention hook with zero per-model wiring.

  Programmatic entry: `pruneModels({ models?, except?, chunk?, pretend? })` returns one `{ model, mode, count }` report per pruned model. Re-queries instead of `offset()` paging because deletions shift the cursor.

### Patch Changes

- ca63e78: Add Laravel-style `Route::resource` / `apiResource` / `singleton` to `@rudderjs/router` and `make:controller --resource`/`--api`/`--singleton` flags to `@rudderjs/cli` (Laravel parity #5, PR3 of 3).

  **Public API on `Router`:**

  - `router.resource(name, Ctrl, opts?)` — registers the seven canonical RESTful routes (`index`/`create`/`store`/`show`/`edit`/`update`/`destroy`). The `update` route is registered for both `PUT` and `PATCH` at the same path.
  - `router.apiResource(name, Ctrl, opts?)` — same as `resource` but skips `create` + `edit` (no HTML form pages).
  - `router.singleton(name, Ctrl, opts?)` — registers `show`/`edit`/`update` only. The returned `SingletonRegistration` exposes `.creatable()` (adds `GET /<name>/create` + `POST /<name>`) and `.destroyable()` (adds `DELETE /<name>`).

  ```ts
  class PostController {
    async index(ctx) {
      /* … */
    }
    async show(ctx) {
      /* … */
    }
    async store(ctx) {
      /* … */
    }
    // …
  }

  router.resource("posts", PostController);
  router.apiResource("posts", PostController, { only: ["index", "show"] });
  router.singleton("profile", ProfileController).creatable().destroyable();
  ```

  **Controller convention:** plain class, no decorators. Methods are matched by name to the canonical verbs. **Methods the controller doesn't implement are silently skipped** — a controller with only `index`/`show` works without an `only` or `except` filter.

  **`ResourceOptions`:** `only`, `except`, `parameters` (override `:param` segment name), `names` (override generated route names), `middleware`.

  **Default route names:** `<resource>.<verb>` (e.g. `posts.index`, `posts.show`). Default `:param` name is a naive singular of `name` (`posts → post`, `categories → category`, `boxes → box`); irregular plurals must use the `parameters` option.

  **Per-route customisation:** the returned `ResourceRegistration` exposes the underlying `RouteBuilder[]` in declaration order. Apply `where*()` or per-route middleware to a single verb without affecting the rest:

  ```ts
  const reg = router.resource("posts", PostController);
  reg.builders[3].whereNumber("post"); // constrain show route only
  ```

  **Scaffolder support:** `make:controller` accepts three mutually-exclusive flags:

  ```bash
  pnpm rudder make:controller PostController --resource     # full 7-verb plain class
  pnpm rudder make:controller PostController --api          # 5-verb (no create/edit)
  pnpm rudder make:controller ProfileController --singleton # show/edit/update only
  ```

  Default `make:controller` (no flag) still emits the decorator-based stub.

  This completes the router parity sweep (#5). PR1 added `where*()` constraints; PR2 added `router.group()` / subdomain routing / `.missing()`. No changes to the public surface of any other package.

  **Internal note:** `MakeSpec.stub` callback now receives the parsed CLI opts as a second argument (`(className, opts) => string`), enabling per-flag stub dispatch. Existing single-arg callbacks continue to type-check.

- Updated dependencies [6c03c74]
- Updated dependencies [3ccac5d]
- Updated dependencies [5447fa9]
- Updated dependencies [a0b96f9]
- Updated dependencies [ca63e78]
- Updated dependencies [fcca26b]
  - @rudderjs/core@1.1.0
  - @rudderjs/router@1.1.0

## 4.0.2

### Patch Changes

- 1d81533: Graduate `@rudderjs/console` to 1.0.0.

  The command registry (`Rudder` / `rudder`), `CommandBuilder` chain, `Command` abstract class (with argument/option accessors, output helpers `info`/`error`/`warn`/`line`/`comment`/`newLine`/`table`, and prompt helpers `ask`/`confirm`/`choice`/`secret`), `parseSignature()`, the `MakeSpec` scaffolder pipeline (`registerMakeSpecs`/`getMakeSpecs`/`executeMakeSpec`), and the `CommandObserverRegistry` are now stable.

  `CliError` moves from `@rudderjs/cli` to `@rudderjs/console`. `@rudderjs/cli` keeps re-exporting it for backwards compatibility, so `import { CliError } from '@rudderjs/cli'` continues to work — but new code should import from `@rudderjs/console` (where the rest of the command primitives live).

  Boost guidelines were corrected — prior versions documented prompt methods (`prompt`, `select`, `multiselect`, `success`) that don't exist on the `Command` class. The real names are `ask`, `choice`, `info`.

- Updated dependencies [1d81533]
  - @rudderjs/console@1.0.0
  - @rudderjs/core@1.0.1

## 4.0.1

### Patch Changes

- 8689218: **`@rudderjs/horizon`** — Fix the BullMQ correctness bug where every job appeared stuck at `pending` forever on the dashboard, even after the worker terminal logged `✓ completed` / `✗ failed`.

  Two stacked architectural bugs are fixed in one change:

  1. `JobCollector` was monkey-patching `dispatch()` and mutating `job.handle` on the in-memory `Job` instance. BullMQ serializes the job via `JSON.parse(JSON.stringify(job))` and reconstructs a fresh instance in the worker process — so the wrapped handler that was supposed to flip status to `processing` / `completed` / `failed` lived only in the dispatcher's heap and was never reached.
  2. `MemoryStorage` is per-process. The dev/web process and the worker process held separate in-memory arrays with no path to share state; even if the wrap had survived, the dashboard process couldn't see what the worker recorded.

  **Fix shape:**

  - `@rudderjs/queue` now exposes a `@rudderjs/queue/observers` subpath — a `QueueObserverRegistry` singleton on `globalThis` that adapters emit lifecycle events to. Same pattern as `@rudderjs/mcp/observers`, `@rudderjs/http/observers`, etc.
  - The built-in `SyncAdapter` and `@rudderjs/queue-bullmq`'s `BullMQAdapter` emit `job.dispatched` / `job.active` / `job.completed` / `job.failed` events at the right lifecycle points. BullMQ emits `active` from the worker process via `processor()`, and `completed` / `failed` via `worker.on(...)` — the exact transitions that previously didn't reach the dashboard.
  - `@rudderjs/horizon` adds a third storage driver, `RedisStorage`, alongside `MemoryStorage` and `SqliteStorage`. The `JobCollector` is rewritten to subscribe to `queueObservers` instead of monkey-patching the adapter — observer events emitted in the worker process flow through Redis to the dashboard process.
  - `WorkerCollector` only self-registers when `RUDDERJS_QUEUE_WORKER=1` is set. The CLI sets it before booting providers when running `queue:work`, and the BullMQ adapter sets it again defensively before instantiating `Worker`s — so the dev/web process no longer lists itself as a worker.
  - `HorizonProvider.boot()` warns when `queue: bullmq` + `horizon.storage: memory` is detected, surfacing the misconfig before it manifests as a dead dashboard.

  **Migration:**

  If you're using `@rudderjs/queue-bullmq`, switch `config/horizon.ts` to:

  ```ts
  import { Env } from "@rudderjs/core";
  import type { HorizonConfig } from "@rudderjs/horizon";

  export default {
    storage: "redis",
    redis: {
      url: Env.get("REDIS_URL", ""),
      host: Env.get("REDIS_HOST", "127.0.0.1"),
      port: Env.getNumber("REDIS_PORT", 6379),
      password: Env.get("REDIS_PASSWORD", ""),
      prefix: "rudderjs",
    },
    // … rest of config unchanged
  } satisfies HorizonConfig;
  ```

  `ioredis` is now an optional dep — if you have `@rudderjs/queue-bullmq` installed, you already have it.

  If you're on the `sync` driver, no migration needed — `MemoryStorage` continues to work and `'memory'` stays the default.

  **Why a major bump:** the storage interface adds a third driver, the config interface adds `redis`, and the runtime path for BullMQ users changes meaningfully. The public `Horizon` facade (`recentJobs()` / `failedJobs()` / etc.) is unchanged.

  **`@rudderjs/queue`** — additive: new `@rudderjs/queue/observers` subpath. `SyncAdapter.dispatch()` now emits four lifecycle events. Existing consumers that don't subscribe see no behavior change.

  **`@rudderjs/queue-bullmq`** — emits the same lifecycle events from the dispatcher and worker processes. Sets `RUDDERJS_QUEUE_WORKER=1` before instantiating BullMQ `Worker`s.

  **`@rudderjs/cli`** — sets `RUDDERJS_QUEUE_WORKER=1` when argv includes `queue:work`, before booting providers, so cross-cutting collectors can self-register at the right time.

  Pulse's queue recorder has the same architecture as the old horizon JobCollector and currently misses BullMQ worker-side events too. Documented as a known limitation in pulse's README; fix deferred to a follow-up that subscribes the recorder to `queueObservers`.

  Plan: `docs/plans/2026-05-01-horizon-bullmq-fix.md`

## 4.0.0

### Patch Changes

- Updated dependencies [cd38418]
  - @rudderjs/core@1.0.0
  - @rudderjs/router@1.0.0

## 3.0.2

### Patch Changes

- 8411cd5: **Renamed `@rudderjs/rudder` → `@rudderjs/console`** to match Laravel's `Illuminate\Console` namespace and remove the "rudder rudder" stutter (the binary is `rudder`, the framework is RudderJS, and the authoring package is now `console` — no more triple-naming collision).

  **Migration for consumers:**

  ```ts
  // before
  import { Rudder, Command } from "@rudderjs/rudder";

  // after
  import { Rudder, Command } from "@rudderjs/console";
  ```

  **No symbol changes** — `Rudder`, `Command`, `CommandRegistry`, `CommandBuilder`, `MakeSpec`, `CancelledError`, `parseSignature`, `commandObservers` all keep their names. Only the import path changes.

  **No CLI changes** — the binary is still `rudder` (`pnpm rudder ...`), and the runner package is still `@rudderjs/cli`. Internal dependency updates only.

  **Naming model after this rename:**

  | Concept                 | Package                 | Surface               |
  | ----------------------- | ----------------------- | --------------------- |
  | Author HTTP routes      | `@rudderjs/router`      | `Route.get(...)`      |
  | Run HTTP routes         | `@rudderjs/server-hono` | (boots HTTP server)   |
  | Author console commands | `@rudderjs/console`     | `Rudder.command(...)` |
  | Run console commands    | `@rudderjs/cli`         | `rudder` binary       |

  The old `@rudderjs/rudder` will be deprecated on npm with a pointer to `@rudderjs/console` after publish.

- Updated dependencies [8411cd5]
  - @rudderjs/console@0.0.4
  - @rudderjs/core@0.1.4

## 3.0.1

### Patch Changes

- Updated dependencies [e720923]
  - @rudderjs/core@0.1.1

## 3.0.0

### Patch Changes

- Updated dependencies [ba543c9]
  - @rudderjs/router@0.3.0
  - @rudderjs/core@0.1.0

## 2.0.1

### Patch Changes

- Updated dependencies [dc37411]
  - @rudderjs/router@0.2.1
  - @rudderjs/core@0.0.12

## 2.0.0

### Patch Changes

- Updated dependencies [6fb47b4]
  - @rudderjs/router@0.2.0
  - @rudderjs/core@0.0.11

## 1.0.0

### Patch Changes

- Updated dependencies [9fa37c7]
  - @rudderjs/router@0.1.0
  - @rudderjs/core@0.0.10

## 0.0.7

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

- Updated dependencies [e1189e9]
  - @rudderjs/core@0.0.9
  - @rudderjs/router@0.0.4
  - @rudderjs/rudder@0.0.3

## 0.0.5

### Patch Changes

- Updated dependencies
  - @rudderjs/core@0.0.6

## 0.0.4

### Patch Changes

- Updated dependencies
  - @rudderjs/rudder@0.0.2
  - @rudderjs/core@0.0.5

## 0.0.3

### Patch Changes

- @rudderjs/core@0.0.4
