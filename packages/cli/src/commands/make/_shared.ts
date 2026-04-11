import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

export interface MakeSpec {
  /** Commander command name, e.g. `make:controller` */
  command:     string
  /** Human description shown in help */
  description: string
  /** Label after the success checkmark, e.g. `Controller created` */
  label:       string
  /** Suffix appended to the class name if not already present */
  suffix?:     string
  /** Destination directory under the app root, e.g. `app/Http/Controllers` */
  directory:   string
  /** Stub generator — receives the normalized class name */
  stub:        (className: string) => string
  /** Optional hook printed after the success line */
  afterCreate?: (className: string, relPath: string) => void
}

export function registerMake(program: Command, spec: MakeSpec): void {
  program
    .command(`${spec.command} <name>`)
    .description(spec.description)
    .option('-f, --force', 'Overwrite if file already exists')
    .action(async (name: string, opts: { force?: boolean }) => {
      const className = spec.suffix && !name.endsWith(spec.suffix)
        ? `${name}${spec.suffix}`
        : name
      const relPath = `${spec.directory}/${className}.ts`
      const outPath = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts.force) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        return
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, spec.stub(className))

      console.log(chalk.green(`  ✔ ${spec.label}:`), chalk.cyan(relPath))
      spec.afterCreate?.(className, relPath)
    })
}
