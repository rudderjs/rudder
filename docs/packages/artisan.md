# @boostkit/artisan

Command registry and base class for defining and running Artisan commands.

## Installation

```bash
pnpm add @boostkit/artisan
```

## Quick Start

Use the `artisan` singleton to define inline commands in `routes/console.ts`:

```ts
// routes/console.ts
import { artisan } from '@boostkit/artisan'

artisan.command('greet {name}', async (cmd) => {
  const name = cmd.argument('name')
  cmd.info(`Hello, ${name}!`)
}).description('Greet a user by name')

artisan.command('db:seed', async (cmd) => {
  cmd.line('Seeding database...')
  await User.create({ name: 'Alice', email: 'alice@example.com' })
  cmd.info('Done.')
}).description('Seed the database with initial data')
```

Run from the playground directory:

```bash
pnpm artisan greet Alice
pnpm artisan db:seed
```

## Class-Based Commands

For complex commands, extend the `Command` base class:

```ts
// app/Commands/SendDigestCommand.ts
import { Command } from '@boostkit/artisan'

export class SendDigestCommand extends Command {
  signature    = 'mail:digest {--dry-run} {--type=weekly}'
  description  = 'Send the email digest to all subscribers'

  async handle(): Promise<void> {
    const isDry  = this.option('dry-run') as boolean
    const type   = this.option('type') as string

    this.info(`Sending ${type} digest${isDry ? ' (dry run)' : ''}...`)

    const users = await User.all()

    this.table(
      users.map((u) => [u.name, u.email]),
      ['Name', 'Email'],
    )

    if (!isDry) {
      for (const user of users) {
        await mail().send(new DigestMailable(user, type))
      }
    }

    this.info(`Done. Processed ${users.length} subscriber(s).`)
  }
}
```

Register a class-based command with `artisan.register()`:

```ts
// routes/console.ts
import { artisan } from '@boostkit/artisan'
import { SendDigestCommand } from '../app/Commands/SendDigestCommand.js'

artisan.register(SendDigestCommand)
```

## Signature Syntax

Signatures follow Laravel's argument/option syntax. `parseSignature(signature)` parses a signature string into a structured definition.

| Syntax | Type | Description |
|---|---|---|
| `{name}` | Argument | Required positional argument |
| `{name?}` | Argument | Optional positional argument |
| `{name*}` | Argument | Variadic argument (array of values) |
| `{name=default}` | Argument | Optional argument with a default value |
| `{--flag}` | Option | Boolean flag (present = `true`) |
| `{--N\|name}` | Option | Boolean flag with a short alias (`-N`) |
| `{--name=}` | Option | Option that accepts a value |
| `{--name=default}` | Option | Option with a value and a default |

Examples:

```ts
// Required argument + option with default
'make:model {name} {--table=}'

// Multiple arguments + boolean flag
'import:users {file} {--dry-run} {--force}'

// Variadic + short alias
'notify {users*} {--C|channel=mail}'
```

## `Command` Base Class API

When extending `Command`, the following methods are available inside `handle()`:

### Reading Input

| Method | Description |
|---|---|
| `argument(name)` | Returns the value of a named positional argument |
| `arguments()` | Returns all argument values as a `Record<string, unknown>` |
| `option(name)` | Returns the value of a named option |
| `options()` | Returns all option values as a `Record<string, unknown>` |

### Output Helpers

All output helpers write to stdout with ANSI color formatting:

| Method | Color | Description |
|---|---|---|
| `info(msg)` | Green | Informational success message |
| `error(msg)` | Red | Error message |
| `warn(msg)` | Yellow | Warning message |
| `line(msg)` | Default | Plain output line |
| `table(rows, headers?)` | — | Renders a formatted ASCII table |

Example:

```ts
this.info('Migration complete.')
this.warn('No users found — skipping seed.')
this.error('Database connection failed.')
this.table(
  [['Alice', 'alice@example.com'], ['Bob', 'bob@example.com']],
  ['Name', 'Email'],
)
```

## `ArtisanRegistry` API

The `artisan` singleton is an instance of `ArtisanRegistry`. It is stored on `globalThis.__forge_artisan__` so that a single registry is shared across all package boundaries.

| Method | Description |
|---|---|
| `artisan.command(signature, handler)` | Register an inline command; returns a fluent builder with `.description(text)` |
| `artisan.register(CommandClass)` | Register a class-based command that extends `Command` |
| `artisan.run(argv)` | Parse and execute a command from an argv array (used by the CLI entry point) |
| `artisan.commands()` | Returns an array of all registered command definitions |

## `parseSignature(signature)`

Low-level utility that parses a signature string into structured argument and option definitions:

```ts
import { parseSignature } from '@boostkit/artisan'

const parsed = parseSignature('make:model {name} {--table=users}')
// {
//   name: 'make:model',
//   arguments: [{ name: 'name', required: true, variadic: false }],
//   options:   [{ name: 'table', alias: null, acceptsValue: true, default: 'users' }],
// }
```

## Notes

- The `artisan` singleton is stored on `globalThis.__forge_artisan__` — it is shared across all imports regardless of how many times `@boostkit/artisan` is required, preventing duplicate registries across package boundaries.
- `parseSignature` supports the full set of Laravel-style argument and option syntaxes described in the table above. Short aliases (`{--N|name}`) are single-character only.
- Command output helpers (`info`, `error`, `warn`, `line`) use ANSI escape codes for color. Colors are applied unconditionally — redirect output to a file if you need plain text.
- The Forge CLI (`@boostkit/cli`) loads `bootstrap/app.ts` and calls `forge.boot()` before `program.parse()`, so providers (including the database) are fully initialized when any artisan command runs.
- Commands must be registered before `artisan.run()` is called. Commands in `routes/console.ts` are loaded by the CLI via the `withRouting({ commands })` loader in `bootstrap/app.ts`.
