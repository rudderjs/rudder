import type { Command as CommanderCommand } from 'commander'
import { runChecks } from '../doctor/orchestrator.js'
import { renderReport, exitCodeFor } from '../doctor/reporter.js'
import { loadPackageChecks } from '../doctor/load-package-checks.js'
import { loadBuiltInChecks } from '../doctor/built-in/index.js'
import { setBootStatus } from '../doctor/boot-status.js'

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
    .option('--deep',    'Also run checks that require booting the app (DB connect, port, …)')
    .option('--fix',     'Auto-apply safe fixes for any failures that declare a fixer')
    .option('--verbose', 'Show detail block under each check (not just failures)')
    .option('--json',    'Reserved for a future machine-readable output mode')
    .option('--only <substring>', 'Only run checks whose id contains <substring>')
    .action(async (opts: {
      deep?: boolean; fix?: boolean; verbose?: boolean; json?: boolean; only?: string
    }) => {
      if (opts.json) {
        console.error('rudder doctor: --json is reserved for a future release (v1 has no JSON output).')
        process.exit(2)
      }
      if (opts.fix) {
        console.error('rudder doctor: --fix is not implemented yet (lands in Phase 5).')
        process.exit(2)
      }

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

      const runOpts: { deep?: boolean; filter?: string } = {}
      if (opts.deep)               runOpts.deep   = true
      if (opts.only !== undefined) runOpts.filter = opts.only
      const result = await runChecks(runOpts)
      const reportOpts: { verbose?: boolean } = {}
      if (opts.verbose) reportOpts.verbose = true
      console.log(renderReport(result, reportOpts))
      process.exit(exitCodeFor(result))
    })
}
