# Artisan Console

Forge's Artisan CLI lets you run commands from the terminal. It works similarly to Laravel's Artisan — you define commands in `routes/console.ts` and run them with `pnpm artisan`.

## Running Commands

```bash
pnpm artisan --help          # List all available commands
pnpm artisan db:seed         # Run a specific command
pnpm artisan make:model Post # Generate a model stub
```

In the playground (or any project that uses `@boostkit/cli`):

```bash
cd my-app
pnpm artisan <command>
```

The CLI **must be run from a directory containing `bootstrap/app.ts`** — it loads the application (via `forge.boot()`) before running commands, so providers and services are available.

## Defining Commands (Console Routes)

Register commands in `routes/console.ts` using the `artisan` singleton:

```ts
import { artisan } from '@boostkit/artisan'

artisan.command('db:seed', async () => {
  const { User } = await import('../app/Models/User.js')
  await User.create({ name: 'Alice', email: 'alice@example.com' })
  console.log('Seeded users.')
}).description('Seed the database with sample data')
```

Inline commands accept an optional argument signature as the first argument:

```ts
artisan.command('greet {name}', async (args) => {
  console.log(`Hello, ${args.name}!`)
}).description('Greet a user by name')
```

## Class-Based Commands

For more complex commands with output helpers and option parsing, extend `Command`:

```ts
import { Command } from '@boostkit/core'
import { User } from '../app/Models/User.js'

export class SeedCommand extends Command {
  readonly signature = 'db:seed {--count=10 : Number of users to seed}'
  readonly description = 'Seed the database with sample users'

  async handle(): Promise<void> {
    const count = Number(this.option('count') ?? 10)
    this.info(`Seeding ${count} users...`)

    for (let i = 0; i < count; i++) {
      await User.create({ name: `User ${i}`, email: `user${i}@example.com` })
    }

    this.info('Done!')
  }
}
```

Register it:

```ts
import { artisan } from '@boostkit/artisan'
import { SeedCommand } from '../app/Commands/SeedCommand.js'

artisan.register(SeedCommand)
```

## Command Signature Syntax

Signatures use a Laravel-inspired format:

| Syntax | Description |
|--------|-------------|
| `{name}` | Required argument |
| `{name?}` | Optional argument |
| `{name*}` | Variadic argument (array) |
| `{name=default}` | Argument with default value |
| `{--flag}` | Boolean flag (`--flag` / `--no-flag`) |
| `{--N\|name}` | Flag with shorthand (`-N` / `--name`) |
| `{--name=}` | Option that accepts a value |
| `{--name=default}` | Option with default value |

Examples:

```ts
readonly signature = 'import:users {file} {--dry-run} {--limit=100}'
```

```bash
pnpm artisan import:users users.csv --dry-run --limit=50
```

## Command Output Helpers

The `Command` base class provides styled output helpers:

```ts
this.info('Starting...')       // ✅ green info text
this.error('Failed!')          // ❌ red error text
this.warn('Skipping row 5')    // ⚠ yellow warning
this.line('Plain output')      // plain text
this.table(rows, headers)      // formatted table
```

## Accessing Arguments and Options

Inside `handle()`:

```ts
const name    = this.argument('name')        // required/optional arg
const count   = this.option('count')         // option value
const isDry   = this.option('dry-run')       // boolean flag
const allArgs = this.arguments()             // all args as object
const allOpts = this.options()               // all options as object
```

## Provider-Registered Commands

Package providers can register commands automatically. For example:

- `queue()` → `queue:work`
- `storage()` → `storage:link`
- `scheduler()` → `schedule:run`, `schedule:work`, `schedule:list`

These appear in `pnpm artisan --help` once the provider is registered.

## Scheduling Commands

Use `@boostkit/schedule` to run artisan commands on a cron schedule:

```ts
import { schedule } from '@boostkit/schedule'

schedule.command('db:sync').daily().description('Sync data daily')
schedule.call(async () => {
  await cleanupTempFiles()
}).everyFiveMinutes()
```

Then run the scheduler with:

```bash
pnpm artisan schedule:work    # long-running process
pnpm artisan schedule:run     # run due tasks once (for cron-triggered)
pnpm artisan schedule:list    # list all scheduled tasks
```

## Generating Commands

```bash
pnpm artisan make:middleware Auth
# No dedicated make:command yet — define in routes/console.ts or extend Command manually
```

## Notes

- `artisan` singleton is stored on `globalThis.__forge_artisan__` — safe to import from multiple packages
- Commands registered in `routes/console.ts` are loaded during `forge.boot()` before `program.parse()`
- The CLI is a separate package (`@boostkit/cli`) — it orchestrates boot and command dispatch
- Use `--force` with `make:*` commands to overwrite existing files
