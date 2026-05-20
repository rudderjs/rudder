import fs from 'node:fs'
import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { fileExists, mtimeMs, readJsonSafe } from './_fs.js'

interface AppPkg {
  dependencies?:    Record<string, string>
  devDependencies?: Record<string, string>
}

function isResolvable(pkg: string): boolean {
  const target = path.join(process.cwd(), 'node_modules', pkg, 'package.json')
  try { return fs.statSync(target).isFile() } catch { return false }
}

registerDoctorCheck({
  id:       'deps:providers-manifest',
  category: 'deps',
  title:    'providers manifest',
  run(): DoctorResult {
    const manifest = 'bootstrap/cache/providers.json'
    if (!fileExists(manifest)) {
      return {
        status:  'warn',
        message: 'missing — providers won\'t auto-discover',
        fix:     'pnpm rudder providers:discover',
      }
    }
    const manifestMtime = mtimeMs(manifest)
    const pkgMtime      = mtimeMs('package.json')
    if (manifestMtime !== null && pkgMtime !== null && manifestMtime < pkgMtime) {
      return {
        status:  'warn',
        message: 'older than package.json — packages added since last refresh',
        fix:     'pnpm rudder providers:discover',
      }
    }
    return { status: 'ok', message: 'present and current' }
  },
})

registerDoctorCheck({
  id:       'deps:declared-installed',
  category: 'deps',
  title:    '@rudderjs/* installed',
  run(): DoctorResult {
    const pkg = readJsonSafe<AppPkg>('package.json')
    if (!pkg) {
      return { status: 'error', message: 'package.json unreadable', fix: 'Check the file exists and is valid JSON' }
    }
    const declared = [
      ...Object.keys(pkg.dependencies    ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].filter(name => name.startsWith('@rudderjs/') || name === 'create-rudder-app')

    const missing = declared.filter(name => !isResolvable(name))
    if (missing.length > 0) {
      return {
        status:  'error',
        message: `${missing.length} declared but not in node_modules: ${missing.join(', ')}`,
        fix:     'Run your package manager install (e.g. `pnpm install`)',
      }
    }
    return { status: 'ok', message: `${declared.length} declared, all resolvable` }
  },
})

registerDoctorCheck({
  id:       'deps:auth-views',
  category: 'deps',
  title:    'Auth views vendored',
  run(): DoctorResult {
    if (!isResolvable('@rudderjs/auth')) {
      // Skip silently — auth isn't installed, so vendoring isn't expected
      return { status: 'ok', message: '@rudderjs/auth not installed — skip' }
    }
    // If a frontend renderer is installed, auth views must be vendored locally
    // (the package ships the source under `views/<fw>/`, but resolving routes
    // through the user's tree is what the scaffolder does).
    const hasReact = isResolvable('vike-react')
    const hasVue   = isResolvable('vike-vue')
    const hasSolid = isResolvable('vike-solid')
    if (!hasReact && !hasVue && !hasSolid) {
      return { status: 'ok', message: '@rudderjs/auth installed, no frontend — skip' }
    }
    const have =
      fileExists('app/Views/Auth/Login.tsx')  || fileExists('app/Views/Auth/Login.jsx') ||
      fileExists('app/Views/Auth/Login.vue')  || fileExists('app/Views/Auth/Login.ts')
    if (!have) {
      return {
        status:  'warn',
        message: 'auth installed + frontend installed, but app/Views/Auth/* missing',
        fix:     'Vendor the auth views from @rudderjs/auth/views/<fw>/ into app/Views/Auth/',
      }
    }
    return { status: 'ok', message: 'app/Views/Auth/ populated' }
  },
})
