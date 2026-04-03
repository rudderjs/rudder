# @rudderjs/rudder

Command registry and class-based command primitives for the RudderJS CLI.

## Installation

```bash
pnpm add @rudderjs/rudder
```

## Quick Start

```ts
import { Rudder, Command } from '@rudderjs/rudder'

// Functional command
Rudder.command('greet {name}', (args) => {
  console.log(`Hello, ${args[0]}!`)
}).description('Print a greeting')

// Class-based command
class PingCommand extends Command {
  readonly signature   = 'ping {--N|name=world}'
  readonly description = 'Ping with an optional name'

  handle() {
    this.info(`Pong, ${String(this.option('name'))}!`)
  }
}

Rudder.register(PingCommand)
```

---

## Signature Grammar

Command signatures describe arguments and options in a Laravel-style DSL:

```
<name> {arg} {arg?} {arg=default} {arg*} {--flag} {--opt=} {--opt=default} {--S|shorthand=}
```

| Syntax            | Meaning                              |
|-------------------|--------------------------------------|
| `{name}`          | Required positional argument         |
| `{name?}`         | Optional positional argument         |
| `{name=default}`  | Optional with a default value        |
| `{files*}`        | Variadic (zero or more values)       |
| `{--force}`       | Boolean flag (no value)              |
| `{--env=}`        | Option that accepts a value          |
| `{--env=local}`   | Option with a default value          |
| `{--N\|name=}`    | Option with a shorthand `-N`         |
| `{arg : desc}`    | Inline description (stripped at parse) |

---

## API Reference

### `rudder` / `Rudder`

Global singleton registry (both names refer to the same instance):

```ts
import { rudder, Rudder } from '@rudderjs/rudder'
```

#### `Rudder.command(name, handler)`

Registers a functional command. Returns a `CommandBuilder` for chaining.

```ts
Rudder.command('db:seed {table?}', async (args, opts) => {
  // args: string[]  (positional values in order)
  // opts: Record<string, unknown>
}).description('Seed the database')
```

#### `Rudder.register(...CommandClasses)`

Registers one or more class-based `Command` subclasses.

```ts
Rudder.register(MigrateCommand, SeedCommand)
```

#### `Rudder.reset()`

Clears all registered commands and classes. Useful in tests.

#### `Rudder.getCommands()` / `Rudder.getClasses()`

Returns the internal arrays (used by `@rudderjs/cli` to discover commands).

---

### `CommandBuilder`

Returned by `Rudder.command()`. Supports fluent chaining:

```ts
Rudder.command('migrate', handler)
  .description('Run database migrations')  // or .purpose(...)
```

| Method                | Description                          |
|-----------------------|--------------------------------------|
| `.description(text)`  | Set the command description          |
| `.purpose(text)`      | Alias for `.description()`           |
| `.getDescription()`   | Read the current description string  |

---

### `Command` (abstract class)

Extend this for class-based commands:

```ts
class MyCommand extends Command {
  readonly signature   = 'my:cmd {name} {--force}'
  readonly description = 'Does something useful'

  async handle() {
    const name  = this.argument('name')
    const force = this.option('force')
    this.info(`Running for ${name}${force ? ' (forced)' : ''}`)
  }
}
```

#### Argument / option accessors

| Method              | Returns                          | Description                          |
|---------------------|----------------------------------|--------------------------------------|
| `argument(name)`    | `string`                         | Named positional argument ('' if missing) |
| `arguments()`       | `Record<string, unknown>`        | All arguments as a shallow copy      |
| `option(name)`      | `string \| boolean \| undefined` | Named option value                   |
| `options()`         | `Record<string, unknown>`        | All options as a shallow copy        |

#### Output helpers

| Method              | Output style         | Console method   |
|---------------------|----------------------|------------------|
| `info(message)`     | Green text           | `console.log`    |
| `error(message)`    | Red text             | `console.error`  |
| `warn(message)`     | Yellow text          | `console.warn`   |
| `line(message?)`    | Plain text           | `console.log`    |
| `comment(message)`  | Dim/grey text        | `console.log`    |
| `newLine(count?)`   | Empty lines          | `console.log`    |

#### `table(headers, rows)`

Renders a formatted ASCII table. Short rows are padded with empty strings.

```ts
this.table(
  ['Name', 'Email', 'Role'],
  [
    ['Alice', 'alice@example.com', 'admin'],
    ['Bob'],  // missing columns render as empty
  ]
)
```

Output:
```
------+--------------------+------
 Name | Email              | Role
------+--------------------+------
 Alice| alice@example.com  | admin
 Bob  |                    |
------+--------------------+------
```

#### Interactive prompts

All prompt methods throw `CancelledError` if the user presses Ctrl+C.

| Method                                    | Returns          | Description               |
|-------------------------------------------|------------------|---------------------------|
| `ask(message, defaultValue?)`             | `Promise<string>`| Text input                |
| `confirm(message, defaultValue?)`         | `Promise<boolean>`| Yes/no confirmation       |
| `choice(message, choices, defaultValue?)` | `Promise<string>`| Selection list            |
| `secret(message)`                         | `Promise<string>`| Hidden input (password)   |

```ts
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

---

### `CancelledError`

Thrown when the user cancels an interactive prompt (Ctrl+C).

```ts
import { CancelledError } from '@rudderjs/rudder'

try {
  const answer = await this.ask('Name?')
} catch (err) {
  if (err instanceof CancelledError) {
    // handle gracefully
  }
}
```

---

### `parseSignature(signature)`

Parses a command signature string into a structured `ParsedSignature` object.
Throws if the signature does not start with a valid command name.

```ts
import { parseSignature } from '@rudderjs/rudder'

const parsed = parseSignature('users:create {name} {email?} {--force} {--role=admin}')
// parsed.name → 'users:create'
// parsed.args → [{ name: 'name', required: true, variadic: false }, ...]
// parsed.opts → [{ name: 'force', hasValue: false }, { name: 'role', hasValue: true, defaultValue: 'admin' }]
```

**Types:**

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

---

## Notes

- `@clack/prompts` is lazy-loaded (singleton) — only imported on the first prompt call.
- `process.exit()` is never called — prompt cancellation throws `CancelledError` instead.
- `rudder` / `Rudder` are both exported and refer to the same global singleton.
- The registry is consumed by `@rudderjs/cli` at runtime to build the CLI help and dispatch commands.
