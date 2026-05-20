// Doctor checks contributed by @rudderjs/telescope.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function readFileSafe(rel: string): string | null {
  try { return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8') } catch { return null }
}

function dashboardMounted(): boolean {
  // Scaffolded apps mount telescope's dashboard with `registerTelescopeRoutes`
  // or by importing TelescopeProvider's routes module.
  for (const rel of ['routes/web.ts', 'routes/api.ts']) {
    const text = readFileSafe(rel)
    if (text && /registerTelescopeRoutes|@rudderjs\/telescope/.test(text)) return true
  }
  return false
}

registerDoctorCheck({
  id:       'telescope:dashboard',
  category: 'monitoring',
  title:    'Telescope dashboard',
  run(): DoctorResult {
    if (!dashboardMounted()) {
      return {
        status:  'warn',
        message: '@rudderjs/telescope installed but no dashboard route registered',
        fix:     'In routes/web.ts: `import { registerTelescopeRoutes } from \'@rudderjs/telescope\'; registerTelescopeRoutes(Route)`',
      }
    }
    return { status: 'ok', message: 'mounted' }
  },
})
