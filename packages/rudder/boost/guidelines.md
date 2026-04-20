# @rudderjs/rudder

## Overview

Command registry + class-based command primitives for the RudderJS CLI. Apps register commands in `routes/console.ts` via `rudder.command(...)` (from `@rudderjs/core`) or `Rudder.register(CommandClass)` (from this package). Packages register their own commands in their provider's `boot()`. The CLI runner (`@rudderjs/cli`) loads and dispatches them.

## Key Patterns

### Functional commands

```ts
import { Rudder } from '@rudderjs/rudder'
// Or re-exported via @rudderjs/core: import { rudder } from '@rudderjs/core'

Rudder.command('greet {name}', (args) => {
  console.log(`Hello, ${args.name}!`)
}).description('Print a greeting')

Rudder.command('post:publish {id} {--dry-run}', async (args) => {
  const id = args.id
  const dryRun = args.dryRun === true
  // ...
})
```

### Class-based commands

```ts
import { Command, Rudder } from '@rudderjs/rudder'

class PingCommand extends Command {
  readonly signature   = 'ping {--N|name=world}'
  readonly description = 'Ping with an optional name'

  async handle() {
    const name = this.option<string>('name')
    this.info(`Pong, ${name}!`)
  }
}

Rudder.register(PingCommand)
```

Use the class form when the command has multiple phases, needs DI via constructor, or when you want inherited helpers (`this.info/error/warn`, `this.prompt/confirm/select`, `this.argument/option`).

### Signature grammar (Laravel-style)

```
command-name {required} {optional?} {--flag} {--key=default} {--S|short=value}
```

- `{name}` — required argument
- `{name?}` — optional argument
- `{name=default}` — optional with default
- `{name*}` — variadic (array)
- `{--flag}` — boolean option (present = true)
- `{--name=default}` — option with default
- `{--N|name=default}` — with `-N` short alias

### Interactive helpers

```ts
// Inside a class command's handle()
const name = await this.prompt('Project name?')
const confirm = await this.confirm('Proceed?', true)
const choice = await this.select('Pick one', ['a', 'b', 'c'])
const multi = await this.multiselect('Pick several', ['x', 'y', 'z'])

this.info('Processing...')
this.success('Done!')
this.warn('Heads up.')
this.error('Something failed.')
```

All backed by `@clack/prompts`. Fall back to plain stdin on non-TTY.

### Skip-boot optimization

Tooling commands that operate on source files (not runtime state) should skip `bootApp()`:

```ts
Rudder.command('my:scaffold', async () => { /* ... */ })
  .skipBoot()
```

3× faster start, avoids the chicken-and-egg of needing a working app to scaffold one. Use for: `make:*`, `providers:discover`, `module:publish`.

### `registerMakeSpecs` for scaffolders

```ts
import { registerMakeSpecs } from '@rudderjs/rudder'

registerMakeSpecs({
  command:     'make:my-thing',
  description: 'Scaffold a new thing',
  label:       'Thing created',
  directory:   'app/Things',
  stub: (className) => `// generated ${className}`,
})
```

Standard pattern for `make:*` commands. Skips app boot automatically.

### Exit codes

- `0` — success (default)
- Throw inside the handler → non-zero exit
- `throw new CliError('message', exitCode)` for specific codes
- `CancelledError` (Ctrl-C during a prompt) → auto-caught, exits `130`

## Common Pitfalls

- **Functional command `args` shape.** Arguments AND options land on the same `args` object. `{id}` → `args.id`; `{--dry-run}` → `args.dryRun` (camelCased).
- **Class command without `signature`.** Required field. Missing → registration throws.
- **`skipBoot` on runtime commands.** Commands that need the DI container, ORM, or config MUST boot. Only skip for source-file-manipulation commands.
- **Re-registering under the same name.** Last registration wins silently. Check with `rudder:list` to see active commands.
- **Package commands and CLI decoupling.** Domain commands (`make:model`, `queue:work`, `mail:make`) live in their owning package (e.g. `@rudderjs/orm`, `@rudderjs/queue`, `@rudderjs/mail`). Register via `rudder.command()` in the provider's `boot()` for runtime commands, or `registerMakeSpecs()` for scaffolders.
- **Adding a command that should appear in `rudder --help`.** For packages, also add the loader entry in `packages/cli/src/index.ts`'s `loadPackageCommands()` — it eagerly imports known subpaths. Export from `@rudderjs/<pkg>/commands/<name>`.

## Key Imports

```ts
import { Rudder, Command, registerMakeSpecs, CliError, CancelledError } from '@rudderjs/rudder'

// Re-exported via core (same instance)
import { rudder } from '@rudderjs/core'

import type { CommandSignature, CommandHandler } from '@rudderjs/rudder'
```
