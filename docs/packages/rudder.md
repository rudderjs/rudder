# @rudderjs/rudder

Command registry and base class for defining and running Rudder commands.

## Installation

```bash
pnpm add @rudderjs/rudder
```

## Quick Start

Use the `rudder` singleton to define inline commands in `routes/console.ts`:

```ts
// routes/console.ts
import { rudder } from '@rudderjs/rudder'

rudder.command('greet {name}', async (args, opts) => {
  console.log(`Hello, ${args[0]}!`)
}).description('Greet a user by name')

rudder.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com' })
  console.log('Done.')
}).description('Seed the database with initial data')
```

Run from your project directory:

```bash
pnpm rudder greet Alice
pnpm rudder db:seed
```

## Class-Based Commands

For complex commands with typed input, output helpers, and interactive prompts, extend `Command`:

```ts
// app/Commands/SendDigestCommand.ts
import { Command } from '@rudderjs/rudder'

export class SendDigestCommand extends Command {
  readonly signature   = 'mail:digest {--dry-run} {--type=weekly}'
  readonly description = 'Send the email digest to all subscribers'

  async handle(): Promise<void> {
    const isDry = this.option('dry-run') as boolean
    const type  = this.option('type') as string

    this.info(`Sending ${type} digest${isDry ? ' (dry run)' : ''}...`)

    const users = await User.all()

    this.table(
      ['Name', 'Email'],
      users.map(u => [u.name, u.email]),
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

Register it with `rudder.register()`:

```ts
// routes/console.ts
import { rudder } from '@rudderjs/rudder'
import { SendDigestCommand } from '../app/Commands/SendDigestCommand.js'

rudder.register(SendDigestCommand)
```

## Signature Syntax

Signatures follow Laravel's argument/option DSL. `parseSignature(signature)` parses them into structured definitions.

| Syntax | Type | Description |
|---|---|---|
| `{name}` | Argument | Required positional argument |
| `{name?}` | Argument | Optional positional argument |
| `{name*}` | Argument | Variadic argument (zero or more values) |
| `{name=default}` | Argument | Optional argument with a default value |
| `{--flag}` | Option | Boolean flag (present = `true`) |
| `{--N\|name}` | Option | Boolean flag with a short alias (`-N`) |
| `{--name=}` | Option | Option that accepts a value |
| `{--name=default}` | Option | Option with a value and a default |
| `{arg : description}` | Any | Inline description (stripped at parse time) |

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

| Method | Returns | Description |
|---|---|---|
| `argument(name)` | `string` | Named positional argument (`''` if missing) |
| `arguments()` | `Record<string, unknown>` | All arguments as a shallow copy |
| `option(name)` | `string \| boolean \| undefined` | Named option value |
| `options()` | `Record<string, unknown>` | All options as a shallow copy |

### Output Helpers

| Method | Color | Description |
|---|---|---|
| `info(msg)` | Green | Success / informational message |
| `error(msg)` | Red | Error message |
| `warn(msg)` | Yellow | Warning message |
| `line(msg?)` | Default | Plain output line (defaults to empty) |
| `comment(msg)` | Dim/grey | Secondary / less prominent message |
| `newLine(count?)` | — | Print one or more blank lines (default 1) |
| `table(headers, rows)` | — | Render a formatted ASCII table |

```ts
this.info('Migration complete.')
this.warn('No users found — skipping seed.')
this.error('Database connection failed.')
this.comment('This may take a while...')
this.newLine()
this.table(
  ['Name', 'Email'],
  [['Alice', 'alice@example.com'], ['Bob', 'bob@example.com']],
)
```

### Interactive Prompts

All prompt methods are async and throw `CancelledError` if the user presses Ctrl+C.

| Method | Returns | Description |
|---|---|---|
| `ask(message, default?)` | `Promise<string>` | Free-text input |
| `confirm(message, default?)` | `Promise<boolean>` | Yes/no confirmation (default: `false`) |
| `choice(message, choices, default?)` | `Promise<string>` | Selection list |
| `secret(message)` | `Promise<string>` | Hidden input (password) |

```ts
import { CancelledError } from '@rudderjs/rudder'

async handle() {
  try {
    const name = await this.ask('What is your name?', 'World')
    const ok   = await this.confirm('Are you sure?')
    const env  = await this.choice('Select environment', ['local', 'staging', 'production'])
    const pass = await this.secret('Enter password')
  } catch (err) {
    if (err instanceof CancelledError) {
      this.warn('Command cancelled.')
      return
    }
    throw err
  }
}
```

## `CancelledError`

Thrown when the user cancels an interactive prompt (Ctrl+C). Import it to handle gracefully:

```ts
import { CancelledError } from '@rudderjs/rudder'
```

## `CommandRegistry` API

The `rudder` singleton is an instance of `CommandRegistry`, stored on `globalThis.__rudderjs_rudder__` so a single registry is shared across all package boundaries.

| Method | Description |
|---|---|
| `rudder.command(name, handler)` | Register an inline command; returns a `CommandBuilder` with `.description(text)` / `.purpose(text)` |
| `rudder.register(...Classes)` | Register one or more class-based commands extending `Command` |
| `rudder.getCommands()` | Returns all registered `CommandBuilder` instances |
| `rudder.getClasses()` | Returns all registered class constructors |
| `rudder.reset()` | Clears all registrations (useful in tests) |

## `parseSignature(signature)`

Low-level utility that parses a signature string into structured argument and option definitions. Throws if the signature does not start with a valid command name.

```ts
import { parseSignature } from '@rudderjs/rudder'

const parsed = parseSignature('make:model {name} {--table=users}')
// {
//   name: 'make:model',
//   args: [{ name: 'name', required: true, variadic: false }],
//   opts: [{ name: 'table', hasValue: true, defaultValue: 'users' }],
// }
```

**Return type:**

```ts
interface ParsedSignature {
  name: string
  args: CommandArgDef[]
  opts: CommandOptDef[]
}

interface CommandArgDef {
  name: string
  required: boolean
  variadic: boolean
  defaultValue?: string
}

interface CommandOptDef {
  name: string
  shorthand?: string
  hasValue: boolean
  defaultValue?: string
}
```

## Notes

- The `rudder` singleton is stored on `globalThis.__rudderjs_rudder__` — it is shared across all imports regardless of how many times `@rudderjs/rudder` is loaded, preventing duplicate registries.
- `parseSignature` throws if the signature string does not start with a valid command name (letters, digits, `:`, `.`, `-`).
- `@clack/prompts` is loaded lazily — it is only imported on the first interactive prompt call.
- Prompt cancellation throws `CancelledError` instead of calling `process.exit()` — catch it to handle gracefully.
- `table(headers, rows)` pads short rows with empty strings to match the header column count.
- The RudderJS CLI (`@rudderjs/cli`) loads `bootstrap/app.ts` and boots all providers before dispatching commands, so the database and other services are available inside `handle()`.
