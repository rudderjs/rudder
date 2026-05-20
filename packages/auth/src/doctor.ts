// Doctor checks contributed by @rudderjs/auth. Loaded by @rudderjs/cli's
// doctor command when `rudder doctor` runs — side-effect imports below
// register each check on the shared CommandRegistry.

import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'

function fileExists(rel: string): boolean {
  try { return fs.statSync(path.join(process.cwd(), rel)).isFile() } catch { return false }
}

function isResolvable(pkg: string): boolean {
  const target = path.join(process.cwd(), 'node_modules', pkg, 'package.json')
  try { return fs.statSync(target).isFile() } catch { return false }
}

registerDoctorCheck({
  id:       'auth:secret',
  category: 'auth',
  title:    'AUTH_SECRET',
  run(): DoctorResult {
    const v = process.env['AUTH_SECRET']
    if (!v) {
      return {
        status:  'error',
        message: 'unset — required for session signing',
        fix:     'Add `AUTH_SECRET=<random string >= 32 chars>` to .env (e.g. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`)',
      }
    }
    if (v.length < 32) {
      return {
        status:  'warn',
        message: `set but only ${v.length} chars — recommend ≥ 32`,
        fix:     'Regenerate AUTH_SECRET with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`',
      }
    }
    return { status: 'ok', message: `set, ${v.length} chars` }
  },
})

registerDoctorCheck({
  id:       'auth:views-vendored',
  category: 'auth',
  title:    'Auth views vendored',
  run(): DoctorResult {
    // Only relevant when a frontend renderer is installed — otherwise the
    // app has no UI and AUTH_SECRET alone is enough.
    const hasFrontend =
      isResolvable('vike-react') ||
      isResolvable('vike-vue')   ||
      isResolvable('vike-solid')
    if (!hasFrontend) {
      return { status: 'ok', message: 'no frontend installed — skip' }
    }
    const have =
      fileExists('app/Views/Auth/Login.tsx')   ||
      fileExists('app/Views/Auth/Login.jsx')   ||
      fileExists('app/Views/Auth/Login.vue')   ||
      fileExists('app/Views/Auth/Login.ts')
    if (!have) {
      return {
        status:  'warn',
        message: 'frontend installed but app/Views/Auth/ missing',
        fix:     'Vendor the auth views: copy node_modules/@rudderjs/auth/views/<fw>/ → app/Views/Auth/ (or re-run `pnpm create rudder@latest` with auth enabled)',
      }
    }
    return { status: 'ok', message: 'app/Views/Auth/ populated' }
  },
})
