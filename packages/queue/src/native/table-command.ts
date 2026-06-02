// ─── `rudder queue:table` writer ───────────────────────────
//
// Stubs the jobs + failed_jobs migrations into the app's `database/migrations/`
// (Laravel's `make:queue-table` / `make:queue-failed-table`). Node-only — kept
// off the main entry's static graph and loaded dynamically by the command.

import { mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { jobsTableStub, failedJobsTableStub } from './migrations.js'

/** `YYYY_MM_DD_HHMMSS` — sorts chronologically, matching the migrator's
 *  filename ordering. `offset` seconds keeps the two files distinct + ordered. */
function timestamp(offsetSec = 0): string {
  const d = new Date(Date.now() + offsetSec * 1000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}_${p(d.getMonth() + 1)}_${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** Has a migration with this `<name>` suffix already been stubbed? Avoids
 *  duplicate `create_jobs_table` files on a re-run. */
function alreadyHas(dir: string, suffix: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.endsWith(`_${suffix}.ts`))
  } catch {
    return false
  }
}

/**
 * Write the two queue migrations into `<cwd>/database/migrations/`, skipping any
 * that already exist. Returns the relative paths actually written.
 */
export async function writeQueueMigrations(
  cwd: string,
  table = 'jobs',
  failedTable = 'failed_jobs',
): Promise<string[]> {
  const dir = join(cwd, 'database', 'migrations')
  mkdirSync(dir, { recursive: true })

  const written: string[] = []
  const plan: Array<{ suffix: string; offset: number; content: string }> = [
    { suffix: 'create_jobs_table',        offset: 0, content: jobsTableStub(table) },
    { suffix: 'create_failed_jobs_table', offset: 1, content: failedJobsTableStub(failedTable) },
  ]

  for (const { suffix, offset, content } of plan) {
    if (alreadyHas(dir, suffix)) {
      console.log(`  • database/migrations/*_${suffix}.ts already exists — skipped`)
      continue
    }
    const file = `${timestamp(offset)}_${suffix}.ts`
    const full = join(dir, file)
    // Atomic create-if-absent — `wx` fails with EEXIST rather than a
    // check-then-write race (the `alreadyHas` suffix scan above is the real
    // dedup; this guards the exact-timestamp filename colliding).
    try {
      writeFileSync(full, content, { flag: 'wx' })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
    written.push(join('database', 'migrations', file))
  }
  return written
}
