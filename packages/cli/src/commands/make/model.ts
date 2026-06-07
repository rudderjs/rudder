import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import chalk from 'chalk'
import { registerMake } from './_shared.js'

export function stub(className: string, table: string): string {
  return `import { Model } from '@rudderjs/orm'

export class ${className} extends Model {
  static table = '${table}'

  static fillable: string[] = []

  static hidden: string[] = []
}
`
}

export function deriveTable(className: string): string {
  // PascalCase → snake_case, then pluralise
  return (
    className
      .replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `_${l}`))
      .toLowerCase() + 's'
  )
}

/** Run `pnpm rudder make:migration <name>` and inherit stdio. */
function runMakeMigration(migrationName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['rudder', 'make:migration', migrationName], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true,
    })
    proc.on('close', code => resolve(code ?? 1))
    proc.on('error', reject)
  })
}

export function makeModel(program: Command): void {
  registerMake(program, {
    command:     'make:model',
    description: 'Create a new ORM model class',
    label:       'Model created',
    directory:   'app/Models',
    testKind:    'unit',
    stub:        (className) => stub(className, deriveTable(className)),
    extraOptions: [
      { flags: '-m, --migration', description: 'Also create a migration file for the model' },
    ],
    afterCreate: async (className, _relPath, opts) => {
      if (!opts['migration']) return
      const migrationName = `create_${deriveTable(className)}_table`
      console.log(chalk.dim(`  → Creating migration ${migrationName}…`))
      const code = await runMakeMigration(migrationName)
      if (code !== 0) {
        console.error(chalk.red(`  ✗ make:migration failed (exit ${code})`))
      }
    },
  })
}
