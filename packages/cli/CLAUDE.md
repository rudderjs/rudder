# @rudderjs/cli

The `rudder` CLI — Laravel Artisan equivalent. Commander.js-based runner that discovers commands from packages.

## Key Files

- `src/index.ts` — CLI bootstrap: finds `bootstrap/app.ts`, loads package commands, boots app, runs commander
- `src/errors.ts` — `CliError` class
- `src/commands/make.ts` — Router for CLI-owned + package-contributed `make:*` scaffolders
- `src/commands/make/` — 10 CLI-owned generators: controller, model, job, middleware, request, provider, command, event, listener, mail
- `src/commands/make/_shared.ts` — Legacy `registerMake()` helper (MakeSpec now lives in `@rudderjs/console`)
- `src/commands/command-list.ts` — `command:list` tabular output. Supports `--all` (include built-in + package commands) and `--json` (machine-readable, used by `@rudderjs/boost`'s `commands_list` MCP tool)
- `src/commands/providers-discover.ts` — Thin wrapper; scanning logic lives in `@rudderjs/core`
- `src/commands/vendor-publish.ts` — Publishes provider assets
- `src/commands/module.ts` — `module:make`, `module:publish`
- `src/commands/doctor.ts` — `doctor` command wiring (`--deep`, `--fix`, `--yes`, `--verbose`, `--only`); fast-path stays in skip-boot list, `--deep` boots on demand
- `src/doctor/` — `registry` (in `@rudderjs/console`), `orchestrator`, `reporter`, `fixer`, `boot-status`, `built-in/` (cli-owned env / structure / deps / runtime checks), `load-package-checks.ts` (lazy-import each package's `./doctor` subpath)

## Architecture Rules

- **CLI is the runner, not the command owner**: packages register their own commands via `rudder.command()` in provider `boot()` or via `MakeSpec` objects
- **Package command loading**: `loadPackageCommands()` eagerly imports command modules from `@rudderjs/ai`, `@rudderjs/mcp`, `@rudderjs/orm`, `@rudderjs/router` via dynamic subpath imports (try/catch if not installed)
- **Skip-boot commands**: `make:*`, `providers:discover`, `module:publish` skip `bootApp()` — faster + avoids chicken-and-egg
- **Two command styles**: inline via `rudder.command()` or class-based extending `Command`
- **MakeSpec pattern**: `@rudderjs/console` provides `MakeSpec` interface, `registerMakeSpecs()`, `executeMakeSpec()`. Packages export specs, CLI collects them.
- **App discovery**: walks up directory tree to find `bootstrap/app.ts`, changes cwd to app root

## Command Ownership

| Owner | Commands |
|---|---|
| CLI (direct) | `make:controller`, `make:model`, `make:job`, `make:middleware`, `make:request`, `make:provider`, `make:command`, `make:event`, `make:listener`, `make:mail`, `command:list`, `module:make`, `module:publish`, `vendor:publish`, `providers:discover` (thin wrapper) |
| `@rudderjs/ai` | `make:agent`, `ai:eval` |
| `@rudderjs/mcp` | `make:mcp-server`, `make:mcp-tool`, `make:mcp-resource`, `make:mcp-prompt`, `mcp:start`, `mcp:list` |
| `@rudderjs/orm` | `migrate`, `migrate:fresh`, `migrate:status`, `make:migration`, `db:push`, `db:generate`, `model:prune` |
| `@rudderjs/router` | `route:list` |
| `@rudderjs/queue` | `queue:work`, `queue:status`, `queue:clear`, `queue:failed`, `queue:retry` |
| `@rudderjs/schedule` | `schedule:run`, `schedule:work`, `schedule:list` |
| `@rudderjs/storage` | `storage:link` |
| `@rudderjs/sync` | `sync:docs`, `sync:clear`, `sync:inspect` |
| `@rudderjs/broadcast` | `broadcast:connections` |
| `@rudderjs/boost` | `boost:install`, `boost:update`, `boost:mcp` |
| CLI + all framework packages | `doctor` — green/yellow/red pre-flight across 36 checks. CLI ships `env` / `structure` / `deps` / `runtime` checks; framework packages contribute via a `./doctor` subpath export (see `load-package-checks.ts`) |

## Doctor pattern

- **Registry** lives in `@rudderjs/console` (`registerDoctorCheck` / `getRegisteredChecks`); singleton on `globalThis` to survive Vite SSR re-eval, idempotent registration (last-writer-wins).
- **Package contribution**: a `<package>/doctor` subpath whose side-effect import calls `registerDoctorCheck()` for that package's rules. Mirrors `<package>/commands/<name>` pattern but specifically for doctor. The CLI's loader walks `node_modules/@rudderjs/<pkg>/dist/doctor.js` directly — keeps the ESM-only-peer resolution out of the path.
- **Adding a contributing package**: append to `PACKAGES_WITH_CHECKS` in `src/doctor/load-package-checks.ts` AND declare the subpath in the package's `package.json#exports`. Packages not installed in the user app are silently skipped.
- **Fixers** are optional (`fixer()` on the check). Must be idempotent regenerate-style operations — never touch `.env`, `package.json`, or user-authored files. Today: providers-manifest (in-process), prisma-client (`pnpm exec prisma generate`), auth-views (copy + skip existing).
- **`--deep`** boots the app once via the injected `bootApp()`; failure is captured as a single red `runtime:app-boot` check, never crashes doctor itself.

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## Pitfalls

- Must run from a directory with `bootstrap/app.ts` reachable (or playground/)
- `@clack/prompts` is server-only — must be in `optimizeDeps.exclude` in cross-repo Vite configs
- Package commands use dynamic imports with `tryImport()` — TypeScript can't resolve them at compile time (by design)
