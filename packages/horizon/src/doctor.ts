// Doctor checks contributed by @rudderjs/horizon.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function readFileSafe(rel: string): string | null {
  try { return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8') } catch { return null }
}

function dashboardMounted(): boolean {
  for (const rel of ['routes/web.ts', 'routes/api.ts']) {
    const text = readFileSafe(rel)
    if (text && /registerHorizonRoutes|@rudderjs\/horizon/.test(text)) return true
  }
  return false
}

registerDoctorCheck({
  id:       'horizon:dashboard',
  category: 'monitoring',
  title:    'Horizon dashboard',
  run(): DoctorResult {
    if (!dashboardMounted()) {
      return {
        status:  'warn',
        message: '@rudderjs/horizon installed but no dashboard route registered',
        fix:     'In routes/web.ts: `import { registerHorizonRoutes } from \'@rudderjs/horizon\'; registerHorizonRoutes(Route)`',
      }
    }
    return { status: 'ok', message: 'mounted' }
  },
})
