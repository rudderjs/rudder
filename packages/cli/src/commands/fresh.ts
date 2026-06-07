import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import chalk from 'chalk'
import { clearFrameworkCaches, reportClearResults } from './optimize-clear.js'

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

/** Detect PM from npm_config_user_agent (set by every modern PM). Falls back to pnpm. */
function detectPackageManager(): PackageManager {
  const ua = process.env['npm_config_user_agent'] ?? ''
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('bun'))  return 'bun'
  if (ua.startsWith('npm'))  return 'npm'
  return 'pnpm'
}

/** Run `<pm> rudder <args>` inheriting stdio; resolves with the exit code. */
function runRudder(pm: PackageManager, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pm, [...(pm === 'npm' ? ['exec'] : []), 'rudder', ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true, // Windows: pm executables are .cmd shims
    })
    proc.on('close', code => resolve(code ?? 1))
    proc.on('error', reject)
  })
}

/**
 * `rudder fresh` — one-command dev reset. A thin composite over commands that
 * each work standalone:
 *
 *   1. `migrate:fresh [--seed]` — drop all tables, re-run migrations
 *      (seeding stays opt-in, matching Laravel's `migrate:fresh --seed`)
 *   2. `cache:clear` — flush the application cache store, so nothing cached
 *      against the old data survives the wipe (best-effort: skipped when no
 *      cache store is installed)
 *   3. framework filesystem caches (same set as `optimize:clear`)
 *
 * Skip-boot orchestrator: each step that needs the app boots its own child
 * process, so `fresh` itself never holds connections to the database it is
 * about to drop.
 */
export function freshCommand(program: Command): void {
  program
    .command('fresh')
    .description('Reset the dev environment: drop + re-migrate the database, flush caches')
    .option('--seed', 'Run the database seeder after migrating')
    .action(async (opts: { seed?: boolean }) => {
      const pm = detectPackageManager()

      // 1. Database — abort on failure, nothing else is worth doing on a
      // half-reset schema.
      console.log(chalk.bold('\n  Resetting database…'))
      const migrateArgs = ['migrate:fresh', ...(opts.seed ? ['--seed'] : [])]
      const migrateCode = await runRudder(pm, migrateArgs)
      if (migrateCode !== 0) {
        console.error(chalk.red(`\n  ✗ migrate:fresh failed (exit ${migrateCode}) — aborting before touching caches.`))
        process.exitCode = migrateCode
        return
      }

      // 2. Application cache store — stale entries referencing dropped rows
      // are the classic post-reset footgun. Best-effort: not every app has a
      // cache store installed.
      console.log(chalk.bold('\n  Flushing cache store…'))
      const cacheCode = await runRudder(pm, ['cache:clear'])
      if (cacheCode !== 0) {
        console.log(chalk.dim('  - cache:clear skipped (no cache store installed?)'))
      }

      // 3. Framework filesystem caches
      console.log(chalk.bold('\n  Clearing framework caches…'))
      reportClearResults(clearFrameworkCaches(process.cwd()))

      console.log(chalk.green('\n  ✔ Fresh environment ready.\n'))
    })
}
