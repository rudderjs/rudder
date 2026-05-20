import type { Command as CommanderCommand } from 'commander'
import { runChecks } from '../doctor/orchestrator.js'
import { renderReport, exitCodeFor } from '../doctor/reporter.js'
import { loadPackageChecks } from '../doctor/load-package-checks.js'
import { loadBuiltInChecks } from '../doctor/built-in/index.js'

export function doctorCommand(program: CommanderCommand): void {
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
      if (opts.deep) {
        console.error('rudder doctor: --deep is not implemented yet (lands in Phase 4).')
        process.exit(2)
      }

      // Built-in CLI-owned checks (env, structure, deps) — registered eagerly
      // via side-effect imports so they're present even if no framework package
      // contributed any.
      loadBuiltInChecks()

      // Lazy-load package-contributed checks. Phase 1 has none — Phase 3 wires
      // packages into PACKAGES_WITH_CHECKS.
      await loadPackageChecks()

      const runOpts: { deep?: boolean; filter?: string } = {}
      if (opts.deep)         runOpts.deep   = true
      if (opts.only !== undefined) runOpts.filter = opts.only
      const result = await runChecks(runOpts)
      const reportOpts: { verbose?: boolean } = {}
      if (opts.verbose) reportOpts.verbose = true
      console.log(renderReport(result, reportOpts))
      process.exit(exitCodeFor(result))
    })
}
