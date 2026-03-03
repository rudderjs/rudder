# Forge CLI

The Forge CLI (`@boostkit/cli`) provides code generators and artisan command dispatch. It is the bridge between the terminal and your Forge application.

## Installation

The CLI is included when you scaffold a project with `create-boostkit-app`. For manual setup:

```bash
pnpm add -D @boostkit/cli
```

Add the `artisan` script to `package.json`:

```json
{
  "scripts": {
    "artisan": "tsx node_modules/@boostkit/cli/src/index.ts"
  }
}
```

## Running the CLI

```bash
pnpm artisan --help         # Show all available commands
pnpm artisan <command>      # Run a command
pnpm artisan <command> -h   # Command-specific help
```

**Important**: The CLI must be run from a directory containing `bootstrap/app.ts`. It boots the Forge application (calling `forge.boot()`) before dispatching commands, which means all service providers are active — database connections, DI bindings, and configuration are all available.

## How It Works

When you run `pnpm artisan <command>`:

1. The CLI imports `bootstrap/app.ts` from the current working directory
2. It calls `forge.boot()` — boots all service providers (DB connects, bindings register)
3. Route loaders for `commands` are executed, which calls `artisan.command(...)` in `routes/console.ts`
4. The CLI dispatches the matching command with parsed arguments

This means your custom commands in `routes/console.ts` have full access to the DI container and ORM.

## Command Categories

| Category | Commands | Description |
|----------|----------|-------------|
| Generators | `make:*` | Scaffold files from templates |
| Modules | `module:*` | Create and publish module shards |
| Database | `db:seed` | User-defined in `routes/console.ts` |
| Queue | `queue:work` | Start the queue worker |
| Schedule | `schedule:run`, `schedule:work`, `schedule:list` | Task scheduling |
| Storage | `storage:link` | Create public storage symlink |

## Defining Custom Commands

In `routes/console.ts`:

```ts
import { artisan } from '@boostkit/artisan'

artisan.command('hello {name}', async (args) => {
  console.log(`Hello, ${args.name}!`)
}).description('Print a greeting')
```

Or extend `Command` for more complex commands. See the [Artisan guide](/guide/artisan) for details.

## The `--force` Flag

All `make:*` generators support `--force` to overwrite existing files:

```bash
pnpm artisan make:model Post --force
```

## Available Commands Reference

See the [make: Commands](/cli/make-commands) and [module: Commands](/cli/module-commands) pages for detailed documentation.
