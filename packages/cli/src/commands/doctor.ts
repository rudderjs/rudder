import type { Command as CommanderCommand } from 'commander'
import { loadDotenvForChecks } from '../doctor/load-dotenv.js'
import { runChecks } from '../doctor/orchestrator.js'
import { renderReport, renderFixReport, exitCodeFor } from '../doctor/reporter.js'
import { loadPackageChecks } from '../doctor/load-package-checks.js'
import { loadBuiltInChecks } from '../doctor/built-in/index.js'
import { setBootStatus } from '../doctor/boot-status.js'
import { applyFixes } from '../doctor/fixer.js'

export interface DoctorCommandDeps {
  /**
   * Inject the CLI's bootApp so the doctor command can boot the app under
   * `--deep`. Passed by reference rather than imported because the CLI's
   * bootApp suppresses console output (provider chatter is noise here too)
   * and the doctor command shouldn't reimplement that.
   */
  bootApp: () => Promise<void>
}

export function doctorCommand(program: CommanderCommand, deps: DoctorCommandDeps): void {
  program
    .command('doctor')
    .description('Diagnose common setup issues in a RudderJS app')
    .option('--deep',       'Also run checks that require booting the app (DB connect, port, …)')
    .option('--production', 'Also run prod-readiness checks (APP_DEBUG=false, DATABASE_URL not localhost, …)')
    .option('--fix',        'Auto-apply safe fixes for any failures that declare a fixer')
    .option('--yes',        'Skip fix-mode prompts and apply every fixable failure')
    .option('--verbose',    'Show detail block under each check (not just failures)')
    .option('--json',       'Reserved for a future machine-readable output mode')
    .option('--only <substring>', 'Only run checks whose id contains <substring>')
    .action(async (opts: {
      deep?: boolean; production?: boolean; fix?: boolean; yes?: boolean
      verbose?: boolean; json?: boolean; only?: string
    }) => {
      if (opts.json) {
        console.error('rudder doctor: --json is reserved for a future release (v1 has no JSON output).')
        process.exit(2)
      }

      // Load `.env` so env-var checks reflect runtime. The fast-path `doctor` is
      // skip-boot, so the app's `import 'dotenv/config'` never runs; without this,
      // vars defined in `.env` (AUTH_SECRET, DATABASE_URL, …) falsely read as unset.
      // cwd is the app root by now (the CLI chdir's there during app discovery).
      loadDotenvForChecks()

      // Built-in CLI-owned checks (env, structure, deps, runtime) — registered
      // eagerly via side-effect imports so they're present even if no framework
      // package contributed any.
      loadBuiltInChecks()

      // Lazy-load package-contributed checks.
      await loadPackageChecks()

      // --deep boots the app once so runtime checks can interrogate the live
      // DI container (DB client, queue connection, mail transport, etc.).
      // Boot failure is captured as a check result, not a crash — the rest
      // of the runtime suite then short-circuits to skipped, but the user
      // still sees the boot error verbatim with the failing provider.
      if (opts.deep) {
        const t0 = performance.now()
        try {
          await deps.bootApp()
          setBootStatus({ ok: true, durationMs: performance.now() - t0 })
        } catch (e) {
          setBootStatus({
            ok:    false,
            error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
            durationMs: performance.now() - t0,
          })
        }
      }

      const runOpts: { deep?: boolean; production?: boolean; filter?: string } = {}
      if (opts.deep)               runOpts.deep       = true
      if (opts.production)         runOpts.production = true
      if (opts.only !== undefined) runOpts.filter     = opts.only

      const reportOpts: { verbose?: boolean } = {}
      if (opts.verbose) reportOpts.verbose = true

      // First pass — surface every failure to the user before touching anything.
      const result = await runChecks(runOpts)
      console.log(renderReport(result, reportOpts))

      if (!opts.fix) {
        process.exit(exitCodeFor(result))
      }

      // ── --fix path ──────────────────────────────────────
      // Only fixable checks (warn/error with a fixer) are eligible. Prompt
      // each unless --yes; never modify .env or package.json — fixers are
      // idempotent regenerate-style operations only.
      const fixOpts: { yes?: boolean } = {}
      if (opts.yes) fixOpts.yes = true
      const fixResult = await applyFixes(result.outcomes, fixOpts)

      console.log('')
      console.log(renderFixReport(fixResult, reportOpts))

      // Second pass — confirm the fixers actually resolved the issues so
      // the user doesn't have to eyeball it. Same runOpts so deep/only flags
      // carry through.
      if (fixResult.applied > 0) {
        console.log('')
        const second = await runChecks(runOpts)
        console.log(renderReport(second, reportOpts))
        process.exit(exitCodeFor(second))
      }
      process.exit(exitCodeFor(result))
    })
}
