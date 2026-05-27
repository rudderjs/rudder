import { readFileSync } from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

/**
 * Load `<cwd>/.env` into `process.env` so the fast-path (skip-boot) `doctor`'s
 * env-var checks reflect what the app actually sees at runtime.
 *
 * `doctor` is in the CLI's NO_BOOT_EXACT set, so `bootstrap/app.ts`'s
 * `import 'dotenv/config'` never runs. Without this, every check that reads
 * `process.env` (AUTH_SECRET, APP_KEY, DATABASE_URL, …) falsely reports "unset"
 * for vars defined in `.env`, producing red errors + a non-zero exit on a
 * correctly-configured app.
 *
 * Non-override: a value already in `process.env` (a real exported env var —
 * Docker / CI / Forge / a shell export) always wins, matching dotenv's runtime
 * semantics. A missing or unreadable `.env` is fine — config can come from
 * `process.env` directly, and checks fall back to that as before.
 */
export function loadDotenvForChecks(cwd: string = process.cwd()): void {
  let parsed: Record<string, string>
  try {
    parsed = dotenv.parse(readFileSync(path.join(cwd, '.env')))
  } catch {
    return
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
