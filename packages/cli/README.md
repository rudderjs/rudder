# @boostkit/cli

BoostKit CLI — code generators, module scaffolding, and artisan command dispatch.

## Installation

The CLI is automatically included when you scaffold a project with `create-boostkit-app`. For manual setup:

```bash
pnpm add -D @boostkit/cli
```

Add to `package.json`:

```json
{
  "scripts": {
    "artisan": "tsx node_modules/@boostkit/cli/src/index.ts"
  }
}
```

## Usage

```bash
pnpm artisan --help               # List all commands
pnpm artisan make:controller User # Generate a controller
pnpm artisan db:seed              # Run a user-defined command
```

**Must be run from a directory containing `bootstrap/app.ts`**. The CLI boots the BoostKit application (`forge.boot()`) before dispatching commands — all service providers, DI bindings, and database connections are available.

## How It Works

1. The CLI imports `bootstrap/app.ts` from the current working directory
2. It calls `forge.boot()` — boots all service providers
3. Route loaders for `commands` are executed (registers commands from `routes/console.ts`)
4. The CLI dispatches the matching command with parsed arguments and options

## Built-in Commands

### `make:*` Generators

| Command | Output | Description |
|---------|--------|-------------|
| `make:controller <Name>` | `app/Http/Controllers/<Name>Controller.ts` | Decorator-based controller |
| `make:model <Name>` | `app/Models/<Name>.ts` | ORM Model |
| `make:job <Name>` | `app/Jobs/<Name>Job.ts` | Queue Job |
| `make:middleware <Name>` | `app/Http/Middleware/<Name>Middleware.ts` | Middleware class |
| `make:request <Name>` | `app/Http/Requests/<Name>Request.ts` | FormRequest class |
| `make:provider <Name>` | `app/Providers/<Name>ServiceProvider.ts` | ServiceProvider |
| `make:module <Name>` | Full module scaffold | Models, services, providers, controller, Prisma shard |

All `make:*` commands support `--force` to overwrite existing files.

### `module:*` Commands

| Command | Description |
|---------|-------------|
| `module:publish` | Merge all `app/**/schema.prisma` shards into `prisma/schema.prisma` |

## User-Defined Commands

Commands defined in `routes/console.ts` are auto-registered:

```ts
import { artisan } from '@boostkit/core'

artisan.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com' })
}).description('Seed the database')
```

Class-based commands:

```ts
import { Command, artisan } from '@boostkit/core'

class SeedCommand extends Command {
  readonly signature = 'db:seed {--count=10}'
  readonly description = 'Seed the database'

  async handle() {
    const count = Number(this.option('count') ?? 10)
    this.info(`Seeding ${count} records...`)
    // ...
  }
}

artisan.register(SeedCommand)
```

## Configuration

This package has no runtime config object.

## Notes

- The CLI must be run from a directory containing `bootstrap/app.ts`
- Commands are not available at the repo root — always run from the app directory
- Built with [Commander.js](https://github.com/tj/commander.js) and [cfonts](https://github.com/dominikwilkowski/cfonts) for the banner
- `--force` flag is supported by all `make:*` generators
