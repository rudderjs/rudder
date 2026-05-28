# @rudderjs/console

## 1.2.0

### Minor Changes

- bdfb88c: Fix `make:terminal` generating a broken component (found by dogfooding).

  `pnpm rudder make:terminal <Name>` wrote `app/Terminal/<Name>Terminal.ts` — a `.ts` file containing JSX (Ink), which doesn't compile, with a spurious `Terminal` suffix that the `terminal('id')` resolver (`'dashboard'` → `app/Terminal/Dashboard.tsx`) could never find. So scaffolded terminal components neither compiled nor resolved.

  - `@rudderjs/console` — `MakeSpec` gains an optional `extension` field (defaults to `ts`); `executeMakeSpec` honors it. Lets a stub opt into `tsx` (or any extension) instead of the hardcoded `.ts`.
  - `@rudderjs/terminal` — `makeTerminalSpec` now sets `extension: 'tsx'` and drops the `Terminal` suffix, so `make:terminal Dashboard` produces `app/Terminal/Dashboard.tsx` — which compiles and is resolvable by `terminal('dashboard')`, matching the documented behavior.

## 1.1.0

### Minor Changes

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

## 1.0.3

### Patch Changes

- 8917f6a: Fix `pnpm rudder <any-command>` crashing in production with
  `cannot add command 'db:seed' as already have command 'db:seed'`.

  Root cause: two registrations of `db:seed` landed on the global `rudder`
  CommandRegistry — one from `@rudderjs/orm`'s built-in `db:seed` (resolves
  `database/seeders/DatabaseSeeder.{ts,js,mts,mjs}`) and one from the
  scaffolded `routes/console.ts` stub. `CommandRegistry#command()` push-appended
  without dedup, both survived to the commander.js layer, and commander threw
  on the second registration. Development masked the collision because
  `@rudderjs/core`'s `_bootstrapProviders()` calls `rudder.reset()` between
  the package-command load phase and the route-loader phase — but only when
  `isDevelopment()`. Production skipped the reset, so the crash only surfaced
  after deploy.

  What changes:

  - `create-rudder-app`: scaffolded `routes/console.ts` no longer emits a
    `rudder.command('db:seed', ...)` TODO stub. A short comment points users
    at the framework-provided pattern instead — drop a default-exported
    `Seeder` subclass at `database/seeders/DatabaseSeeder.ts`. The framework's
    `db:seed` (from `@rudderjs/orm`) auto-resolves and runs it.

  - `@rudderjs/console`: `CommandRegistry#command()` now uses last-writer-wins
    semantics. If a command name is registered twice, the second registration
    replaces the first and a `console.warn` describes the override. This
    prevents the entire class of bug for any future framework-vs-user command
    collision (e.g. user-override of `route:list`, `make:migration`, etc.)
    rather than fixing just `db:seed`.

  Surfaced 2026-05-20 by pilotiq-io's production boot — caught only because
  the smoke test ran `pnpm rudder inspire` in NODE_ENV=production after deploy.

  No public API change. Existing user code that registers unique command
  names is unaffected.

## 1.0.2

### Patch Changes

- b461123: Declare `engines.node: "^20.19.0 || >=22.12.0"` on every published package and on the scaffolder-generated `package.json` template.

  Matches the actual runtime floor enforced transitively by `vite@7` (`^20.19.0 || >=22.12.0`) and `vike` (`>=20.19.0`). Previously the requirement was only mentioned in the install guide — adding it to `engines.node` surfaces the floor at `pnpm install` / `npm install` time via the package manager's engines warning, rather than waiting for runtime / transitive errors.

  Not a breaking API change — `engines` is advisory by default (package managers warn but don't refuse without `engineStrict=true`).

## 1.0.1

### Patch Changes

- 95e9f4a: Include `boost/` directory in npm tarball so `guidelines://<pkg>` MCP resources are available in installed apps.

## 1.0.0

### Major Changes

- 1d81533: Graduate `@rudderjs/console` to 1.0.0.

  The command registry (`Rudder` / `rudder`), `CommandBuilder` chain, `Command` abstract class (with argument/option accessors, output helpers `info`/`error`/`warn`/`line`/`comment`/`newLine`/`table`, and prompt helpers `ask`/`confirm`/`choice`/`secret`), `parseSignature()`, the `MakeSpec` scaffolder pipeline (`registerMakeSpecs`/`getMakeSpecs`/`executeMakeSpec`), and the `CommandObserverRegistry` are now stable.

  `CliError` moves from `@rudderjs/cli` to `@rudderjs/console`. `@rudderjs/cli` keeps re-exporting it for backwards compatibility, so `import { CliError } from '@rudderjs/cli'` continues to work — but new code should import from `@rudderjs/console` (where the rest of the command primitives live).

  Boost guidelines were corrected — prior versions documented prompt methods (`prompt`, `select`, `multiselect`, `success`) that don't exist on the `Command` class. The real names are `ask`, `choice`, `info`.

## 0.0.4

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

> Renamed from `@rudderjs/rudder` on 2026-04-28. Version history continues from the `@rudderjs/rudder` line. The `@rudderjs/rudder` package on npm has been deprecated with a pointer here.

## 0.0.3

### Patch Changes

- e1189e9: Rolling patch release covering recent work across the monorepo:

  - **@rudderjs/mcp** — HTTP transport with SSE, OAuth 2.1 resource server (delegated to `@rudderjs/passport`), DI in `handle()`, `mcp:inspector` CLI, output schemas, URI templates, standalone client tools
  - **@rudderjs/passport** — OAuth 2 server with authorization code + PKCE, client credentials, refresh token, and device code grants; `registerPassportRoutes()`; JWT tokens; `HasApiTokens` mixin; smoke test suite
  - **@rudderjs/telescope** — MCP observer entries; Laravel request-detail parity (auth user, headers, session, controller, middleware, view)
  - **@rudderjs/boost** — Replaced ESM-incompatible `require('node:*')` calls in `server.ts`, `docs-index.ts`, `tools/route-list.ts` with top-level imports
  - **create-rudder-app** — MCP and passport options; live config wiring; scaffolder template fixes
  - **All packages** — Drift fixes in typechecks and tests after auth/migrate/view refactors; lint fixes (`oauth2.ts`, `telescope/routes.ts`); removed stale shared `tsBuildInfoFile` from `tsconfig.base.json` so per-package buildinfo no longer clobbers across packages

## 0.0.2

### Patch Changes

- Export `Rudder` alias and `CancelledError` class — required by `@rudderjs/core` re-exports.
