import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'

export interface ExtraOption {
  /** Flag string, e.g. `'-m, --migration'` */
  flags:       string
  /** Human description shown in --help */
  description: string
}

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
  /** Stub generator — receives the normalized class name and parsed CLI opts */
  stub:        (className: string, opts: Record<string, unknown>) => string
  /** Optional extra flags this command exposes (rendered in --help). */
  extraOptions?: ExtraOption[]
  /** Optional hook printed after the success line. Receives all parsed opts. */
  afterCreate?: (className: string, relPath: string, opts: Record<string, unknown>) => void | Promise<void>
}

export function registerMake(program: Command, spec: MakeSpec): void {
  let cmd = program
    .command(`${spec.command} <name>`)
    .description(spec.description)
    .option('-f, --force', 'Overwrite if file already exists')

  for (const extra of spec.extraOptions ?? []) {
    cmd = cmd.option(extra.flags, extra.description)
  }

  cmd.action(async (name: string, opts: Record<string, unknown>) => {
      const className = spec.suffix && !name.endsWith(spec.suffix)
        ? `${name}${spec.suffix}`
        : name
      const relPath = `${spec.directory}/${className}.ts`
      const outPath = resolve(process.cwd(), relPath)

      if (existsSync(outPath) && !opts['force']) {
        console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
        console.error(chalk.dim('    Use --force to overwrite.'))
        return
      }

      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, spec.stub(className, opts))

      console.log(chalk.green(`  ✔ ${spec.label}:`), chalk.cyan(relPath))
      await spec.afterCreate?.(className, relPath, opts)
    })
}
