# @rudderjs/cli

The RudderJS command dispatcher. `pnpm rudder <command>` runs any command registered by your app or any installed `@rudderjs/*` package. CLI itself is a thin runner — the commands live in the packages that own them.

```bash
pnpm rudder --help                  # list every registered command
pnpm rudder make:controller Users   # scaffold from @rudderjs/router
pnpm rudder queue:work              # worker from @rudderjs/queue
pnpm rudder migrate                 # Prisma migration helper
```

## How commands are registered

Domain commands live in their **owning package** (decoupled 2026-04-14). Each package's provider calls `rudder.command(...)` in its `boot()` method:

```ts
// In @rudderjs/queue provider.ts
rudder.command('queue:work', async (args) => {
  // ...worker loop
}).description('Process queued jobs')
```

When you `pnpm rudder`, the CLI loads commands from every installed `@rudderjs/*` package's provider. Your app's `routes/console.ts` is the last layer — that's where you register app-specific commands.

```ts
// routes/console.ts
import { rudder } from '@rudderjs/core'

rudder.command('greet <name>', (args) => {
  console.log(`Hello, ${args.name}!`)
}).description('Print a friendly greeting')
```

## Command anatomy

```ts
rudder
  .command('post:publish <id>')
  .description('Publish a post by id')
  .argument('--dry-run', 'Skip the actual write')
  .handler(async (args) => {
    // args.id, args.dryRun
  })
```

Or the shorter inline form:

```ts
rudder.command('post:publish <id>', async (args) => {
  // args.id
}).description('Publish a post by id')
```

**Argument syntax**:

- `<required>` — angle brackets
- `[optional]` — square brackets
- `--flag` — boolean flag (`args.flag === true`)
- `--key=value` or `--key value` — typed key/value (`args.key === 'value'`)

## Built-in helpers

```ts
import { rudder } from '@rudderjs/core'

// Progress + feedback
rudder.info('Processing...')
rudder.success('Done!')
rudder.error('Something failed.')
rudder.warn('Heads up.')

// Interactive prompts
const name = await rudder.prompt('Project name?')
const confirm = await rudder.confirm('Proceed?', true)
const choice = await rudder.select('Pick one', ['a', 'b', 'c'])
```

All helpers use `@clack/prompts` under the hood — nice TTY output with graceful fallback when not a TTY.

## Command ownership

Who ships which `rudder foo` commands:

| Command prefix | Package |
|---|---|
| `make:controller`, `make:middleware`, `make:request`, `make:resource`, `make:command` | `@rudderjs/router` |
| `make:model`, `make:migration`, `make:seed`, `make:factory` | `@rudderjs/orm` |
| `make:job`, `queue:work`, `queue:status`, `queue:clear`, `queue:failed`, `queue:retry` | `@rudderjs/queue` |
| `make:notification` | `@rudderjs/notification` |
| `make:mail`, `mail:*` | `@rudderjs/mail` |
| `make:mcp-server`, `make:mcp-tool`, `make:mcp-resource`, `make:mcp-prompt`, `mcp:start`, `mcp:list`, `mcp:inspector` | `@rudderjs/mcp` |
| `make:passport-client`, `passport:keys`, `passport:client`, `passport:purge` | `@rudderjs/passport` |
| `make:module`, `module:publish` | `@rudderjs/core` |
| `vendor:publish`, `providers:discover` | `@rudderjs/core` |
| `db:push`, `db:seed`, `migrate`, `migrate:fresh`, `migrate:rollback` | `@rudderjs/orm-prisma` |
| `storage:link` | `@rudderjs/storage` |
| `schedule:run`, `schedule:list` | `@rudderjs/schedule` |
| `boost:install`, `boost:update`, `boost:mcp` | `@rudderjs/boost` |

To check at runtime: `pnpm rudder --help` lists every registered command with its source.

## Skipping app boot for tooling commands

Some commands (`make:*`, `providers:discover`, `module:publish`) don't need the app bootstrapped — they operate on source files, not runtime state. These skip `bootApp()` and run 3x faster, and avoid the chicken-and-egg of needing a working app to scaffold one.

When you author a new scaffolder or tooling command, opt out of boot with:

```ts
rudder.command('my:tool', async () => { /* ... */ })
  .skipBoot()
```

## Custom commands outside `routes/console.ts`

Package authors who ship commands should register them in their provider's `boot()`. For scaffolders use `registerMakeSpecs` from `@rudderjs/rudder`:

```ts
// In a package's provider
import { registerMakeSpecs } from '@rudderjs/rudder'

registerMakeSpecs({
  command:     'make:my-thing',
  description: 'Scaffold a new thing',
  label:       'Thing created',
  directory:   'app/Things',
  stub: (className) => `// generated ${className}`,
})
```

The CLI's `loadPackageCommands()` eagerly imports known subpaths. If you add a new command, also export it from a subpath like `@rudderjs/<pkg>/commands/<name>` and add the loader entry in `packages/cli/src/index.ts`.

## Programmatic use

```ts
import { run } from '@rudderjs/cli'

await run(['queue:work', '--queue=emails'])
```

Useful for custom scripts, orchestrators, or wrapping the CLI in your own entry point.

---

## Notes

- Commands fire inside the app's DI container — `resolve()`, `app()`, facades, everything works.
- Exit codes: successful commands exit `0`. Throw in the handler (or `throw new CliError('msg', exitCode)`) to signal failure.
- `CancelledError` (from a prompt cancelled with Ctrl-C) is caught automatically and exits `130`.
- The CLI is a **peer dependency** for packages that ship commands — packages don't force an install, consumers already have it via the scaffolder.
