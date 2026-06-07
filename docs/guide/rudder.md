# Rudder Console

Rudder is the framework's CLI. You define commands as classes or inline handlers in `routes/console.ts`, and run them with `pnpm rudder <name>`. The CLI boots the full application before dispatching, so commands have access to the DI container, ORM, services, queues, and everything else.

```bash
pnpm rudder --help
pnpm rudder db:seed
pnpm rudder make:model Post
```

The CLI must run from a directory containing `bootstrap/app.ts`. From the playground, scaffolded apps, or your project root — never from a sub-package.

## Defining commands

Inline commands cover most cases:

```ts
// routes/console.ts
import { rudder } from '@rudderjs/console'
import { User } from '../app/Models/User.js'

rudder.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com' })
  console.log('Seeded.')
}).description('Seed the database with sample data')

rudder.command('greet {name}', async (args) => {
  console.log(`Hello, ${args[0]}!`)
}).description('Greet a user by name')
```

For complex commands with typed input, output helpers, and prompts, extend `Command`:

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
import { rudder } from '@rudderjs/console'
import { SeedCommand } from '../app/Commands/SeedCommand.js'

rudder.register(SeedCommand)
```

## Signature syntax

Signatures encode arguments, options, and inline descriptions in one string:

| Syntax | Description |
|---|---|
| `{name}` | Required argument |
| `{name?}` | Optional argument |
| `{name*}` | Variadic (array) argument |
| `{name=default}` | Argument with default |
| `{--flag}` | Boolean flag |
| `{--N\|name}` | Flag with shorthand (`-N`) |
| `{--name=}` | Option that takes a value |
| `{--name=default}` | Option with default value |
| `{arg : description}` | Inline description for `--help` |

```ts
readonly signature = 'import:users {file} {--dry-run} {--limit=100}'
```

```bash
pnpm rudder import:users users.csv --dry-run --limit=50
```

## Inside a command

Inside `handle()` use the `this.argument(...)` / `this.option(...)` accessors and the styled output helpers:

```ts
const name  = this.argument('name')      // '' if missing
const count = this.option('count')        // value
const dry   = this.option('dry-run')      // boolean

this.info('Starting...')                  // green
this.warn('Skipping row 5')               // yellow
this.error('Failed!')                     // red
this.line('Plain output')                 // unstyled
this.comment('Takes a moment')            // dim
this.table(['Name', 'Email'], [['Alice', 'a@b.com']])
```

For interactive input:

```ts
const name = await this.ask('What is your name?', 'World')
const ok   = await this.confirm('Continue?')
const env  = await this.choice('Environment', ['local', 'staging', 'production'])
const pass = await this.secret('Password')
```

All prompts throw `CancelledError` on Ctrl+C — catch it to handle cancellation gracefully:

```ts
import { CancelledError } from '@rudderjs/console'

try {
  await this.ask('Name?')
} catch (err) {
  if (err instanceof CancelledError) return this.warn('Cancelled.')
  throw err
}
```

## Built-in commands

The framework ships several built-in commands that show up automatically. The set depends on which packages are installed.

| Command | Provided by | Purpose |
|---|---|---|
| `make:controller`, `make:model`, `make:middleware`, `make:request`, `make:provider`, `make:command`, `make:event`, `make:exception`, `make:listener`, `make:mail`, `make:job` | core | Scaffold boilerplate files |
| `make:module`, `module:publish` | core | Module scaffolding + Prisma shard merge |
| `make:terminal` | terminal | Scaffold an Ink terminal component for `terminal('id', props)` |
| `make:migration` | orm | `--vector` flag scaffolds pgvector extension + column add |
| `make:factory` | orm | Scaffold a `ModelFactory` subclass at `app/Factories/<Name>Factory.ts` |
| `make:seeder` | orm | Scaffold a `Seeder` subclass at `database/seeders/<Name>Seeder.ts` |
| `db:push`, `db:generate`, `migrate`, `migrate:fresh`, `migrate:status`, `db:seed` | orm-prisma / orm-drizzle | Database commands (auto-detects ORM). On the native engine, `migrate*` also take `--connection=<name>` (run against a named connection, state table included) and `--path=<dir>` (migrations directory) — see [Connections — Multi-database migrations](./database/connections.md#multi-database-migrations) |
| `model:prune` | orm | Walk `prunable()` models and delete matching rows. Honors `pruneMode: 'instance' \| 'mass'` |
| `db:show`, `db:table` | orm (native engine) | Inspect the live database — `db:show` lists tables with sizes (`--counts` adds row counts, `--views` adds views); `db:table <name>` shows columns, indexes, and foreign keys. `--json` machine-readable. Prisma/Drizzle apps are pointed at `prisma studio` / `drizzle-kit studio`. See [Native Engine — Inspecting](./database/native.md#inspecting-the-database). |
| `db:query "<SELECT …>"` | orm (every adapter) | Run a one-off read-only SELECT through the `DB` facade and print JSON rows. Works on native, Prisma, and Drizzle; rejects non-SELECT statements. Backs `@rudderjs/boost`'s `db_query` MCP tool. |
| `queue:work` | queue | Worker process |
| `cache:clear` | cache | Flush the application cache store |
| `optimize:clear` | cli | Remove framework filesystem caches — `bootstrap/cache/` (provider manifest) + `node_modules/.vite/` (dep-optimizer). Skip-boot, so it works when a corrupt cache is why the app won't boot |
| `fresh` | cli | One-command dev reset: `migrate:fresh` (add `--seed` to also run the seeder) → `cache:clear` (best-effort) → framework filesystem caches. Aborts before touching caches if the migrate fails |
| `storage:link` | storage | Symlink `public/storage → storage/app/public` |
| `schedule:work`, `schedule:run`, `schedule:list` | schedule | Task scheduler |
| `route:list` | router | List all registered routes with name + middleware. `--verbose` (or `-v`) expands the resolved `[global → group → route]` middleware stack in the same order that runs at request time. `--json` for machine-readable; combine with `--verbose` to include the resolved layers inline. |
| `event:list` | core | List registered events alongside each listener's class name. `--filter <substring>` narrows by event name; `--json` machine-readable. Wildcard (`*`) listeners surface as their own row. |
| `config:show` | core | Inspect resolved configuration. No-arg prints the section summary; `config:show cache` prints the section tree; `config:show cache.default` resolves a leaf. Sensitive values (keys ending in `key`/`secret`/`password`/`token`/`dsn`/`webhook`/`signing` after camelCase + snake_case split) print as `***`. `--raw` opts out with a stderr warning; `--json` round-trips through redaction. |
| `command:list` | rudder | List all registered commands. `--all` includes built-in + package commands; `--json` emits a machine-readable envelope used by `@rudderjs/boost`'s MCP tools |
| `doctor` | cli + all framework packages | Green/yellow/red pre-flight of every layer — env, structure, deps, ORM, runtime. `--deep` adds runtime checks (DB connect, port, SMTP); `--fix` auto-applies safe regenerate-style fixes. See [Rudder Doctor](./doctor.md). |
| `tinker` | cli | Interactive REPL with the app booted — `User`, `Route`, `app()`, every model in `app/Models/` pre-imported. Top-level await; persistent history. See [Tinker](./tinker.md). |
| `add`, `remove` | core | Install / uninstall a `@rudderjs/*` package end-to-end (see below) |
| `vendor:publish` | core | Publish package assets (configs, views, schemas) |
| `providers:discover` | core | Bake the provider manifest (build-step primitive — boot self-heals it in dev) |
| `mcp:inspector` | mcp | Dev UI for MCP servers |
| `ai:eval` | ai | Run agent evals with metrics; `--record` / `--replay` for fixtures, `--html <path>` for a self-contained report |
| `passport:keys`, `passport:client`, `passport:purge` | passport | OAuth 2 key + client + token management |
| `boost:install`, `boost:update`, `boost:mcp` | boost | AI-agent DX setup + MCP server |

For the full set, run `pnpm rudder --help`.

## `make:*` commands

Every `make:*` command takes a name and writes a stub:

```bash
pnpm rudder make:controller User             # → app/Http/Controllers/UserController.ts
pnpm rudder make:middleware Auth             # → app/Http/Middleware/AuthMiddleware.ts
pnpm rudder make:request CreateUser          # → app/Http/Requests/CreateUserRequest.ts
pnpm rudder make:model Post                  # → app/Models/Post.ts
pnpm rudder make:provider App                # → app/Providers/AppServiceProvider.ts
pnpm rudder make:job SendWelcomeEmail        # → app/Jobs/SendWelcomeEmail.ts
pnpm rudder make:event UserRegistered        # → app/Events/UserRegistered.ts
pnpm rudder make:exception PaymentError      # → app/Exceptions/PaymentError.ts
pnpm rudder make:listener SendWelcome        # → app/Listeners/SendWelcome.ts
pnpm rudder make:mail Welcome                # → app/Mail/Welcome.ts
pnpm rudder make:command Backup              # → app/Commands/Backup.ts
pnpm rudder make:factory User                # → app/Factories/UserFactory.ts
pnpm rudder make:seeder Users                # → database/seeders/UsersSeeder.ts
```

Pass `--force` to overwrite an existing file. These generators all emit `.ts` files; only `make:terminal` emits a `.tsx` Ink component.

The class generators above (everything except the package-contributed `make:factory` / `make:seeder`) also take `-t, --with-test` — writes `tests/<Name>.test.ts` alongside the scaffolded file, shaped right for what was generated: a feature test (AppTestCase + HTTP) for `make:controller`, a unit test (plain node:test, no app boot) for everything else. See [Testing](/guide/testing).

`make:exception` also takes `--status <code>` (4xx/5xx, default `500`) — the generated class declares `readonly httpStatus = <code>`, which the exception pipeline picks up automatically (see [Error Handling](/guide/error-handling)).

## `add` / `remove` — manage framework packages

After scaffolding, the easiest way to grow your app is `rudder add`:

```bash
pnpm rudder add queue         # install + generate config/queue.ts + register + providers:discover
pnpm rudder add ai            # generates config/ai.ts — print: "Set ANTHROPIC_API_KEY in .env"
pnpm rudder add telescope     # debug dashboard at /telescope
pnpm rudder add passport      # validates: passport requires auth + Prisma
```

Each invocation:

1. Validates the alias against the registry of 25 known packages (same set the scaffolder offers under **Custom**).
2. Checks dependencies — e.g. `sanctum` requires `auth`; `passport` requires `auth` + Prisma.
3. Installs `@rudderjs/<name>` via the auto-detected package manager.
4. Writes `config/<name>.ts` from a vendored template — skipped if the file already exists.
5. Surgically inserts the new entry into `config/index.ts` (import line + key in the `configs = { ... }` map). Idempotent.
6. Re-runs `providers:discover` so the new provider boots on the next request.
7. Prints a one-line hint specific to the package.

`remove` reverses every step:

```bash
pnpm rudder remove queue              # uninstall + delete config/queue.ts + unregister + providers:discover
pnpm rudder remove queue --keep-config   # uninstall but preserve config/queue.ts for re-add later
```

It refuses to break the dependency graph — `rudder remove auth` while `sanctum`/`passport` are still installed fails with a friendly message pointing at which dependents need to go first.

### Supported aliases

```
Auth & Security      — auth, sanctum, passport, socialite, crypt
Infrastructure       — queue, storage, scheduler
Communication        — mail, notifications, broadcast, sync
Internationalization — localization
Developer Experience — pennant, http, process, concurrency, terminal
Media                — image
Observability        — telescope, pulse, horizon
AI & Tooling         — ai, mcp, boost
```

Either the short alias (`rudder add queue`) or the full npm name (`rudder add @rudderjs/queue`) works.

## Modules

For larger apps, group a feature's models, services, providers, and Prisma shard under `app/Modules/<Name>/`:

```bash
pnpm rudder make:module Blog
# → app/Modules/Blog/{Blog.prisma, BlogService.ts, BlogServiceProvider.ts, Blog.test.ts}

pnpm rudder module:publish
# Merges every app/Modules/*/*.prisma into prisma/schema/modules.prisma
# (or prisma/schema.prisma on single-file layouts)
```

`module:publish` keeps Prisma's multi-file schema in sync with module shards — run it after adding a module or editing its `.prisma` file. It merges every module shard into `prisma/schema/modules.prisma` when the app uses the multi-file `prisma/schema/` directory (the scaffolder default), or into `prisma/schema.prisma` on single-file layouts.

## Pitfalls

- **Running rudder from a sub-package.** It resolves `bootstrap/app.ts` from `process.cwd()`. Run from the project root.
- **Expecting `providers:discover` to be required after install.** It isn't — the provider manifest self-heals at boot (missing or stale → rescan). The command exists for build pipelines: bundled/serverless deploys must bake `bootstrap/cache/providers.json` at build time.
- **`make:*` overwriting work.** Without `--force`, the generator refuses to overwrite. With `--force`, it overwrites silently — review the diff before committing.
- **Slow commands at startup.** The CLI boots the full app for every command. `make:*`, `providers:discover`, `db:generate`, `db:push`, `migrate*`, `add`, `remove`, and `view:sync` skip `bootApp()` for speed; if you write a custom command that doesn't need the app, you can do the same — see `@rudderjs/cli`'s source.
