import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

function stub(className: string, table: string): string {
  return `import { Model } from '@boostkit/orm'

export class ${className} extends Model {
  static table = '${table}'

  static fillable: string[] = []

  static hidden: string[] = []
}
`
}

function deriveTable(className: string): string {
  // PascalCase → snake_case, then pluralise
  return (
    className
      .replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `_${l}`))
      .toLowerCase() + 's'
  )
}

export function makeModel(program: Command): void {
  program
    .command('make:model <name>')
    .description('Create a new ORM model class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name
      const table     = deriveTable(className)
      const relPath   = `app/Models/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        process.exit(1)
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className, table))

      console.log(chalk.green('  ✔ Model created:'), chalk.cyan(relPath))
    })
}
