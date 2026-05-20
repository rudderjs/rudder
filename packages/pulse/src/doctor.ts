// Doctor checks contributed by @rudderjs/pulse.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function readFileSafe(rel: string): string | null {
  try { return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8') } catch { return null }
}

function dashboardMounted(): boolean {
  for (const rel of ['routes/web.ts', 'routes/api.ts']) {
    const text = readFileSafe(rel)
    if (text && /registerPulseRoutes|@rudderjs\/pulse/.test(text)) return true
  }
  return false
}

registerDoctorCheck({
  id:       'pulse:dashboard',
  category: 'monitoring',
  title:    'Pulse dashboard',
  run(): DoctorResult {
    if (!dashboardMounted()) {
      return {
        status:  'warn',
        message: '@rudderjs/pulse installed but no dashboard route registered',
        fix:     'In routes/web.ts: `import { registerPulseRoutes } from \'@rudderjs/pulse\'; registerPulseRoutes(Route)`',
      }
    }
    return { status: 'ok', message: 'mounted' }
  },
})
