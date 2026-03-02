import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

function stub(className: string): string {
  return `export class ${className} {
  constructor(
    // public readonly userId: string,
  ) {}
}
`
}

export function makeEvent(program: Command): void {
  program
    .command('make:event <name>')
    .description('Create a new event class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name
      const relPath   = `app/Events/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        process.exit(1)
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className))

      console.log(chalk.green('  ✔ Event created:'), chalk.cyan(relPath))
    })
}
