/**
 * Built-in doctor checks owned by `@rudderjs/cli`. Each module's side-effect
 * import calls `registerDoctorCheck()` so the checks are visible to the
 * orchestrator after `loadBuiltInChecks()` runs.
 */
import './node-version.js'
import './package-manager.js'
import './env-vars.js'
import './structure.js'
import './deps.js'
import './runtime.js'

export function loadBuiltInChecks(): void {
  // Module loading is sufficient — side-effect imports above call
  // registerDoctorCheck() at module-init time. This function exists so the
  // doctor command can force the imports (otherwise tree-shaking would
  // drop them).
}
