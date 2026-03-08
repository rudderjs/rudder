import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

export function stub(className: string): string {
  return `import { ServiceProvider } from '@boostkit/core'

export class ${className} extends ServiceProvider {
  register(): void {
    // TODO: bind services into the container
    // this.app.singleton(MyService, () => new MyService())
  }

  async boot(): Promise<void> {
    // TODO: run logic after all providers are registered
  }
}
`
}

export function makeProvider(program: Command): void {
  program
    .command('make:provider <name>')
    .description('Create a new service provider class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name.endsWith('ServiceProvider') ? name : `${name}ServiceProvider`
      const relPath   = `app/Providers/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        return
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className))

      console.log(chalk.green('  ✔ Provider created:'), chalk.cyan(relPath))
    })
}
