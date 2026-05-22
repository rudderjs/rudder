# @rudderjs/cli

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
