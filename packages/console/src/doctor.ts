// ─── Doctor registry ──────────────────────────────────────
//
// Shared registry for the `rudder doctor` command. Packages contribute
// health checks here at register-time (provider register() or a side-effect
// import from the package's `doctor` subpath); the CLI's doctor command
// collects them, runs them, and reports.
//
// Mirrors the shape of `rudder.command()` — singleton on globalThis so
// it survives Vite SSR module re-evaluation, idempotent registration with
// last-writer-wins semantics.

export type DoctorStatus = 'ok' | 'warn' | 'error'

export interface DoctorResult {
  status:  DoctorStatus
  /** One-line summary shown in the default report. */
  message: string
  /** Paste-able shell command (or instruction) that resolves the failure. */
  fix?:    string
  /** Multi-line context shown only with `--verbose`. */
  detail?: string
}

export interface DoctorCheck {
  /**
   * Stable id, conventionally `<package>:<rule>` (e.g. `cashier-paddle:webhook-secret`).
   * Re-registering the same id replaces the prior definition and emits a warning.
   */
  id:        string
  /**
   * Free-form category label used to group the report.
   * Built-in categories: `env`, `structure`, `deps`, `orm`, `runtime`.
   * Custom strings are allowed — they render as their own section.
   */
  category:  string
  /** Human label shown next to the status icon. */
  title:     string
  /**
   * If true, the check is only executed under `rudder doctor --deep` (after `bootApp()` runs).
   * Fast-path checks (the default) must work without booting the app.
   */
  needsBoot?: boolean
  run():      DoctorResult | Promise<DoctorResult>
  /**
   * Optional idempotent recovery — invoked under `rudder doctor --fix`.
   * Must be safe to run when the check is already passing (regenerate-style
   * operations only — never delete user files, never modify `.env` or
   * `package.json`).
   */
  fixer?:     () => DoctorResult | Promise<DoctorResult>
}

export class DoctorRegistry {
  private _checks = new Map<string, DoctorCheck>()

  register(check: DoctorCheck): void {
    if (this._checks.has(check.id)) {
      console.warn(`[RudderJS] doctor check '${check.id}' was already registered; the later definition overrides the earlier one.`)
    }
    this._checks.set(check.id, check)
  }

  all(): DoctorCheck[] {
    return [...this._checks.values()]
  }

  /** @internal — used in tests */
  reset(): void {
    this._checks.clear()
  }
}

// Singleton on globalThis so Vite's SSR module-graph re-eval doesn't fork
// the registry (same pattern as `rudder` / `commandObservers` above).
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_doctor__']) _g['__rudderjs_doctor__'] = new DoctorRegistry()

const _registry = _g['__rudderjs_doctor__'] as DoctorRegistry

export function registerDoctorCheck(check: DoctorCheck): void {
  _registry.register(check)
}

export function getRegisteredChecks(): DoctorCheck[] {
  return _registry.all()
}

/** @internal — exposed for tests */
export function resetDoctorRegistry(): void {
  _registry.reset()
}
