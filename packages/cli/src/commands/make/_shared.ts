import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname, sep, relative, isAbsolute } from 'node:path'
import type { Command } from 'commander'
import chalk from 'chalk'
import { featureStub, unitStub } from './test-stubs.js'

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
  /**
   * Enables `--with-test`: also write `tests/<ClassName>.test.ts` alongside
   * the scaffolded file. `'feature'` boots the app via `AppTestCase` (HTTP —
   * the right shape for controllers); `'unit'` is plain node:test with no
   * boot. Omit to not offer the flag (e.g. `make:test` itself).
   */
  testKind?:   'feature' | 'unit'
  /** Optional extra flags this command exposes (rendered in --help). */
  extraOptions?: ExtraOption[]
  /** Optional hook printed after the success line. Receives all parsed opts. */
  afterCreate?: (className: string, relPath: string, opts: Record<string, unknown>) => void | Promise<void>
}

/**
 * Write the companion test file for `--with-test`. Same atomic `wx`/`--force`
 * semantics as the main file, but an existing test never fails the command —
 * the scaffolded file already landed, so just say why the test didn't.
 */
async function writeCompanionTest(
  className: string,
  sourceRel: string,
  testKind: 'feature' | 'unit',
  force: boolean,
): Promise<void> {
  const relPath = `tests/${className}.test.ts`
  const outPath = resolve(process.cwd(), relPath)
  const content = testKind === 'feature' ? featureStub(className, sourceRel) : unitStub(className, sourceRel)

  await mkdir(dirname(outPath), { recursive: true })
  try {
    await writeFile(outPath, content, { flag: force ? 'w' : 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      console.error(chalk.red(`  ✗ Test already exists: ${relPath}`))
      console.error(chalk.dim('    Use --force to overwrite.'))
      return
    }
    throw err
  }

  console.log(chalk.green('  ✔ Test created:'), chalk.cyan(relPath))
  // Feature tests assume the documented tests/TestCase.ts convention.
  if (testKind === 'feature' && !existsSync(resolve(process.cwd(), 'tests', 'TestCase.ts'))) {
    console.log(chalk.yellow('    ! tests/TestCase.ts is missing — see docs/guide/testing.md for the setup snippet.'))
  }
}

export function registerMake(program: Command, spec: MakeSpec): void {
  let cmd = program
    .command(`${spec.command} <name>`)
    .description(spec.description)
    .option('-f, --force', 'Overwrite if file already exists')

  if (spec.testKind) {
    const shape = spec.testKind === 'feature' ? 'feature test (AppTestCase + HTTP)' : 'unit test (plain node:test)'
    cmd = cmd.option('-t, --with-test', `Also create tests/<Name>.test.ts as a ${shape}`)
  }

  for (const extra of spec.extraOptions ?? []) {
    cmd = cmd.option(extra.flags, extra.description)
  }

  cmd.action(async (name: string, opts: Record<string, unknown>) => {
      const className = spec.suffix && !name.endsWith(spec.suffix)
        ? `${name}${spec.suffix}`
        : name
      const relPath = `${spec.directory}/${className}.ts`
      const outPath = resolve(process.cwd(), relPath)

      // Containment guard: a name like `../../../etc/foo` resolves outside the
      // spec's target directory, and `mkdir({recursive})` + write would happily
      // create it — an arbitrary-file-write vector when the name is untrusted.
      // (The companion test file is only written after the main file lands, so
      // blocking here covers it too.) Nested names like `Admin/User` stay valid.
      const baseDir = resolve(process.cwd(), spec.directory)
      const relFromBase = relative(baseDir, outPath)
      if (relFromBase === '..' || relFromBase.startsWith(`..${sep}`) || isAbsolute(relFromBase)) {
        console.error(chalk.red(`  ✗ Invalid name "${name}": the resolved path escapes ${spec.directory}.`))
        return
      }

      await mkdir(dirname(outPath), { recursive: true })
      try {
        // Atomic create-or-overwrite: `wx` fails if the file already exists,
        // closing the check-then-write race; `--force` opts into truncating.
        await writeFile(outPath, spec.stub(className, opts), { flag: opts['force'] ? 'w' : 'wx' })
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          console.error(chalk.red(`  ✗ Already exists: ${relPath}`))
          console.error(chalk.dim('    Use --force to overwrite.'))
          return
        }
        throw err
      }

      console.log(chalk.green(`  ✔ ${spec.label}:`), chalk.cyan(relPath))

      if (spec.testKind && opts['withTest']) {
        await writeCompanionTest(className, relPath, spec.testKind, Boolean(opts['force']))
      }

      await spec.afterCreate?.(className, relPath, opts)
    })
}
