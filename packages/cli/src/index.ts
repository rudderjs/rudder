#!/usr/bin/env node
import { program } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { makeCommand } from './commands/make.js'
import { moduleCommand } from './commands/module.js'
import { artisan, parseSignature } from '@boostkit/artisan'

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

  // 2. Check immediate subdirectories of cwd (monorepo: boostkit root → playground/)
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
 * Bootstrap the BoostKit application so providers (DB, etc.) are ready before
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
      const { default: boostkit } = await import(appFile) as { default: { boot(): Promise<void> } }
      await boostkit.boot()
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

async function main(): Promise<void> {
  program
    .name('artisan')
    .helpOption('-h, --help', 'Display help for the given command')
    .version('0.0.2', '-V, --version', 'Display BoostKit version')

  // Laravel-style custom help output
  program.configureHelp({
    formatHelp: (cmd, helper) => {
      const cmds = helper.visibleCommands(cmd).filter(c => c.name() !== 'help')
      const nameWidth = Math.max(...cmds.map(c => c.name().length), 8) + 4

      // Group by namespace (the part before ':')
      const root:   typeof cmds = []
      const groups: Record<string, typeof cmds> = {}
      for (const c of cmds) {
        const ns = c.name().split(':')[0]!
        if (!c.name().includes(':')) root.push(c)
        else groups[ns] = [...(groups[ns] ?? []), c]
      }

      let out = `\n  BoostKit Framework ${C.yellow('0.0.2')}\n`
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

  makeCommand(program)
  moduleCommand(program)

  // Boot the app (providers + route files) so commands can use DB, etc.
  await bootApp()

  // ── Built-in framework commands ───────────────────────────

  program
    .command('route:list')
    .description('List all registered routes')
    .action(async () => {
      const { router } = await import('@boostkit/router') as { router: { list(): Array<{ method: string; path: string; middleware: unknown[] }> } }
      const apiRoutes = router.list()

      // ── Scan Vike filesystem routes ──────────────────────
      const vikeRoutes: Array<{ route: string; dir: string }> = []
      const pagesDir = path.join(process.cwd(), 'pages')
      try {
        const scanPages = async (dir: string, base = ''): Promise<void> => {
          const entries = await fs.readdir(dir, { withFileTypes: true })
          const hasPage = entries.some(e => e.isFile() && e.name.startsWith('+Page.'))
          if (hasPage) {
            const segment = path.basename(dir)
            const route   = base === '' ? '/' : base
            const relDir  = path.relative(pagesDir, dir)
            vikeRoutes.push({ route, dir: relDir })
          }
          for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('_')) continue
            const segment    = entry.name
            const routeSegment = segment.startsWith('@') ? `:${segment.slice(1)}` : segment
            const nextBase   = segment === 'index' ? '' : `${base}/${routeSegment}`
            await scanPages(path.join(dir, segment), nextBase)
          }
        }
        await scanPages(pagesDir)
      } catch { /* no pages dir */ }

      const methodColor = (m: string): string => {
        const colors: Record<string, string> = {
          GET: '\x1b[32m', POST: '\x1b[33m', PUT: '\x1b[34m',
          PATCH: '\x1b[35m', DELETE: '\x1b[31m', ALL: '\x1b[36m',
        }
        return `${colors[m] ?? '\x1b[37m'}${m.padEnd(7)}\x1b[0m`
      }

      const allPaths  = [...apiRoutes.map(r => r.path), ...vikeRoutes.map(r => r.route)]
      const pathWidth = Math.min(Math.max(...allPaths.map(p => p.length), 4), 60)
      const mwWidth   = 12

      // ── API / Server routes ──────────────────────────────
      if (apiRoutes.length > 0) {
        console.log('\n  \x1b[1mAPI Routes\x1b[0m')
        console.log(`  ${'METHOD'.padEnd(9)}  ${'PATH'.padEnd(pathWidth)}  MIDDLEWARE`)
        console.log(`  ${'─'.repeat(9)}  ${'─'.repeat(pathWidth)}  ${'─'.repeat(mwWidth)}`)
        for (const route of apiRoutes) {
          const mw = route.middleware.length > 0 ? `${route.middleware.length} handler(s)` : '—'
          console.log(`  ${methodColor(route.method)}  ${route.path.padEnd(pathWidth)}  ${mw}`)
        }
      }

      // ── Vike page routes ─────────────────────────────────
      if (vikeRoutes.length > 0) {
        console.log('\n  \x1b[1mPage Routes\x1b[0m  \x1b[2m(Vike filesystem routing)\x1b[0m')
        console.log(`  ${'GET'.padEnd(9)}  ${'PATH'.padEnd(pathWidth)}  SOURCE`)
        console.log(`  ${'─'.repeat(9)}  ${'─'.repeat(pathWidth)}  ${'─'.repeat(mwWidth)}`)
        for (const { route, dir } of vikeRoutes) {
          console.log(`  \x1b[32mGET    \x1b[0m  ${route.padEnd(pathWidth)}  pages/${dir}`)
        }
      }

      if (apiRoutes.length === 0 && vikeRoutes.length === 0) {
        console.log('No routes registered.')
      }

      console.log()
    })

  // Inline commands (artisan.command())
  for (const cmd of artisan.getCommands()) {
    program
      .command(cmd.name)
      .description(cmd.getDescription())
      .allowUnknownOption()
      .action(async (...comArgs: unknown[]) => {
        const commanderCmd = comArgs[comArgs.length - 1] as { args: string[]; opts: () => Record<string, unknown> }
        await cmd.handler(commanderCmd.args, commanderCmd.opts())
      })
  }

  // Class-based commands (artisan.register())
  for (const CommandClass of artisan.getClasses()) {
    const instance = new CommandClass()
    const { name, args, opts } = parseSignature(instance.signature)

    const sub = program.command(name).description(instance.description)

    for (const arg of args) {
      const token = arg.variadic
        ? `[${arg.name}...]`
        : arg.required
          ? `<${arg.name}>`
          : `[${arg.name}]`
      sub.argument(token, '', arg.defaultValue)
    }

    for (const opt of opts) {
      const flag = opt.shorthand
        ? `-${opt.shorthand}, --${opt.name}${opt.hasValue ? ' <value>' : ''}`
        : `--${opt.name}${opt.hasValue ? ' <value>' : ''}`
      sub.option(flag, '', opt.defaultValue)
    }

    sub.action(async (...comArgs: unknown[]) => {
      // Commander passes: arg0, arg1, ..., CommandInstance
      const commanderCmd = comArgs[comArgs.length - 1] as { opts: () => Record<string, unknown> }
      const parsedArgs: Record<string, unknown> = {}
      args.forEach((a, i) => { parsedArgs[a.name] = comArgs[i] })
      const fresh = new CommandClass()
      fresh._setContext(parsedArgs, commanderCmd.opts())
      await fresh.handle()
    })
  }

  program.action(() => program.help())
  await program.parseAsync()
}

main().catch(console.error)
