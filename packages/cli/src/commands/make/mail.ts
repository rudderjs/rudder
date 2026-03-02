import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

function stub(className: string): string {
  return `import { Mailable } from '@forge/mail'

export class ${className} extends Mailable {
  constructor(/* inject data here */) {
    super()
  }

  build(): this {
    return this
      .subject('Your subject here')
      .html('<p>Your HTML content here</p>')
      .text('Your plain text content here')
  }
}
`
}

export function makeMail(program: Command): void {
  program
    .command('make:mail <name>')
    .description('Create a new mailable class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name
      const relPath   = `app/Mail/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        process.exit(1)
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className))

      console.log(chalk.green('  ✔ Mailable created:'), chalk.cyan(relPath))
    })
}
