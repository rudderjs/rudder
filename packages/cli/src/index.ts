#!/usr/bin/env node
import { program } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { makeCommand } from './commands/make.js'
import { moduleCommand } from './commands/module.js'
import { vendorPublishCommand } from './commands/vendor-publish.js'
import { providersDiscoverCommand } from './commands/providers-discover.js'
import { commandListCommand } from './commands/command-list.js'
import { addCommand } from './commands/add.js'
import { removeCommand } from './commands/remove.js'
import { doctorCommand } from './commands/doctor.js'
import { tinkerCommand } from './commands/tinker.js'
import { rudder, parseSignature, CancelledError, commandObservers, type CommandObservation } from '@rudderjs/console'
import { CliError } from './errors.js'

// The `rudder` CLI's own version, read from its package.json at runtime — works
// in both the published `dist/index.js` and the tsx `src/index.ts` form (both
// sit one level under the package root). Replaces a hardcoded `0.0.2` that
// never tracked the real version.
const VERSION: string = (() => {
  try {
    return (createRequire(import.meta.url)('../package.json') as { version: string }).version
  } catch {
    return '0.0.0'
  }
})()

const C = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
}

/**
 * Find the nearest bootstrap/app.ts by searching up then one level down.
 * Returns the absolute path to the file, or null if not found.
 * Changes process.cwd() to the app root when found.
 */
async function resolveAppRoot(): Promise<string | null> {
  // 1. Walk up the directory tree from cwd
  let dir = process.cwd()
  while (true) {
    const candidate = path.join(dir, 'bootstrap', 'app.ts')
    try { await fs.access(candidate); process.chdir(dir); return candidate } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // 2. Check immediate subdirectories of cwd (monorepo: rudderjs root → playground/)
  const entries = await fs.readdir(process.cwd(), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(process.cwd(), entry.name, 'bootstrap', 'app.ts')
    try {
      await fs.access(candidate)
      process.chdir(path.join(process.cwd(), entry.name))
      return candidate
    } catch {}
  }

  return null
}

/**
 * Bootstrap the RudderJS application so providers (DB, etc.) are ready before
 * running any command.
 */
async function bootApp(): Promise<void> {
  // Suppress console during boot — provider boot messages are noise in CLI output
  const saved = {
    log: console.log, warn: console.warn,
    info: console.info, error: console.error,
  }
  const noop = (..._: unknown[]): void => {}
  console.log = console.warn = console.info = console.error = noop

  try {
    const appFile = await resolveAppRoot()
    if (appFile) {
      const { default: rudderjs } = await import(appFile) as { default: { boot(): Promise<void> } }
      await rudderjs.boot()
    } else {
      // Fallback: try loading console routes directly (no full app context)
      for (const ext of ['ts', 'js']) {
        const file = path.join(process.cwd(), 'routes', `console.${ext}`)
        try { await fs.access(file); await import(file); break } catch { /* skip */ }
      }
    }
  } finally {
    // Restore console so command handlers can print normally
    console.log = saved.log; console.warn = saved.warn
    console.info = saved.info; console.error = saved.error
  }
}

/**
 * Run a command action and emit a CommandObservation to any subscribed
 * observers (e.g. telescope's CommandCollector). The observation fires
 * even when the action throws — telescope wants to record failures too.
 */
async function observeCommand(
  name:   string,
  args:   Record<string, unknown>,
  opts:   Record<string, unknown>,
  source: CommandObservation['source'],
  fn:     () => Promise<void> | void,
): Promise<void> {
  const start = Date.now()
  let exitCode = 0
  let error: Error | undefined
  try {
    await fn()
  } catch (e) {
    exitCode = e instanceof CancelledError ? 130 : 1
    error    = e instanceof Error ? e : new Error(String(e))
    throw e
  } finally {
    const obs: CommandObservation = {
      name, args, opts, source,
      duration: Date.now() - start,
      exitCode,
    }
    if (error) obs.error = error
    commandObservers.emit(obs)
  }
}

/**
 * Eagerly import commands from installed packages.
 * Packages register make specs (scaffolders) and runtime commands here so
 * they work both with and without full app boot.
 *
 * Dynamic import paths are built at runtime so TypeScript doesn't try to
 * resolve them at compile time (these packages are optional).
 */
async function loadPackageCommands(): Promise<void> {
  const { registerMakeSpecs, rudder } = await import('@rudderjs/console')
  const { pathToFileURL } = await import('node:url')
  const fsm = await import('node:fs')

  // Helper: import a `<package>/<subpath>` from the user's app, not from
  // cli's own node_modules. The cli is consumed in two shapes —
  //
  //   - Built: `node_modules/@rudderjs/cli/dist/index.js` (published form).
  //     `import('@rudderjs/ai')` from inside that file resolves correctly
  //     because the user's app DOES have `@rudderjs/ai` in its
  //     `node_modules`, and Node walks upward from `dist/`.
  //
  //   - Source via tsx: `node_modules/@rudderjs/cli/src/index.ts` (pnpm
  //     symlink → workspace `packages/cli/src/index.ts`). From there
  //     `import('@rudderjs/ai')` resolves against `packages/cli/...`,
  //     which under pnpm strict mode has no `@rudderjs/ai` (it's a peer,
  //     not a dep). Every package-contributed make:* / runtime command
  //     silently fails to register.
  //
  // The fix matches doctor's `load-package-checks.ts`: walk the user's
  // `node_modules/<pkg>/dist/<subpath>.js` directly + `pathToFileURL`
  // for Windows portability. ESM-only-peer resolution (no `require`
  // condition in subpath exports) flows through cleanly.
  const tryImport = async (pkg: string, subpath: string): Promise<Record<string, unknown>> => {
    const target = path.join(process.cwd(), 'node_modules', pkg, 'dist', `${subpath}.js`)
    if (!fsm.existsSync(target)) throw new Error(`[cli] ${pkg}/${subpath} not installed`)
    return await import(/* @vite-ignore */ pathToFileURL(target).href) as Record<string, unknown>
  }

  const loaders = [
    // @rudderjs/ai → make:agent
    async () => {
      const mod = await tryImport('@rudderjs/ai', 'commands/make-agent')
      registerMakeSpecs(mod['makeAgentSpec'] as import('@rudderjs/console').MakeSpec)
    },
    // @rudderjs/ai → ai:eval
    async () => {
      const mod = await tryImport('@rudderjs/ai', 'commands/ai-eval')
      const register = mod['registerAiEvalCommand'] as (r: typeof rudder) => void
      register(rudder)
    },
    // @rudderjs/mcp → make:mcp-*
    async () => {
      const [server, tool, resource, prompt] = await Promise.all([
        tryImport('@rudderjs/mcp', 'commands/make-mcp-server'),
        tryImport('@rudderjs/mcp', 'commands/make-mcp-tool'),
        tryImport('@rudderjs/mcp', 'commands/make-mcp-resource'),
        tryImport('@rudderjs/mcp', 'commands/make-mcp-prompt'),
      ])
      registerMakeSpecs(
        server['makeMcpServerSpec'] as import('@rudderjs/console').MakeSpec,
        tool['makeMcpToolSpec'] as import('@rudderjs/console').MakeSpec,
        resource['makeMcpResourceSpec'] as import('@rudderjs/console').MakeSpec,
        prompt['makeMcpPromptSpec'] as import('@rudderjs/console').MakeSpec,
      )
    },
    // @rudderjs/orm → migrate, migrate:fresh, migrate:status, make:migration, db:push, db:generate
    async () => {
      const mod = await tryImport('@rudderjs/orm', 'commands/migrate')
      const register = mod['registerMigrateCommands'] as (r: typeof rudder) => void
      register(rudder)
    },
    // @rudderjs/orm → model:prune
    async () => {
      const mod = await tryImport('@rudderjs/orm', 'commands/prune')
      const register = mod['registerPruneCommand'] as (r: typeof rudder) => void
      register(rudder)
    },
    // @rudderjs/orm → make:factory
    async () => {
      const mod = await tryImport('@rudderjs/orm', 'commands/make-factory')
      registerMakeSpecs(mod['makeFactorySpec'] as import('@rudderjs/console').MakeSpec)
    },
    // @rudderjs/orm → make:seeder
    async () => {
      const mod = await tryImport('@rudderjs/orm', 'commands/make-seeder')
      registerMakeSpecs(mod['makeSeederSpec'] as import('@rudderjs/console').MakeSpec)
    },
    // @rudderjs/router → route:list
    async () => {
      const mod = await tryImport('@rudderjs/router', 'commands/route-list')
      const register = mod['registerRouteListCommand'] as (r: typeof rudder) => void
      register(rudder)
    },
    // @rudderjs/core → event:list
    async () => {
      const mod = await tryImport('@rudderjs/core', 'commands/event-list')
      const register = mod['registerEventListCommand'] as (r: typeof rudder) => void
      register(rudder)
    },
    // @rudderjs/core → config:show
    async () => {
      const mod = await tryImport('@rudderjs/core', 'commands/config-show')
      const register = mod['registerConfigShowCommand'] as (r: typeof rudder) => void
      register(rudder)
    },
    // @rudderjs/terminal → make:terminal
    async () => {
      const mod = await tryImport('@rudderjs/terminal', 'commands/make-terminal')
      registerMakeSpecs(mod['makeTerminalSpec'] as import('@rudderjs/console').MakeSpec)
    },
    // @rudderjs/passport → make:passport-client
    async () => {
      const mod = await tryImport('@rudderjs/passport', 'commands/make-passport-client')
      registerMakeSpecs(mod['makePassportClientSpec'] as import('@rudderjs/console').MakeSpec)
    },
    // @rudderjs/vite → view:sync
    async () => {
      const mod = await tryImport('@rudderjs/vite', 'commands/view-sync')
      const register = mod['registerViewSyncCommand'] as (r: typeof rudder) => void
      register(rudder)
    },
    // @rudderjs/vite → routes:sync
    async () => {
      const mod = await tryImport('@rudderjs/vite', 'commands/routes-sync')
      const register = mod['registerRoutesSyncCommand'] as (r: typeof rudder) => void
      register(rudder)
    },
  ]

  await Promise.all(loaders.map(fn => fn().catch(() => { /* package not installed */ })))
}

async function main(): Promise<void> {
  program
    .name('rudder')
    .helpOption('-h, --help', 'Display help for the given command')
    .version(VERSION, '-V, --version', 'Display Rudder version')

  // Laravel-style custom help output
  program.configureHelp({
    formatHelp: (cmd, helper) => {
      // Subcommand help: show description, usage, args, options (Laravel-ish)
      if (cmd.parent) {
        const args = helper.visibleArguments(cmd)
        const opts = helper.visibleOptions(cmd)
        const argLabel = (a: { name(): string; required: boolean; variadic: boolean }): string => {
          const n = a.variadic ? `${a.name()}...` : a.name()
          return a.required ? `<${n}>` : `[${n}]`
        }

        let out = `\n  ${C.dim('Description:')}\n    ${cmd.description()}\n`
        out += `\n  ${C.dim('Usage:')}\n    ${cmd.name()}${opts.length ? ' [options]' : ''}${args.map(a => ` ${argLabel(a)}`).join('')}\n`

        if (args.length > 0) {
          const w = Math.max(...args.map(a => argLabel(a).length)) + 2
          out += `\n  ${C.dim('Arguments:')}\n`
          for (const a of args) {
            out += `    ${C.green(argLabel(a).padEnd(w))}  ${helper.argumentDescription(a)}\n`
          }
        }

        if (opts.length > 0) {
          const w = Math.max(...opts.map(o => helper.optionTerm(o).length)) + 2
          out += `\n  ${C.dim('Options:')}\n`
          for (const o of opts) {
            out += `    ${C.green(helper.optionTerm(o).padEnd(w))}  ${helper.optionDescription(o)}\n`
          }
        }

        return out + '\n'
      }

      // Top-level help: list all commands grouped by namespace
      const cmds = helper.visibleCommands(cmd).filter(c => c.name() !== 'help')
      const nameWidth = Math.max(...cmds.map(c => c.name().length), 8) + 4

      // Group by namespace (the part before ':')
      const root:   typeof cmds = []
      const groups: Record<string, typeof cmds> = {}
      for (const c of cmds) {
        const ns = c.name().split(':')[0] ?? c.name()
        if (!c.name().includes(':')) root.push(c)
        else groups[ns] = [...(groups[ns] ?? []), c]
      }

      let out = `\n  Rudder Framework ${C.yellow(VERSION)}\n`
      out += `\n  ${C.dim('Usage:')}\n`
      out += `    command [options] [arguments]\n`
      out += `\n  ${C.dim('Available commands:')}\n`

      for (const c of root) {
        out += `  ${C.green(c.name().padEnd(nameWidth))}  ${c.description()}\n`
      }

      for (const [ns, items] of Object.entries(groups).sort()) {
        out += `\n ${C.dim(ns)}\n`
        for (const c of items) {
          out += `  ${C.green(c.name().padEnd(nameWidth))}  ${c.description()}\n`
        }
      }

      return out + '\n'
    },
  })

  moduleCommand(program)
  vendorPublishCommand(program)
  providersDiscoverCommand(program)
  addCommand(program)
  removeCommand(program)
  doctorCommand(program, { bootApp })
  tinkerCommand(program)

  // Commands that scan files / manage tooling state must work even when the
  // app cannot boot (e.g. fresh clone, missing manifest, broken provider config).
  // List them here to skip the bootApp() phase entirely.
  //
  // - Anything starting with `make:` is a scaffolder — reads templates from
  //   disk, writes new files, doesn't touch the running app.
  // - `providers:discover` regenerates the manifest the app needs to boot,
  //   so it has to work when the app can't.
  // - `module:publish` copies static assets out of node_modules; no app state.
  // - `view:sync` regenerates `pages/__view/` (registry.d.ts + Vike stubs)
  //   from disk; needed when CI typechecks before Vite has run, or on a
  //   fresh clone before the first dev server boot.
  // - `db:generate`, `db:push`, `migrate*` all spawn the underlying ORM
  //   binary (prisma / drizzle-kit) and don't touch app state. Crucially,
  //   `db:generate` MUST work before `@prisma/client` exists, which is
  //   exactly the chicken-and-egg the framework boot would hit otherwise
  //   on a fresh scaffolded project. (`db:seed` is deliberately NOT here —
  //   user seeders use the ORM and need a booted app.)
  // - `add` installs a new package — the freshly added provider hasn't
  //   been registered with the manifest yet, so booting the app would
  //   crash on the missing provider before the command's own
  //   providers:discover step gets a chance to refresh the manifest.
  // - `remove` uninstalls a package — the about-to-be-deleted provider
  //   may still be in node_modules but is being torn out; booting would
  //   be wasted work at best and surface confusing errors at worst.
  const NO_BOOT_EXACT  = new Set([
    'providers:discover', 'module:publish', 'view:sync', 'routes:sync',
    'db:generate', 'db:push',
    'migrate', 'migrate:fresh', 'migrate:status',
    'add', 'remove',
    // `doctor` fast-path runs filesystem/env checks only. `--deep` is handled
    // inside the command's handler, which boots the app on demand (Phase 4).
    'doctor',
  ])
  const NO_BOOT_PREFIX = ['make:']
  const skipBoot = process.argv.slice(2).some(arg =>
    NO_BOOT_EXACT.has(arg) || NO_BOOT_PREFIX.some(p => arg.startsWith(p)),
  )

  // Tag this process as a queue worker before providers boot, so cross-cutting
  // collectors (e.g. @rudderjs/horizon's WorkerCollector) can self-register
  // here but stay quiet in the dev/web process. Queue adapters also set this
  // defensively, but doing it here guarantees the var is visible during boot.
  if (process.argv.slice(2).includes('queue:work')) {
    process.env['RUDDERJS_QUEUE_WORKER'] = '1'
  }

  // Same shape for `tinker` — providers that actively poll / open connections
  // on boot (horizon's WorkerCollector is the canonical example) can short-
  // circuit when this is set. Most providers don't need to check it — the
  // framework's boot is mostly passive — but the sentinel is here for the
  // ones that do, and it's the documented escape hatch for future ones.
  if (process.argv.slice(2).includes('tinker')) {
    process.env['RUDDERJS_TINKER'] = '1'
  }

  // Eagerly load make specs from installed packages so make:* works without boot.
  // Each package exports its MakeSpec objects from a known subpath.
  await loadPackageCommands()

  // Register all make:* commands (CLI-owned + package-contributed)
  makeCommand(program)

  // Tolerate boot failures for purely introspective tooling invocations.
  // `command:list --json` is consumed by AI agents (boost MCP server) and must
  // produce *something* even when the user's app can't boot — partial info beats
  // an opaque crash for an agent mid-session. The boot error is stashed on the
  // command for inclusion in the JSON output.
  const argv = process.argv.slice(2)
  const introspectiveJson = argv.includes('command:list') && argv.includes('--json')

  // Boot the app (providers + route files) so commands can use DB, etc.
  if (!skipBoot) {
    try {
      await bootApp()
    } catch (err) {
      if (!introspectiveJson) throw err
      ;(globalThis as Record<string, unknown>)['__rudderjs_cli_boot_error__'] =
        err instanceof Error ? err.message : String(err)
    }
  }

  // ── Built-in framework commands ───────────────────────────

  commandListCommand(program)

  // Inline commands (rudder.command())
  for (const cmd of rudder.getCommands()) {
    program
      .command(cmd.name)
      .description(cmd.getDescription())
      .allowUnknownOption()
      .action(async (...comArgs: unknown[]) => {
        const commanderCmd = comArgs[comArgs.length - 1] as { args: string[]; opts: () => Record<string, unknown> }
        await observeCommand(cmd.name, { args: commanderCmd.args }, commanderCmd.opts(), 'inline',
          () => cmd.handler(commanderCmd.args, commanderCmd.opts()))
      })
  }

  // Class-based commands (rudder.register())
  for (const CommandClass of rudder.getClasses()) {
    const instance = new CommandClass()
    const { name, args, opts } = parseSignature(instance.signature)

    const sub = program.command(name).description(instance.description)

    for (const arg of args) {
      const token = arg.variadic
        ? `[${arg.name}...]`
        : arg.required
          ? `<${arg.name}>`
          : `[${arg.name}]`
      sub.argument(token, arg.description ?? '', arg.defaultValue)
    }

    for (const opt of opts) {
      const flag = opt.shorthand
        ? `-${opt.shorthand}, --${opt.name}${opt.hasValue ? ' <value>' : ''}`
        : `--${opt.name}${opt.hasValue ? ' <value>' : ''}`
      sub.option(flag, opt.description ?? '', opt.defaultValue)
    }

    sub.action(async (...comArgs: unknown[]) => {
      // Commander passes: arg0, arg1, ..., CommandInstance
      const commanderCmd = comArgs[comArgs.length - 1] as { opts: () => Record<string, unknown> }
      const parsedArgs: Record<string, unknown> = {}
      args.forEach((a, i) => { parsedArgs[a.name] = comArgs[i] })
      const fresh = new CommandClass()
      fresh._setContext(parsedArgs, commanderCmd.opts())
      await observeCommand(name, parsedArgs, commanderCmd.opts(), 'class',
        () => fresh.handle())
    })
  }

  program.action(() => program.help())
  await program.parseAsync()
}

main().catch((err) => {
  if (err instanceof CancelledError) {
    console.log(C.yellow('Cancelled.'))
    process.exit(130)
  }
  if (err instanceof CliError) {
    console.error(`\x1b[31m${err.message}\x1b[0m`)
    process.exit(err.exitCode)
  }
  console.error(err)
  process.exit(1)
})
