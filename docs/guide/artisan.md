# Artisan Console

BoostKit's Artisan CLI lets you run commands from the terminal. It works similarly to Laravel's Artisan — you define commands in `routes/console.ts` and run them with `pnpm artisan`.

## Running Commands

```bash
pnpm artisan --help          # List all available commands
pnpm artisan db:seed         # Run a specific command
pnpm artisan make:model Post # Generate a model stub
```

The CLI **must be run from a directory containing `bootstrap/app.ts`** — it boots the full application before running commands, so providers and services are available.

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

Inline command handlers receive positional args as `string[]` and options as a `Record<string, unknown>`:

```ts
artisan.command('greet {name}', async (args, opts) => {
  console.log(`Hello, ${args[0]}!`)
}).description('Greet a user by name')
```

## Class-Based Commands

For complex commands with typed input, output helpers, and interactive prompts, extend `Command`:

```ts
import { Command } from '@boostkit/core'
import { User } from '../app/Models/User.js'

export class SeedCommand extends Command {
  readonly signature   = 'db:seed {--count=10 : Number of users to seed}'
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
| `{--flag}` | Boolean flag |
| `{--N\|name}` | Flag with shorthand (`-N`) |
| `{--name=}` | Option that accepts a value |
| `{--name=default}` | Option with default value |
| `{arg : description}` | Inline description (shown in `--help`) |

```ts
readonly signature = 'import:users {file} {--dry-run} {--limit=100}'
```

```bash
pnpm artisan import:users users.csv --dry-run --limit=50
```

## Command Output Helpers

The `Command` base class provides styled output helpers:

```ts
this.info('Starting...')        // green — success / info
this.error('Failed!')           // red — error
this.warn('Skipping row 5')     // yellow — warning
this.line('Plain output')       // unstyled
this.comment('Takes a moment')  // dim/grey — secondary info
this.newLine()                  // blank line
this.table(
  ['Name', 'Email'],
  [['Alice', 'alice@example.com'], ['Bob', 'bob@example.com']],
)
```

## Accessing Arguments and Options

Inside `handle()`:

```ts
const name    = this.argument('name')    // named argument ('' if missing)
const count   = this.option('count')     // option value
const isDry   = this.option('dry-run')   // boolean flag
const allArgs = this.arguments()         // all args as object
const allOpts = this.options()           // all options as object
```

## Interactive Prompts

Class-based commands can prompt the user interactively. All methods throw `CancelledError` on Ctrl+C:

```ts
import { CancelledError } from '@boostkit/artisan'

async handle() {
  try {
    const name = await this.ask('What is your name?', 'World')
    const ok   = await this.confirm('Continue?')
    const env  = await this.choice('Environment', ['local', 'staging', 'production'])
    const pass = await this.secret('Password')
  } catch (err) {
    if (err instanceof CancelledError) {
      this.warn('Cancelled.')
      return
    }
    throw err
  }
}
```

| Method | Description |
|--------|-------------|
| `ask(message, default?)` | Free-text input |
| `confirm(message, default?)` | Yes/no (default: `false`) |
| `choice(message, choices, default?)` | Selection list |
| `secret(message)` | Hidden input (password) |

## Provider-Registered Commands

Package providers can register commands automatically. For example:

- `queue()` provider → `queue:work`
- `storage()` provider → `storage:link`
- `scheduler()` provider → `schedule:run`, `schedule:work`, `schedule:list`

These appear in `pnpm artisan --help` once the provider is registered in `bootstrap/providers.ts`.

## Scheduling Commands

Use core scheduling to run artisan commands on a cron schedule:

```ts
import { schedule } from '@boostkit/core'

schedule.command('db:sync').daily().description('Sync data daily')
schedule.call(async () => {
  await cleanupTempFiles()
}).everyFiveMinutes()
```

```bash
pnpm artisan schedule:work    # long-running process
pnpm artisan schedule:run     # run due tasks once (for external cron)
pnpm artisan schedule:list    # list all scheduled tasks
```

## Generating Commands

```bash
pnpm artisan make:middleware Auth
# No dedicated make:command yet — extend Command manually and register in routes/console.ts
```

## Notes

- `artisan` singleton is stored on `globalThis.__boostkit_artisan__` — safe to import from multiple packages without duplicate registries
- Commands registered in `routes/console.ts` are loaded during boot before any command runs
- The CLI is a separate package (`@boostkit/cli`) — it orchestrates boot and command dispatch
- Use `--force` with `make:*` commands to overwrite existing files
