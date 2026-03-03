import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

function stub(className: string): string {
  return `import { Middleware } from '@boostkit/middleware'
import type { ForgeRequest, ForgeResponse } from '@boostkit/contracts'

export class ${className} extends Middleware {
  async handle(
    req: ForgeRequest,
    res: ForgeResponse,
    next: () => Promise<void>
  ): Promise<void> {
    // TODO: implement middleware logic
    await next()
  }
}
`
}

export function makeMiddleware(program: Command): void {
  program
    .command('make:middleware <name>')
    .description('Create a new middleware class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name.endsWith('Middleware') ? name : `${name}Middleware`
      const relPath   = `app/Http/Middleware/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        process.exit(1)
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className))

      console.log(chalk.green('  ✔ Middleware created:'), chalk.cyan(relPath))
    })
}
