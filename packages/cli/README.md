# @rudderjs/cli

RudderJS CLI — code generators, module scaffolding, and rudder command dispatch.

## Installation

The CLI is automatically included when you scaffold a project with `create-rudder`. For manual setup:

```bash
pnpm add -D @rudderjs/cli
```

Add to `package.json`:

```json
{
  "scripts": {
    "rudder": "node node_modules/@rudderjs/cli/dist/index.js"
  }
}
```

## Usage

```bash
pnpm rudder --help               # List all commands
pnpm rudder make:controller User # Generate a controller
pnpm rudder db:seed              # Run a user-defined command
```

**Must be run from a directory containing `bootstrap/app.ts`**. The CLI boots the RudderJS application before dispatching commands — all service providers, DI bindings, and database connections are available.

## How It Works

1. The CLI locates `bootstrap/app.ts` by walking up from the current directory
2. It calls `rudderjs.boot()` — boots all service providers
3. Route loaders for `commands` are executed (registers commands from `routes/console.ts`)
4. The CLI dispatches the matching command with parsed arguments and options

## Built-in Commands

### `make:*` Generators

| Command | Output | Description |
|---------|--------|-------------|
| `make:controller <Name>` | `app/Http/Controllers/<Name>Controller.ts` | Decorator-based controller |
| `make:model <Name>` | `app/Models/<Name>.ts` | ORM Model |
| `make:job <Name>` | `app/Jobs/<Name>.ts` | Queue Job |
| `make:middleware <Name>` | `app/Http/Middleware/<Name>Middleware.ts` | Middleware class |
| `make:request <Name>` | `app/Http/Requests/<Name>Request.ts` | FormRequest class |
| `make:provider <Name>` | `app/Providers/<Name>ServiceProvider.ts` | ServiceProvider |
| `make:command <Name>` | `app/Commands/<Name>.ts` | Rudder command class |
| `make:event <Name>` | `app/Events/<Name>.ts` | Event class |
| `make:listener <Name>` | `app/Listeners/<Name>.ts` | Event listener class |
| `make:mail <Name>` | `app/Mail/<Name>.ts` | Mailable class |
| `make:module <Name>` | `app/Modules/<Name>/` | Full module scaffold |

All `make:*` commands support `--force` to overwrite existing files.

### `module:*` Commands

| Command | Description |
|---------|-------------|
| `module:publish [module]` | Merge `*.prisma` shards from `app/Modules/` into `prisma/schema.prisma` |

`module:publish` options:
- `--generate` — run `prisma generate` after merging
- `--migrate` — run `prisma migrate dev` after merging
- `--name <name>` — migration name when using `--migrate` (default: `auto`)

### `vendor:publish`

Copies publishable assets (pages, config, migrations) declared by service providers into your application.

```bash
pnpm rudder vendor:publish                              # publish all available assets
pnpm rudder vendor:publish --list                       # list available assets without copying
pnpm rudder vendor:publish --tag=panels-pages           # publish by tag
pnpm rudder vendor:publish --provider=PanelServiceProvider  # publish by provider
pnpm rudder vendor:publish --tag=panels-pages --force   # overwrite existing files
```

Assets are declared by packages in their service provider's `boot()` method via `this.publishes()`. See `@rudderjs/core` for the `ServiceProvider` API.

### Database Commands

Laravel-style migration commands that delegate to the appropriate ORM tool. The CLI auto-detects which ORM is installed by checking `package.json` for `@rudderjs/orm-prisma` or `@rudderjs/orm-drizzle`.

| Command | Description | Prisma | Drizzle |
|---|---|---|---|
| `rudder migrate` | Run pending migrations | `prisma migrate dev` (dev) / `prisma migrate deploy` (prod) | `drizzle-kit migrate` |
| `rudder migrate:fresh` | Drop all + re-migrate | `prisma migrate reset --force` | `drizzle-kit migrate --force` |
| `rudder migrate:status` | Show migration status | `prisma migrate status` | `drizzle-kit check` |
| `rudder make:migration <name>` | Create new migration | `prisma migrate dev --create-only --name <name>` | `drizzle-kit generate --name <name>` |
| `rudder db:push` | Push schema directly (no migration file) | `prisma db push` | `drizzle-kit push` |
| `rudder db:generate` | Regenerate DB client | `prisma generate` | No-op (Drizzle schemas are TypeScript) |

### `route:list`

Lists all registered API routes (from `@rudderjs/router`) and Vike filesystem page routes.

### `command:list`

Show every command available in the project — CLI-owned, package-contributed, and user-defined. Useful for discoverability and for AI agents that need a structured view of what commands they can run.

```bash
pnpm rudder command:list                 # tabular output, user-defined only
pnpm rudder command:list --all           # include built-in + package commands
pnpm rudder command:list --all --json    # machine-readable; consumed by @rudderjs/boost's commands_list MCP tool
```

The `--json` shape carries name, description, args, options, and source for each command, plus a `bootError` field when the app fails to boot so consumers (Boost's MCP) get partial info instead of a crash.

### `providers:discover`

Scan installed `@rudderjs/*` packages and write `bootstrap/cache/providers.json` — the manifest that `defaultProviders()` reads at boot. Run after installing or removing any framework package; the scaffolder runs it automatically on `--install`.

```bash
pnpm rudder providers:discover
```

This command **skips `bootApp()`** (chicken-and-egg with the manifest) so it's fast and works even when the app can't boot.

### `model:prune`

Walk every Model registered with `ModelRegistry` that defines `static prunable()` and delete matching rows. Pairs with Passport's `MassPrunable` tokens and any app-defined prunable models.

```bash
pnpm rudder model:prune
```

Honors each model's `pruneMode`: `'instance'` (default) re-queries each chunk and fires `deleting`/`deleted` observers; `'mass'` (`MassPrunable`) runs `deleteAll()` per chunk — no observers, soft-deletes bypassed.

## `make:module` Scaffold

The `make:module Blog` command creates:

```
app/Modules/Blog/
├── BlogSchema.ts          # Zod input/output schemas and types
├── BlogService.ts         # @Injectable() service with CRUD stubs
├── BlogServiceProvider.ts # ServiceProvider — registers DI + REST routes
├── Blog.test.ts           # Basic schema validation tests
└── Blog.prisma            # Prisma model shard
```

It also auto-registers `BlogServiceProvider` in `bootstrap/providers.ts`.

After scaffolding, run `pnpm rudder module:publish --generate` to merge the Prisma shard and regenerate the client.

## Commands from other packages

The CLI is the runner — most commands are owned by the package that ships the feature. `loadPackageCommands()` eagerly imports command modules from each installed package via subpath exports, so they appear automatically in `--help` once the package is in `package.json`.

| Package | Commands |
|---|---|
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
| `@rudderjs/passport` | `passport:keys`, `passport:client`, `passport:purge` |
| `@rudderjs/terminal` | `make:terminal` |

CLI-owned commands stay focused on scaffolding (`make:*`, `module:*`, `vendor:publish`) and process meta (`command:list`, `providers:discover`).

## User-Defined Commands

Commands defined in `routes/console.ts` are auto-registered:

```ts
import { rudder } from '@rudderjs/core'

rudder.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com' })
}).description('Seed the database')
```

Class-based commands:

```ts
import { Command, rudder } from '@rudderjs/core'

class SeedCommand extends Command {
  readonly signature = 'db:seed {--count=10}'
  readonly description = 'Seed the database'

  async handle() {
    const count = Number(this.option('count') ?? 10)
    this.info(`Seeding ${count} records...`)
    // ...
  }
}

rudder.register(SeedCommand)
```

## Notes

- The CLI must be run from (or below) a directory containing `bootstrap/app.ts`
- All `make:*` generators use `--force` to overwrite existing files
- `make:controller` appends `Controller` suffix if missing; `make:middleware` appends `Middleware`; `make:request` appends `Request`; `make:provider` appends `ServiceProvider`
- `module:publish` uses `// <rudderjs:modules:start>` / `// <rudderjs:modules:end>` markers to replace previously merged content
- Built with [Commander.js](https://github.com/tj/commander.js) and [@clack/prompts](https://github.com/bombshell-dev/clack)
