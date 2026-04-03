# Rudder Console

RudderJS's Rudder CLI lets you run commands from the terminal. It works similarly to Laravel's Rudder — you define commands in `routes/console.ts` and run them with `pnpm rudder`.

## Running Commands

```bash
pnpm rudder --help          # List all available commands
pnpm rudder db:seed         # Run a specific command
pnpm rudder make:model Post # Generate a model stub
```

The CLI **must be run from a directory containing `bootstrap/app.ts`** — it boots the full application before running commands, so providers and services are available.

## Defining Commands (Console Routes)

Register commands in `routes/console.ts` using the `rudder` singleton:

```ts
import { rudder } from '@rudderjs/rudder'

rudder.command('db:seed', async () => {
  const { User } = await import('../app/Models/User.js')
  await User.create({ name: 'Alice', email: 'alice@example.com' })
  console.log('Seeded users.')
}).description('Seed the database with sample data')
```

Inline command handlers receive positional args as `string[]` and options as a `Record<string, unknown>`:

```ts
rudder.command('greet {name}', async (args, opts) => {
  console.log(`Hello, ${args[0]}!`)
}).description('Greet a user by name')
```

## Class-Based Commands

For complex commands with typed input, output helpers, and interactive prompts, extend `Command`:

```ts
import { Command } from '@rudderjs/core'
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
import { rudder } from '@rudderjs/rudder'
import { SeedCommand } from '../app/Commands/SeedCommand.js'

rudder.register(SeedCommand)
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
pnpm rudder import:users users.csv --dry-run --limit=50
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
import { CancelledError } from '@rudderjs/rudder'

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

These appear in `pnpm rudder --help` once the provider is registered in `bootstrap/providers.ts`.

## Scheduling Commands

Use `@rudderjs/schedule` to run rudder commands on a cron schedule:

```ts
import { schedule } from '@rudderjs/schedule'

schedule.command('db:sync').daily().description('Sync data daily')
schedule.call(async () => {
  await cleanupTempFiles()
}).everyFiveMinutes()
```

```bash
pnpm rudder schedule:work    # long-running process
pnpm rudder schedule:run     # run due tasks once (for external cron)
pnpm rudder schedule:list    # list all scheduled tasks
```

## Generating Commands

```bash
pnpm rudder make:middleware Auth
# No dedicated make:command yet — extend Command manually and register in routes/console.ts
```

## Notes

- `rudder` singleton is stored on `globalThis.__rudderjs_rudder__` — safe to import from multiple packages without duplicate registries
- Commands registered in `routes/console.ts` are loaded during boot before any command runs
- The CLI is a separate package (`@rudderjs/cli`) — it orchestrates boot and command dispatch
- Use `--force` with `make:*` commands to overwrite existing files
