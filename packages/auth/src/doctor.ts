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

/**
 * Decide which framework directory under `@rudderjs/auth/views/` to vendor from.
 * Today the package only ships a `react/` directory; vue/solid fall back to
 * react (the views are TSX, not framework-specific in any meaningful way).
 * This keeps the fixer working even before the per-framework view sets land.
 */
function detectAuthFramework(): 'react' | 'vue' | 'solid' {
  if (isResolvable('vike-vue'))   return 'vue'
  if (isResolvable('vike-solid')) return 'solid'
  return 'react'
}

/**
 * Idempotent copy from `node_modules/@rudderjs/auth/views/<fw>/` to
 * `app/Views/Auth/`. Never overwrites — files that already exist are left as
 * the user authored them (or as the prior vendoring left them). Files copied
 * are reported in the message.
 */
function vendorAuthViews(): DoctorResult {
  const fw = detectAuthFramework()
  const srcRoot = path.join(process.cwd(), 'node_modules', '@rudderjs', 'auth', 'views', fw)
  if (!fs.existsSync(srcRoot)) {
    // No per-framework set ships for vue/solid yet — fall back to react.
    const fallback = path.join(process.cwd(), 'node_modules', '@rudderjs', 'auth', 'views', 'react')
    if (!fs.existsSync(fallback)) {
      return {
        status:  'error',
        message: `node_modules/@rudderjs/auth/views/${fw}/ not found (and no react fallback)`,
      }
    }
    return vendorFromDir(fallback, 'react')
  }
  return vendorFromDir(srcRoot, fw)
}

function vendorFromDir(srcRoot: string, fwLabel: string): DoctorResult {
  const destRoot = path.join(process.cwd(), 'app', 'Views', 'Auth')
  fs.mkdirSync(destRoot, { recursive: true })

  const copied:  string[] = []
  const skipped: string[] = []
  for (const file of fs.readdirSync(srcRoot)) {
    const src  = path.join(srcRoot, file)
    const dest = path.join(destRoot, file)
    if (!fs.statSync(src).isFile()) continue
    if (fs.existsSync(dest)) { skipped.push(file); continue }
    fs.copyFileSync(src, dest)
    copied.push(file)
  }
  if (copied.length === 0 && skipped.length === 0) {
    return { status: 'warn', message: `no files in node_modules/@rudderjs/auth/views/${fwLabel}/` }
  }
  const parts: string[] = []
  if (copied.length)  parts.push(`${copied.length} copied`)
  if (skipped.length) parts.push(`${skipped.length} already present, left untouched`)
  return { status: 'ok', message: `${fwLabel} views: ${parts.join(', ')}` }
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
  fixer(): DoctorResult {
    return vendorAuthViews()
  },
})
