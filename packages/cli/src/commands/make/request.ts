import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

export function stub(className: string): string {
  return `import { FormRequest, z } from '@boostkit/core'

export class ${className} extends FormRequest {
  authorize(): boolean {
    return true
  }

  rules() {
    return z.object({
      // TODO: define validation rules
    })
  }
}
`
}

export function makeRequest(program: Command): void {
  program
    .command('make:request <name>')
    .description('Create a new form request class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name.endsWith('Request') ? name : `${name}Request`
      const relPath   = `app/Http/Requests/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        return
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className))

      console.log(chalk.green('  ✔ Request created:'), chalk.cyan(relPath))
    })
}
