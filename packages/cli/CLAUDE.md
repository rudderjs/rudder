# @rudderjs/cli

The `rudder` CLI — Laravel Artisan equivalent. Commander.js-based runner that discovers commands from packages.

## Key Files

- `src/index.ts` — CLI bootstrap: finds `bootstrap/app.ts`, loads package commands, boots app, runs commander
- `src/errors.ts` — `CliError` class
- `src/commands/make.ts` — Router for CLI-owned + package-contributed `make:*` scaffolders
- `src/commands/make/` — 10 CLI-owned generators: controller, model, job, middleware, request, provider, command, event, listener, mail
- `src/commands/make/_shared.ts` — Legacy `registerMake()` helper (MakeSpec now lives in `@rudderjs/rudder`)
- `src/commands/command-list.ts` — `command:list` tabular output
- `src/commands/providers-discover.ts` — Thin wrapper; scanning logic lives in `@rudderjs/core`
- `src/commands/vendor-publish.ts` — Publishes provider assets
- `src/commands/module.ts` — `module:make`, `module:publish`

## Architecture Rules

- **CLI is the runner, not the command owner**: packages register their own commands via `rudder.command()` in provider `boot()` or via `MakeSpec` objects
- **Package command loading**: `loadPackageCommands()` eagerly imports command modules from `@rudderjs/ai`, `@rudderjs/mcp`, `@rudderjs/orm`, `@rudderjs/router` via dynamic subpath imports (try/catch if not installed)
- **Skip-boot commands**: `make:*`, `providers:discover`, `module:publish` skip `bootApp()` — faster + avoids chicken-and-egg
- **Two command styles**: inline via `rudder.command()` or class-based extending `Command`
- **MakeSpec pattern**: `@rudderjs/rudder` provides `MakeSpec` interface, `registerMakeSpecs()`, `executeMakeSpec()`. Packages export specs, CLI collects them.
- **App discovery**: walks up directory tree to find `bootstrap/app.ts`, changes cwd to app root

## Command Ownership

| Owner | Commands |
|---|---|
| CLI (direct) | `make:controller`, `make:model`, `make:job`, `make:middleware`, `make:request`, `make:provider`, `make:command`, `make:event`, `make:listener`, `make:mail`, `command:list`, `module:make`, `module:publish`, `vendor:publish`, `providers:discover` (thin wrapper) |
| `@rudderjs/ai` | `make:agent` |
| `@rudderjs/mcp` | `make:mcp-server`, `make:mcp-tool`, `make:mcp-resource`, `make:mcp-prompt`, `mcp:start`, `mcp:list` |
| `@rudderjs/orm` | `migrate`, `migrate:fresh`, `migrate:status`, `make:migration`, `db:push`, `db:generate` |
| `@rudderjs/router` | `route:list` |
| `@rudderjs/queue` | `queue:work`, `queue:status`, `queue:clear`, `queue:failed`, `queue:retry` |
| `@rudderjs/schedule` | `schedule:run`, `schedule:work`, `schedule:list` |
| `@rudderjs/storage` | `storage:link` |
| `@rudderjs/live` | `live:docs`, `live:clear`, `live:inspect` |
| `@rudderjs/broadcast` | `broadcast:connections` |
| `@rudderjs/boost` | `boost:install`, `boost:update`, `boost:mcp` |

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## Pitfalls

- Must run from a directory with `bootstrap/app.ts` reachable (or playground/)
- `@clack/prompts` is server-only — must be in `optimizeDeps.exclude` in cross-repo Vite configs
- Package commands use dynamic imports with `tryImport()` — TypeScript can't resolve them at compile time (by design)
