import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

export function stub(className: string): string {
  return `import { Agent } from '@rudderjs/ai'
import type { HasTools, AnyTool } from '@rudderjs/ai'

export class ${className} extends Agent implements HasTools {
  instructions(): string {
    return 'You are a helpful assistant.'
  }

  // model(): string | undefined { return 'anthropic/claude-sonnet-4-5' }

  tools(): AnyTool[] {
    return []
  }
}
`
}

export function makeAgent(program: Command): void {
  program
    .command('make:agent <name>')
    .description('Create a new AI agent class')
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = name.endsWith('Agent') ? name : `${name}Agent`
      const relPath   = `app/Agents/${className}.ts`
      const outPath   = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        return
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, stub(className))

      console.log(chalk.green('  ✔ Agent created:'), chalk.cyan(relPath))
    })
}
