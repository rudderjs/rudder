import type { DoctorCheck, DoctorResult } from '@rudderjs/console'
import { getRegisteredChecks } from '@rudderjs/console'
import type { CheckOutcome } from './orchestrator.js'

export interface FixOutcome {
  id:       string
  title:    string
  /** Status of the check *before* the fixer ran. */
  before:   CheckOutcome['status']
  /** Status of the check *after* the fixer ran. */
  after:    DoctorResult['status']
  /** Did the user skip (declined the prompt)? */
  skipped:  boolean
  /** Fixer's own message ("ran prisma generate", "vendored 4 files", …). */
  message:  string
  /** If the fixer itself threw, the captured error. */
  error?:   string
  durationMs: number
}

export interface FixOptions {
  /** Skip prompts — assume yes. */
  yes?: boolean
  /** Override the prompt for tests. Returns true → run, false → skip. */
  prompt?: (check: DoctorCheck, outcome: CheckOutcome) => Promise<boolean> | boolean
}

export interface FixResult {
  outcomes:  FixOutcome[]
  /** How many fixers were eligible (failing + has fixer). */
  eligible:  number
  /** How many fixers actually ran (not skipped). */
  applied:   number
}

/**
 * Iterate outcomes from a fast-path doctor run, and for every failing check
 * that declares a `fixer()`, prompt the user (unless `yes` is set) and run it.
 *
 * Fixers must be idempotent regenerate-style operations — a fixer that throws
 * is caught and reported as a red fix outcome; doctor itself never crashes.
 */
export async function applyFixes(
  outcomes: CheckOutcome[],
  opts:     FixOptions = {},
): Promise<FixResult> {
  // Build an id → check map so we can find each fixer by outcome id.
  const byId = new Map<string, DoctorCheck>()
  for (const c of getRegisteredChecks()) byId.set(c.id, c)

  // Eligible = failed (warn|error) AND check declares a fixer.
  const eligible = outcomes.filter(o => o.status !== 'ok' && byId.get(o.id)?.fixer)

  if (eligible.length === 0) {
    return { outcomes: [], eligible: 0, applied: 0 }
  }

  const promptFn = opts.prompt ?? (opts.yes ? () => true : defaultPrompt)
  const fixOutcomes: FixOutcome[] = []
  let applied = 0

  for (const outcome of eligible) {
    const check = byId.get(outcome.id)!
    const fixer = check.fixer!

    const accepted = await promptFn(check, outcome)
    if (!accepted) {
      fixOutcomes.push({
        id:         outcome.id,
        title:      outcome.title,
        before:     outcome.status,
        after:      outcome.status,
        skipped:    true,
        message:    'skipped',
        durationMs: 0,
      })
      continue
    }

    const t0 = performance.now()
    let result: DoctorResult
    let error: string | undefined
    try {
      result = await fixer()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      result = { status: 'error', message: `fixer threw: ${msg}` }
      error  = msg
    }
    applied++
    const fo: FixOutcome = {
      id:         outcome.id,
      title:      outcome.title,
      before:     outcome.status,
      after:      result.status,
      skipped:    false,
      message:    result.message,
      durationMs: performance.now() - t0,
    }
    if (error) fo.error = error
    fixOutcomes.push(fo)
  }

  return { outcomes: fixOutcomes, eligible: eligible.length, applied }
}

/**
 * Default interactive prompt — uses @clack/prompts. Lazy-imported so the
 * test path can pass `prompt: () => true/false` without pulling clack into
 * the test process at all.
 */
async function defaultPrompt(check: DoctorCheck, outcome: CheckOutcome): Promise<boolean> {
  const { confirm, isCancel } = await import('@clack/prompts')
  const result = await confirm({
    message:      `Apply fix for ${check.title}? (${outcome.message})`,
    initialValue: true,
  })
  if (isCancel(result)) return false
  return result === true
}
