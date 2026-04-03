import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

export function stub(className: string, prefix: string): string {
  return `import { Controller, Get } from '@rudderjs/router'
import type { Context } from '@rudderjs/core'

@Controller('${prefix}')
export class ${className} {
  @Get('/')
  async index(_ctx: Context) {
    return []
  }
}
`
}

export function derivePrefix(className: string): string {
  const base = className.replace(/Controller$/, '')
  // PascalCase → kebab-case, then pluralise
  const kebab = base
    .replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `-${l}`))
    .toLowerCase()
  return `/${kebab}s`
}

export function makeController(program: Command): void {
  program
    .command('make:controller <name>')
    .description('Create a new controller class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name.endsWith('Controller') ? name : `${name}Controller`
      const prefix    = derivePrefix(className)
      const relPath   = `app/Http/Controllers/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        return
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className, prefix))

      console.log(chalk.green('  ✔ Controller created:'), chalk.cyan(relPath))
    })
}
