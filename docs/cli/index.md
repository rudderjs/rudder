# BoostKit CLI

The BoostKit CLI (`@boostkit/cli`) provides code generators and artisan command dispatch. It is the bridge between the terminal and your BoostKit application.

## Installation

The CLI is included when you scaffold a project with `create-boostkit-app`. For manual setup:

```bash
pnpm add -D @boostkit/cli
```

Add the `artisan` script to `package.json`:

```json
{
  "scripts": {
    "artisan": "node node_modules/@boostkit/cli/dist/index.js"
  }
}
```

## Running the CLI

```bash
pnpm artisan --help         # Show all available commands
pnpm artisan <command>      # Run a command
pnpm artisan <command> -h   # Command-specific help
```

**Important**: The CLI must be run from a directory containing `bootstrap/app.ts`. It boots the BoostKit application (calling `boostkit.boot()`) before dispatching commands, which means all service providers are active — database connections, DI bindings, and configuration are all available.

## How It Works

When you run `pnpm artisan <command>`:

1. The CLI locates `bootstrap/app.ts` by walking up from the current directory
2. It calls `boostkit.boot()` — boots all service providers (DB connects, bindings register)
3. Route loaders for `commands` are executed, which calls `artisan.command(...)` in `routes/console.ts`
4. The CLI dispatches the matching command with parsed arguments

This means your custom commands in `routes/console.ts` have full access to the DI container and ORM.

## Command Categories

| Category | Commands | Description |
|----------|----------|-------------|
| Generators | `make:*` | Scaffold files from templates |
| Modules | `module:*` | Create and publish module shards |
| Database | `migrate`, `migrate:*`, `db:*` | Migrations and schema management |
| Routes | `route:list` | List all registered routes |
| Queue | `queue:work` | Start the queue worker |
| Schedule | `schedule:run`, `schedule:work`, `schedule:list` | Task scheduling |
| Custom | user-defined | Defined in `routes/console.ts` |

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

## Database Commands

BoostKit provides unified artisan commands for database migrations and schema management. These commands auto-detect whether your project uses Prisma or Drizzle and delegate to the appropriate tool.

| Command | Description |
|---------|-------------|
| `pnpm artisan migrate` | Run all pending migrations |
| `pnpm artisan migrate:fresh` | Drop all tables and re-run all migrations from scratch |
| `pnpm artisan migrate:status` | Show which migrations have been applied and which are pending |
| `pnpm artisan make:migration <name>` | Create a new migration file |
| `pnpm artisan db:push` | Push the schema directly to the database (no migration file) |
| `pnpm artisan db:generate` | Regenerate the ORM client (Prisma only, no-op for Drizzle) |

### Prisma / Drizzle Equivalents

| Artisan Command | Prisma Equivalent | Drizzle Equivalent |
|---|---|---|
| `migrate` | `prisma migrate deploy` | `drizzle-kit migrate` |
| `migrate:fresh` | `prisma migrate reset` | drop all + `drizzle-kit migrate` |
| `migrate:status` | `prisma migrate status` | `drizzle-kit status` |
| `make:migration <name>` | `prisma migrate dev --name <name>` | `drizzle-kit generate` |
| `db:push` | `prisma db push` | `drizzle-kit push` |
| `db:generate` | `prisma generate` | *(no-op)* |

### Usage

```bash
# Development — quick schema sync
pnpm artisan db:push

# Development — create a tracked migration
pnpm artisan make:migration add_status_to_posts

# Production — apply pending migrations
pnpm artisan migrate

# Check migration status
pnpm artisan migrate:status

# Reset everything (development only)
pnpm artisan migrate:fresh

# Regenerate client after schema changes (Prisma)
pnpm artisan db:generate
```

## Available Commands Reference

See the [make: Commands](/cli/make-commands) and [module: Commands](/cli/module-commands) pages for detailed documentation.
