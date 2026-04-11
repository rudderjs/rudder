import type { Command } from 'commander'
import chalk from 'chalk'
import { registerMake } from './_shared.js'

export function stub(name: string): string {
  // Convert PascalCase to kebab:case for default signature, e.g. SendEmails → send:emails
  const kebab = name
    .replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `-${l}`))
    .toLowerCase()

  return `import { Command } from '@rudderjs/rudder'

export class ${name} extends Command {
  readonly signature   = '${kebab} {--force : Force the operation}'
  readonly description = 'Description of ${name}'

  async handle(): Promise<void> {
    this.info('Running ${name}...')

    const force = this.option('force')
    if (force) this.comment('  Force flag is set')

    // TODO: implement

    this.info('Done.')
  }
}
`
}

export function makeCommandCmd(program: Command): void {
  registerMake(program, {
    command:     'make:command',
    description: 'Create a new rudder command class',
    label:       'Command created',
    directory:   'app/Commands',
    stub,
    afterCreate: (className) => {
      console.log(chalk.dim(`    Register it in routes/console.ts:  rudder.register(${className})`))
    },
  })
}
