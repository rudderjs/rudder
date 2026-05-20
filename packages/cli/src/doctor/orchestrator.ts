import type { DoctorCheck, DoctorResult, DoctorStatus } from '@rudderjs/console'
import { getRegisteredChecks } from '@rudderjs/console'

export interface CheckOutcome {
  id:       string
  category: string
  title:    string
  status:   DoctorStatus
  message:  string
  fix?:     string
  detail?:  string
  /** Wall-clock ms for the check's `run()`. */
  durationMs: number
}

export interface RunOptions {
  /** If true, include checks marked `needsBoot: true`. */
  deep?:    boolean
  /** Filter checks by id substring (used by `--only` flag in future). */
  filter?:  string
}

export interface RunResult {
  outcomes: CheckOutcome[]
  totalMs:  number
  counts:   { ok: number; warn: number; error: number }
}

/**
 * Run a single check. Thrown errors are caught and reported as red outcomes
 * with the message `unhandled exception: <e.message>` so a single buggy check
 * never crashes the doctor command itself.
 */
async function runOne(check: DoctorCheck): Promise<CheckOutcome> {
  const t0 = performance.now()
  let result: DoctorResult
  try {
    result = await check.run()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    result = { status: 'error', message: `unhandled exception: ${msg}` }
  }
  const outcome: CheckOutcome = {
    id:         check.id,
    category:   check.category,
    title:      check.title,
    status:     result.status,
    message:    result.message,
    durationMs: performance.now() - t0,
  }
  if (result.fix    !== undefined) outcome.fix    = result.fix
  if (result.detail !== undefined) outcome.detail = result.detail
  return outcome
}

/**
 * Collect every registered check, filter by `deep` / `filter`, run them
 * concurrently within each category (categories run sequentially so the
 * report renders in declared order).
 */
export async function runChecks(opts: RunOptions = {}): Promise<RunResult> {
  const t0 = performance.now()

  const all = getRegisteredChecks().filter(c => {
    if (!opts.deep && c.needsBoot) return false
    // --only <substring> matches EITHER id OR category — `--only orm`
    // catches `orm-prisma:db-connect` AND `orm-drizzle:schema`; `--only runtime`
    // catches every `category: 'runtime'` check regardless of its package prefix.
    if (opts.filter && !c.id.includes(opts.filter) && !c.category.includes(opts.filter)) return false
    return true
  })

  // Group by category preserving first-seen order
  const byCat = new Map<string, DoctorCheck[]>()
  for (const c of all) {
    const list = byCat.get(c.category) ?? []
    list.push(c)
    byCat.set(c.category, list)
  }

  const outcomes: CheckOutcome[] = []
  for (const [, checks] of byCat) {
    const results = await Promise.all(checks.map(runOne))
    outcomes.push(...results)
  }

  const counts = { ok: 0, warn: 0, error: 0 }
  for (const o of outcomes) counts[o.status]++

  return { outcomes, totalMs: performance.now() - t0, counts }
}
