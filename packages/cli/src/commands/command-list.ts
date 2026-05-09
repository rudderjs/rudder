import type { Command as CommanderCommand } from 'commander'
import { rudder, parseSignature } from '@rudderjs/console'

const C = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
}

interface ListedCommand {
  name:        string
  description: string
  source:      'inline' | 'class' | 'builtin'
  args?:       Array<{ name: string; required: boolean; variadic: boolean; description?: string }>
  options?:    Array<{ flags: string; description: string }>
}

function collectUserCommands(): ListedCommand[] {
  const out: ListedCommand[] = []

  for (const cmd of rudder.getCommands()) {
    out.push({ name: cmd.name, description: cmd.getDescription(), source: 'inline' })
  }

  for (const CommandClass of rudder.getClasses()) {
    const instance = new CommandClass()
    const { name, args, opts } = parseSignature(instance.signature)
    const entry: ListedCommand = { name, description: instance.description, source: 'class' }
    if (args.length > 0) {
      entry.args = args.map(a => {
        const out: { name: string; required: boolean; variadic: boolean; description?: string } = {
          name: a.name, required: a.required, variadic: a.variadic,
        }
        if (a.description) out.description = a.description
        return out
      })
    }
    if (opts.length > 0) {
      entry.options = opts.map(o => ({
        flags: o.shorthand
          ? `-${o.shorthand}, --${o.name}${o.hasValue ? ' <value>' : ''}`
          : `--${o.name}${o.hasValue ? ' <value>' : ''}`,
        description: o.description ?? '',
      }))
    }
    out.push(entry)
  }

  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function collectAllCommands(program: CommanderCommand): ListedCommand[] {
  const userNames = new Set<string>()
  const user = collectUserCommands()
  for (const c of user) userNames.add(c.name)

  const builtin: ListedCommand[] = []
  for (const c of program.commands) {
    if (c.name() === 'help') continue
    if (userNames.has(c.name())) continue
    const entry: ListedCommand = { name: c.name(), description: c.description(), source: 'builtin' }
    const args = c.registeredArguments
    if (args && args.length > 0) {
      entry.args = args.map(a => {
        const out: { name: string; required: boolean; variadic: boolean; description?: string } = {
          name: a.name(), required: a.required, variadic: a.variadic,
        }
        if (a.description) out.description = a.description
        return out
      })
    }
    const opts = c.options
    if (opts && opts.length > 0) {
      entry.options = opts.map(o => ({ flags: o.flags, description: o.description }))
    }
    builtin.push(entry)
  }

  return [...user, ...builtin].sort((a, b) => a.name.localeCompare(b.name))
}

function printCommands(cmds: ListedCommand[], heading: string): void {
  if (cmds.length === 0) {
    console.log(`\n  No ${heading.toLowerCase()}. Define them in routes/console.ts.\n`)
    return
  }

  // Group by namespace (the part before ':')
  const root:   ListedCommand[] = []
  const groups: Record<string, ListedCommand[]> = {}
  for (const c of cmds) {
    if (!c.name.includes(':')) { root.push(c); continue }
    const ns = c.name.split(':')[0] ?? c.name
    groups[ns] = [...(groups[ns] ?? []), c]
  }

  const nameWidth = Math.max(...cmds.map(c => c.name.length), 8) + 4

  console.log(`\n  ${C.bold(heading)}  ${C.dim(`(${cmds.length})`)}\n`)

  for (const c of root) {
    console.log(`  ${C.green(c.name.padEnd(nameWidth))}  ${c.description}  ${C.dim(`[${c.source}]`)}`)
  }

  for (const [ns, items] of Object.entries(groups).sort()) {
    console.log(`\n ${C.dim(ns)}`)
    for (const c of items) {
      console.log(`  ${C.green(c.name.padEnd(nameWidth))}  ${c.description}  ${C.dim(`[${c.source}]`)}`)
    }
  }

  console.log()
}

export function commandListCommand(program: CommanderCommand): void {
  program
    .command('command:list')
    .description('List registered Rudder commands grouped by namespace')
    .option('--all', 'Include built-in framework + package commands (not just user-registered)')
    .option('--json', 'Emit machine-readable JSON to stdout (for AI agents and scripting)')
    .action((opts: { all?: boolean; json?: boolean }) => {
      const cmds = opts.all ? collectAllCommands(program) : collectUserCommands()
      if (opts.json) {
        const bootError = (globalThis as Record<string, unknown>)['__rudderjs_cli_boot_error__']
        const payload = bootError
          ? { commands: cmds, bootError }
          : { commands: cmds }
        process.stdout.write(JSON.stringify(payload))
        return
      }
      printCommands(cmds, opts.all ? 'All commands' : 'Registered commands')
    })
}
