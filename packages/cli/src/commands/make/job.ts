import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

function stub(className: string): string {
  return `import { Job } from '@boostkit/queue'

export class ${className} extends Job {
  static queue   = 'default'
  static retries = 3

  constructor(/* inject payload here */) {
    super()
  }

  async handle(): Promise<void> {
    // TODO: implement job logic
  }
}
`
}

export function makeJob(program: Command): void {
  program
    .command('make:job <name>')
    .description('Create a new queue job class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name
      const relPath   = `app/Jobs/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        process.exit(1)
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className))

      console.log(chalk.green('  ✔ Job created:'), chalk.cyan(relPath))
    })
}
