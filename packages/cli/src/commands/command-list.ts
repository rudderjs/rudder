import type { Command as CommanderCommand } from 'commander'
import { rudder, parseSignature } from '@rudderjs/rudder'

const C = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
}

interface UserCommand {
  name:        string
  description: string
  source:      'inline' | 'class'
}

function collectUserCommands(): UserCommand[] {
  const out: UserCommand[] = []

  for (const cmd of rudder.getCommands()) {
    out.push({ name: cmd.name, description: cmd.getDescription(), source: 'inline' })
  }

  for (const CommandClass of rudder.getClasses()) {
    const instance = new CommandClass()
    const { name } = parseSignature(instance.signature)
    out.push({ name, description: instance.description, source: 'class' })
  }

  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function printCommands(cmds: UserCommand[]): void {
  if (cmds.length === 0) {
    console.log('\n  No user-registered commands. Define them in routes/console.ts.\n')
    return
  }

  // Group by namespace (the part before ':')
  const root:   UserCommand[] = []
  const groups: Record<string, UserCommand[]> = {}
  for (const c of cmds) {
    if (!c.name.includes(':')) { root.push(c); continue }
    const ns = c.name.split(':')[0] ?? c.name
    groups[ns] = [...(groups[ns] ?? []), c]
  }

  const nameWidth = Math.max(...cmds.map(c => c.name.length), 8) + 4

  console.log(`\n  ${C.bold('Registered commands')}  ${C.dim(`(${cmds.length})`)}\n`)

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
    .description('List all user-registered Rudder commands grouped by namespace')
    .action(() => {
      printCommands(collectUserCommands())
    })
}
