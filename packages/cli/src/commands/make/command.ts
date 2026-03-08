import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import { log } from '@clack/prompts'

export function stub(name: string): string {
  // Convert PascalCase to kebab:case for default signature, e.g. SendEmails → send:emails
  const kebab = name
    .replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `-${l}`))
    .toLowerCase()

  return `import { Command } from '@boostkit/artisan'

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
  program
    .command('make:command <name>')
    .description('Create a new artisan command class')
    .option('-f, --force', 'Overwrite existing file')
    .action(async (name: string, opts: { force?: boolean }) => {
      const filePath = resolve(process.cwd(), `app/Commands/${name}.ts`)

      if (existsSync(filePath) && !opts.force) {
        log.error(`File already exists: app/Commands/${name}.ts\nUse --force to overwrite.`)
        return
      }

      await mkdir(resolve(process.cwd(), 'app/Commands'), { recursive: true })
      await writeFile(filePath, stub(name))
      log.success(`Created app/Commands/${name}.ts`)
      log.info(`Register it in routes/console.ts:\n  artisan.register(${name})`)
    })
}
