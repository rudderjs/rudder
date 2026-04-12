# @rudderjs/cli

The `rudder` CLI — Laravel Artisan equivalent. Commander.js-based with scaffolders, migrations, and introspection commands.

## Key Files

- `src/index.ts` — CLI bootstrap: finds `bootstrap/app.ts`, boots app, runs commander
- `src/errors.ts` — `CliError` class
- `src/commands/make.ts` — Router for all `make:*` scaffolders
- `src/commands/make/` — 15 generators: controller, model, job, middleware, request, provider, command, event, listener, mail, agent, mcp-server, mcp-tool, mcp-resource, mcp-prompt
- `src/commands/make/_shared.ts` — `MakeSpec` interface + `registerMake()` helper
- `src/commands/route-list.ts` — `route:list` tabular output
- `src/commands/command-list.ts` — `command:list` tabular output
- `src/commands/providers-discover.ts` — Generates `bootstrap/cache/providers.json`
- `src/commands/vendor-publish.ts` — Publishes provider assets
- `src/commands/module.ts` — `module:make`, `module:publish`

## Architecture Rules

- **Skip-boot commands**: `make:*`, `providers:discover`, `module:publish` skip `bootApp()` — faster + avoids chicken-and-egg
- **Two command styles**: inline via `rudder.command()` or class-based extending `Command`
- **MakeSpec pattern**: declarative stub templates with directory mapping and suffix appending
- **App discovery**: walks up directory tree to find `bootstrap/app.ts`, changes cwd to app root

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## Pitfalls

- Must run from a directory with `bootstrap/app.ts` reachable (or playground/)
- `@clack/prompts` is server-only — must be in `optimizeDeps.exclude` in cross-repo Vite configs
