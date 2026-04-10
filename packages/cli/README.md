# @rudderjs/cli

RudderJS CLI — code generators, module scaffolding, and rudder command dispatch.

## Installation

The CLI is automatically included when you scaffold a project with `create-rudder-app`. For manual setup:

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
